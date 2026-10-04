import { watch as fsWatch } from "node:fs"
import { mkdir } from "node:fs/promises"
import { z } from "zod"
import { addDays, toLocalDate, type LocalDate } from "./dates.ts"
import { TodoError } from "./errors.ts"
import {
  CustomFieldSchema,
  FieldListSchema,
  FieldPatchSchema,
  lockedFieldChange,
  type CustomField,
  type FieldPatch,
} from "./fields.ts"
import { JsonFile } from "./jsonFile.ts"
import { todosDir } from "./paths.ts"
import {
  emptyTodoFile,
  migrate,
  newId,
  NewTaskSchema,
  TaskPatchSchema,
  TodoFileSchema,
  type NewTask,
  type Status,
  type Task,
  type TaskPatch,
  type TodoFile,
} from "./schema.ts"
import {
  applyTemplate,
  emptyTemplateFile,
  NewTemplateSchema,
  TemplateFileSchema,
  TemplatePatchSchema,
  upsertFields,
  type NewTemplate,
  type Template,
  type TemplateFile,
  type TemplatePatch,
} from "./templates.ts"
import { tasksInView, type View } from "./views.ts"

const FILE_NAME = "todos.json"
const TEMPLATES_FILE_NAME = "templates.json"

const parse = <T extends z.ZodType>(schema: T, input: unknown): z.output<T> => {
  const result = schema.safeParse(input)
  if (!result.success) throw new TodoError(result.error.issues.map((i) => i.message).join("; "))
  return result.data
}

/** Drops undefined keys so callers can pass optional fields straight through. */
const defined = <T extends object>(obj: T): Partial<T> =>
  Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as Partial<T>

/** A template by id, or by name. */
export type TemplateRef = string

/** A task plus the ids of its direct subtasks, in creation order. */
export type TaskWithSubtasks = Task & { subtaskIds: string[] }

export interface TaskFilter {
  status?: Status
  /** Restricts to a list view and returns tasks in that view's order. */
  view?: View
}

export interface TodoStoreOptions {
  dir?: string
  /** Clock used for "today"; injectable for tests. */
  now?: () => Date
}

/** Sole owner of the on-disk todo data. CLI, MCP server and TUI all go through this. */
export class TodoStore {
  readonly dir: string
  readonly file: string
  readonly templatesFile: string
  private readonly todos: JsonFile<TodoFile>
  private readonly templates: JsonFile<TemplateFile>
  private readonly now: () => Date

  constructor({ dir = todosDir(), now = () => new Date() }: TodoStoreOptions = {}) {
    this.dir = dir
    this.todos = new JsonFile({ dir, name: FILE_NAME, schema: TodoFileSchema, empty: emptyTodoFile, migrate })
    this.templates = new JsonFile({ dir, name: TEMPLATES_FILE_NAME, schema: TemplateFileSchema, empty: emptyTemplateFile })
    this.file = this.todos.path
    this.templatesFile = this.templates.path
    this.now = now
  }

  today(): LocalDate {
    return toLocalDate(this.now())
  }

  async list(filter: TaskFilter = {}): Promise<Task[]> {
    let { tasks } = await this.todos.read()
    if (filter.view) tasks = tasksInView(tasks, filter.view, this.today())
    return filter.status ? tasks.filter((t) => t.status === filter.status) : tasks
  }

  async get(id: string): Promise<Task> {
    return find(await this.todos.read(), id)
  }

  async getWithSubtasks(id: string): Promise<TaskWithSubtasks> {
    const data = await this.todos.read()
    const subtaskIds = data.tasks.filter((t) => t.parentId === id).map((t) => t.id)
    return { ...find(data, id), subtaskIds }
  }

  async add(input: NewTask): Promise<Task> {
    const { completionDate, parentId, ...fields } = parse(NewTaskSchema, input)
    return this.todos.mutate((data) => {
      const now = this.now().toISOString()
      const task: Task = {
        id: newId(),
        status: fields.status,
        title: fields.title,
        description: fields.description,
        targetDate: fields.targetDate ?? this.today(),
        fields: fields.fields ?? [],
        createdAt: now,
        updatedAt: now,
      }
      this.applyCompletion(task, completionDate, undefined)
      applyParent(data, task, parentId)
      data.tasks.push(task)
      return task
    })
  }

