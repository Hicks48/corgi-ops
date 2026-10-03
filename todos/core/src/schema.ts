import { z } from "zod"
import { toLocalDate } from "./dates.ts"
import { FieldListSchema } from "./fields.ts"

export const SCHEMA_VERSION = 3

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

export const TaskSchema = z.object({
  id: z.number().int().positive(),
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
})
export type NewTask = z.input<typeof NewTaskSchema>

/** `fields` replaces the whole list. */
export const TaskPatchSchema = NewTaskSchema.extend({ status: StatusSchema }).partial()
export type TaskPatch = z.input<typeof TaskPatchSchema>

export const TodoFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  nextId: z.number().int().positive(),
  tasks: z.array(TaskSchema),
})
export type TodoFile = z.infer<typeof TodoFileSchema>

export const emptyTodoFile = (): TodoFile => ({ schemaVersion: SCHEMA_VERSION, nextId: 1, tasks: [] })

type RawFile = { schemaVersion?: number; tasks?: Record<string, unknown>[] }

const STEPS: Record<number, (tasks: Record<string, unknown>[]) => Record<string, unknown>[]> = {
  1: (tasks) =>
    tasks.map((task) => {
      const status = task.status === "in_progress" ? "in-progress" : task.status
      return {
        ...task,
        status,
        targetDate: toLocalDate(new Date(task.createdAt as string)),
        completionDate: status === "done" ? toLocalDate(new Date(task.updatedAt as string)) : undefined,
      }
    }),
  2: (tasks) => tasks.map((task) => ({ ...task, fields: [] })),
}

/** Upgrades older file formats in memory; the upgraded form is persisted on the next write. */
export const migrate = (raw: unknown): unknown => {
  let file = raw as RawFile
  for (;;) {
    const step = file?.schemaVersion === undefined ? undefined : STEPS[file.schemaVersion]
    if (!step || !Array.isArray(file.tasks)) return file
    file = { ...file, schemaVersion: file.schemaVersion! + 1, tasks: step(file.tasks) }
  }
}
