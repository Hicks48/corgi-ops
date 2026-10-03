import { watch as fsWatch } from "node:fs"
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { addDays, toLocalDate, type LocalDate } from "./dates.ts"
import { CustomFieldSchema, FieldPatchSchema, lockedFieldChange, type CustomField, type FieldPatch } from "./fields.ts"
import { todosDir } from "./paths.ts"
import {
  emptyTodoFile,
  migrate,
  NewTaskSchema,
  TaskPatchSchema,
  TodoFileSchema,
  type NewTask,
  type Status,
  type Task,
  type TaskPatch,
  type TodoFile,
} from "./schema.ts"
import { tasksInView, type View } from "./views.ts"

const FILE_NAME = "todos.json"
const LOCK_NAME = "todos.lock"
const LOCK_STALE_MS = 10_000
const LOCK_RETRY_MS = 25
const LOCK_TIMEOUT_MS = 5_000

export class TodoError extends Error {
  override name = "TodoError"
}

const parse = <T extends z.ZodType>(schema: T, input: unknown): z.output<T> => {
  const result = schema.safeParse(input)
  if (!result.success) throw new TodoError(result.error.issues.map((i) => i.message).join("; "))
  return result.data
}

/** Drops undefined keys so callers can pass optional fields straight through. */
const defined = <T extends object>(obj: T): Partial<T> =>
  Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as Partial<T>