  /** Adds a task starting from a template. Values given in `input` win over the template's. */
  async addFromTemplate(ref: TemplateRef, input: Partial<NewTask> = {}): Promise<Task> {
    const template = findTemplate(await this.templates.read(), ref)
    const { fields, ...rest } = input
    const base = applyTemplate({ title: "", description: "", fields: [] }, template)
    const explicit = fields === undefined ? [] : parse(FieldListSchema, fields)
    return this.add({ ...base, ...defined(rest), fields: upsertFields(base.fields, explicit) })
  }

  async update(id: string, patch: TaskPatch): Promise<Task> {
    const { completionDate, parentId, ...parsed } = parse(TaskPatchSchema, patch)
    const fields = defined(parsed)
    return this.todos.mutate((data) => {
      const task = find(data, id)
      const previous = task.completionDate
      if (fields.fields) assertUnlocked(task.fields, fields.fields)
      Object.assign(task, fields, { updatedAt: this.now().toISOString() })
      this.applyCompletion(task, completionDate, previous)
      applyParent(data, task, parentId)
      return task
    })
  }

  /** Moves the task out of today: target becomes tomorrow, even if it was overdue. */
  postpone(id: string): Promise<Task> {
    return this.update(id, { targetDate: addDays(this.today(), 1) })
  }

  pullToToday(id: string): Promise<Task> {
    return this.update(id, { targetDate: this.today() })
  }

  /** Puts a done task back in progress for today. */
  reopen(id: string): Promise<Task> {
    return this.update(id, { status: "in-progress", targetDate: this.today() })
  }

  setStatus(id: string, status: Status): Promise<Task> {
    return this.update(id, { status })
  }

  /** Adds the field, or changes the one with the same name. Unspecified options keep their current value. */
  async setField(id: string, patch: FieldPatch): Promise<Task> {
    const parsed = parse(FieldPatchSchema, patch)
    return this.todos.mutate((data) => {
      const task = find(data, id)
      const fields = withField(task.fields, parsed)
      assertUnlocked(task.fields, fields)
      return Object.assign(task, { fields, updatedAt: this.now().toISOString() })
    })
  }

  async removeField(id: string, name: string): Promise<Task> {
    return this.todos.mutate((data) => {
      const task = find(data, id)
      return Object.assign(task, {
        fields: withoutField(task.fields, name, `task ${id}`),
        updatedAt: this.now().toISOString(),
      })
    })
  }

  /** Refuses while the task has subtasks. */
  async remove(id: string): Promise<Task> {
    return this.todos.mutate((data) => {
      const task = find(data, id)
      const subtasks = data.tasks.filter((t) => t.parentId === id).length
      if (subtasks) throw new TodoError(`task ${id} has ${subtasks} subtask${subtasks === 1 ? "" : "s"}; delete or move them first`)
      data.tasks = data.tasks.filter((t) => t.id !== id)
      return task
    })
  }

  /** Templates, sorted by name. */
  async listTemplates(): Promise<Template[]> {
    const { templates } = await this.templates.read()
    return templates.toSorted((a, b) => a.name.localeCompare(b.name))
  }

  async getTemplate(ref: TemplateRef): Promise<Template> {
    return findTemplate(await this.templates.read(), ref)
  }

  async addTemplate(input: NewTemplate): Promise<Template> {
    const parsed = parse(NewTemplateSchema, input)
    return this.templates.mutate((data) => {
      assertNameFree(data, parsed.name)
      const now = this.now().toISOString()
      const template: Template = {
        id: newId(),
        name: parsed.name,
        title: parsed.title ?? "",
        description: parsed.description ?? "",
        fields: parsed.fields ?? [],
        createdAt: now,
        updatedAt: now,
      }
      data.templates.push(template)
      return template
    })
  }

  async updateTemplate(ref: TemplateRef, patch: TemplatePatch): Promise<Template> {
    const fields = defined(parse(TemplatePatchSchema, patch))
    return this.templates.mutate((data) => {
      const template = findTemplate(data, ref)
      if (fields.name !== undefined && fields.name !== template.name) assertNameFree(data, fields.name)
      return Object.assign(template, fields, { updatedAt: this.now().toISOString() })
    })
  }

