import { z } from "zod"
import { FieldListSchema } from "./fields.ts"

export const SCHEMA_VERSION = 4

export const STATUSES = ["todo", "in-progress", "done"] as const
export const StatusSchema = z.enum(STATUSES)
export type Status = z.infer<typeof StatusSchema>

export const STATUS_LABELS: Record<Status, string> = {
  todo: "Todo",
  "in-progress": "In Progress",
  done: "Done",
}

const requiredText = (field: string) => z.string().trim().min(1, `${field} is required`)
const localDate = (field: string) => z.iso.date(`${field} must be a date as YYYY-MM-DD`)

/** Task and template ids are uuids. */
export const IdSchema = z.uuid("id must be a uuid")
export const newId = (): string => crypto.randomUUID()
/** Enough of an id to tell tasks apart on screen. */
export const shortId = (id: string): string => id.slice(0, 8)

const parentId = z.string().trim().pipe(z.uuid("parentId must be a task id (uuid)"))

export const TaskSchema = z.object({
  id: IdSchema,
  /** Makes this a subtask of that task. */
  parentId: parentId.optional(),
  title: requiredText("title"),
  description: requiredText("description"),
  status: StatusSchema,
  /** Day the task is planned for. On or before today = current, after = upcoming. */
  targetDate: localDate("targetDate"),
  /** Set only while status is done. */
  completionDate: localDate("completionDate").optional(),
  /** User-defined fields, in display order. */
  fields: FieldListSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type Task = z.infer<typeof TaskSchema>

export const NewTaskSchema = z.object({
  title: requiredText("title"),
  description: requiredText("description"),
  status: StatusSchema.default("todo"),
  targetDate: localDate("targetDate").optional(),
  completionDate: localDate("completionDate").optional(),
  fields: FieldListSchema.optional(),
  /** null = no parent. */
  parentId: parentId.nullable().optional(),
})
export type NewTask = z.input<typeof NewTaskSchema>

/** `fields` replaces the whole list; `parentId: null` clears the parent. */
export const TaskPatchSchema = NewTaskSchema.extend({ status: StatusSchema }).partial()
export type TaskPatch = z.input<typeof TaskPatchSchema>

export const TodoFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  tasks: z.array(TaskSchema),
})
export type TodoFile = z.infer<typeof TodoFileSchema>

export const emptyTodoFile = (): TodoFile => ({ schemaVersion: SCHEMA_VERSION, tasks: [] })

type RawFile = { schemaVersion?: number; tasks?: Record<string, unknown>[] }

// Pre-v4 files (numeric ids) are not migrated: the app was not in use yet.
const STEPS: Record<number, (tasks: Record<string, unknown>[]) => Record<string, unknown>[]> = {}

/** Upgrades older file formats in memory; the upgraded form is persisted on the next write. */
export const migrate = (raw: unknown): unknown => {
  let file = raw as RawFile
  for (;;) {
    const step = file?.schemaVersion === undefined ? undefined : STEPS[file.schemaVersion]
    if (!step || !Array.isArray(file.tasks)) return file
    file = { ...file, schemaVersion: file.schemaVersion! + 1, tasks: step(file.tasks) }
  }
}