const isCode = (err: unknown, code: string) => (err as NodeJS.ErrnoException)?.code === code

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
  private readonly lock: string
  private readonly now: () => Date

  constructor({ dir = todosDir(), now = () => new Date() }: TodoStoreOptions = {}) {
    this.dir = dir
    this.file = join(dir, FILE_NAME)
    this.lock = join(dir, LOCK_NAME)
    this.now = now
  }

  today(): LocalDate {
    return toLocalDate(this.now())
  }

  async list(filter: TaskFilter = {}): Promise<Task[]> {
    let { tasks } = await this.read()
    if (filter.view) tasks = tasksInView(tasks, filter.view, this.today())
    return filter.status ? tasks.filter((t) => t.status === filter.status) : tasks
  }

  async get(id: number): Promise<Task> {
    return find(await this.read(), id)
  }

  async add(input: NewTask): Promise<Task> {
    const { completionDate, ...fields } = parse(NewTaskSchema, input)
    return this.mutate((data) => {
      const now = this.now().toISOString()
      const task: Task = {
        id: data.nextId++,
        status: fields.status,
        title: fields.title,
        description: fields.description,
        targetDate: fields.targetDate ?? this.today(),
        fields: fields.fields ?? [],
        createdAt: now,
        updatedAt: now,
      }
      this.applyCompletion(task, completionDate, undefined)
      data.tasks.push(task)
      return task
    })
  }

  async update(id: number, patch: TaskPatch): Promise<Task> {
    const { completionDate, ...parsed } = parse(TaskPatchSchema, patch)
    const fields = defined(parsed)
    return this.mutate((data) => {
      const task = find(data, id)
      const previous = task.completionDate
      if (fields.fields) assertUnlocked(task.fields, fields.fields)
      Object.assign(task, fields, { updatedAt: this.now().toISOString() })
      this.applyCompletion(task, completionDate, previous)
      return task
    })
  }

  /** Moves the task out of today: target becomes tomorrow, even if it was overdue. */
  postpone(id: number): Promise<Task> {
    return this.update(id, { targetDate: addDays(this.today(), 1) })
  }

  pullToToday(id: number): Promise<Task> {
    return this.update(id, { targetDate: this.today() })
  }

  /** Puts a done task back in progress for today. */
  reopen(id: number): Promise<Task> {
    return this.update(id, { status: "in-progress", targetDate: this.today() })
  }

  setStatus(id: number, status: Status): Promise<Task> {
    return this.update(id, { status })
  }

  /** Adds the field, or changes the one with the same name. Unspecified options keep their current value. */
  async setField(id: number, patch: FieldPatch): Promise<Task> {
    const { name, ...changes } = parse(FieldPatchSchema, patch)
    return this.mutate((data) => {
      const task = find(data, id)
      const index = task.fields.findIndex((f) => f.name === name)
      const existing = task.fields[index]
      const field = parse(CustomFieldSchema, { type: "text", ...existing, ...defined(changes), name })
      const fields = index < 0 ? [...task.fields, field] : task.fields.with(index, field)
      assertUnlocked(task.fields, fields)
      return Object.assign(task, { fields, updatedAt: this.now().toISOString() })
    })
  }

  async removeField(id: number, name: string): Promise<Task> {
    return this.mutate((data) => {
      const task = find(data, id)
      if (!task.fields.some((f) => f.name === name)) throw new TodoError(`task ${id} has no field "${name}"`)
      return Object.assign(task, {
        fields: task.fields.filter((f) => f.name !== name),
        updatedAt: this.now().toISOString(),
      })
    })
  }

  async remove(id: number): Promise<Task> {
    return this.mutate((data) => {
      const task = find(data, id)
      data.tasks = data.tasks.filter((t) => t.id !== id)
      return task
    })
  }

  /** Calls `onChange` whenever todos.json changes on disk (any process). Returns an unsubscribe fn. */
  async watch(onChange: () => void): Promise<() => void> {
    await mkdir(this.dir, { recursive: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    // Watch the dir, not the file: writes replace the file via rename.
    const watcher = fsWatch(this.dir, (_event, name) => {
      if (name !== FILE_NAME) return
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

  private async read(): Promise<TodoFile> {
    await mkdir(this.dir, { recursive: true })
    let raw: string
    try {
      raw = await readFile(this.file, "utf8")
    } catch (err) {
      if (isCode(err, "ENOENT")) return emptyTodoFile()
      throw err
    }
    try {
      return TodoFileSchema.parse(migrate(JSON.parse(raw)))
    } catch (err) {
      const detail = err instanceof z.ZodError ? z.prettifyError(err) : (err as Error).message
      throw new TodoError(`${this.file} is corrupt or has an unsupported format:\n${detail}`)
    }
  }

  private async mutate<T>(fn: (data: TodoFile) => T): Promise<T> {
    await mkdir(this.dir, { recursive: true })
    await this.acquireLock()
    try {
      const data = await this.read()
      const result = fn(data)
      // Never let a bug write a file that the next read would reject.
      const valid = TodoFileSchema.safeParse(data)
      if (!valid.success) throw new TodoError(`refusing to write invalid data:\n${z.prettifyError(valid.error)}`)
      // Atomic replace so readers never see a half-written file.
      const tmp = `${this.file}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(data, null, 2) + "\n")
      await rename(tmp, this.file)
      return result
    } finally {
      await rm(this.lock, { force: true })
    }
  }

  private async acquireLock(): Promise<void> {
    const deadline = Date.now() + LOCK_TIMEOUT_MS
    for (;;) {
      try {
        const handle = await open(this.lock, "wx")
        await handle.close()
        return
      } catch (err) {
        if (!isCode(err, "EEXIST")) throw err
      }
      // A crashed writer leaves its lock behind; steal it once it is clearly stale.
      const age = await stat(this.lock).then(
        (s) => Date.now() - s.mtimeMs,
        () => 0,
      )
      if (age > LOCK_STALE_MS) {
        await rm(this.lock, { force: true })
        continue
      }
      if (Date.now() > deadline) throw new TodoError(`timed out waiting for lock ${this.lock}`)
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS))
    }
  }
}

const assertUnlocked = (previous: CustomField[], next: CustomField[]) => {
  const locked = lockedFieldChange(previous, next)
  if (locked !== undefined) throw new TodoError(`field "${locked}" is not editable`)
}

const find = (data: TodoFile, id: number): Task => {
  const task = data.tasks.find((t) => t.id === id)
  if (!task) throw new TodoError(`task ${id} not found`)
  return task
}