  /** Like `setField`, on a template. Template fields are never locked. */
  async setTemplateField(ref: TemplateRef, patch: FieldPatch): Promise<Template> {
    const parsed = parse(FieldPatchSchema, patch)
    return this.templates.mutate((data) => {
      const template = findTemplate(data, ref)
      return Object.assign(template, { fields: withField(template.fields, parsed), updatedAt: this.now().toISOString() })
    })
  }

  async removeTemplateField(ref: TemplateRef, name: string): Promise<Template> {
    return this.templates.mutate((data) => {
      const template = findTemplate(data, ref)
      return Object.assign(template, {
        fields: withoutField(template.fields, name, `template "${template.name}"`),
        updatedAt: this.now().toISOString(),
      })
    })
  }

  async removeTemplate(ref: TemplateRef): Promise<Template> {
    return this.templates.mutate((data) => {
      const template = findTemplate(data, ref)
      data.templates = data.templates.filter((t) => t !== template)
      return template
    })
  }

  /** Calls `onChange` whenever todos.json or templates.json changes on disk (any process). Returns an unsubscribe fn. */
  async watch(onChange: () => void): Promise<() => void> {
    await mkdir(this.dir, { recursive: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    // Watch the dir, not the files: writes replace them via rename.
    const watcher = fsWatch(this.dir, (_event, name) => {
      if (name !== FILE_NAME && name !== TEMPLATES_FILE_NAME) return
      clearTimeout(timer)
      timer = setTimeout(onChange, 30)
    })
    return () => {
      clearTimeout(timer)
      watcher.close()
    }
  }

  /** Done tasks always carry a completion date; other tasks never do. */
  private applyCompletion(task: Task, requested: LocalDate | undefined, previous: LocalDate | undefined): void {
    if (task.status === "done") {
      task.completionDate = requested ?? previous ?? this.today()
    } else if (requested !== undefined) {
      throw new TodoError("completionDate can only be set on done tasks")
    } else {
      delete task.completionDate
    }
  }
}

/** `fields` with the patch applied to the field of that name, or with a new field. */
const withField = (fields: CustomField[], { name, ...changes }: z.output<typeof FieldPatchSchema>): CustomField[] => {
  const index = fields.findIndex((f) => f.name === name)
  const field = parse(CustomFieldSchema, { type: "text", ...fields[index], ...defined(changes), name })
  return index < 0 ? [...fields, field] : fields.with(index, field)
}

const withoutField = (fields: CustomField[], name: string, owner: string): CustomField[] => {
  if (!fields.some((f) => f.name === name)) throw new TodoError(`${owner} has no field "${name}"`)
  return fields.filter((f) => f.name !== name)
}

const assertUnlocked = (previous: CustomField[], next: CustomField[]) => {
  const locked = lockedFieldChange(previous, next)
  if (locked !== undefined) throw new TodoError(`field "${locked}" is not editable`)
}

/** Sets (string), clears (null) or leaves (undefined) the parent; refuses unknown parents and cycles. */
const applyParent = (data: TodoFile, task: Task, parentId: string | null | undefined) => {
  if (parentId === undefined) return
  if (parentId === null) {
    delete task.parentId
    return
  }
  for (let ancestor: Task | undefined = find(data, parentId); ancestor; ) {
    if (ancestor.id === task.id) throw new TodoError("a task can't be its own parent or ancestor")
    ancestor = ancestor.parentId === undefined ? undefined : data.tasks.find((t) => t.id === ancestor!.parentId)
  }
  task.parentId = parentId
}

const find = (data: TodoFile, id: string): Task => {
  const task = data.tasks.find((t) => t.id === id)
  if (!task) throw new TodoError(`task ${id} not found`)
  return task
}

const findTemplate = (data: TemplateFile, ref: TemplateRef): Template => {
  const template = data.templates.find((t) => t.id === ref.trim()) ?? data.templates.find((t) => t.name === ref.trim())
  if (!template) throw new TodoError(`template "${ref}" not found`)
  return template
}

const assertNameFree = (data: TemplateFile, name: string) => {
  if (data.templates.some((t) => t.name === name)) throw new TodoError(`a template named "${name}" already exists`)
}
