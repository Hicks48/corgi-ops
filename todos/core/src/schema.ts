import { z } from "zod"
import { toLocalDate } from "./dates.ts"

export const SCHEMA_VERSION = 2

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
})
export type NewTask = z.input<typeof NewTaskSchema>

export const TaskPatchSchema = NewTaskSchema.extend({ status: StatusSchema }).partial()
export type TaskPatch = z.infer<typeof TaskPatchSchema>

export const TodoFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  nextId: z.number().int().positive(),
  tasks: z.array(TaskSchema),
})
export type TodoFile = z.infer<typeof TodoFileSchema>

export const emptyTodoFile = (): TodoFile => ({ schemaVersion: SCHEMA_VERSION, nextId: 1, tasks: [] })

/** Upgrades older file formats in memory; the upgraded form is persisted on the next write. */
export const migrate = (raw: unknown): unknown => {
  const file = raw as { schemaVersion?: number; tasks?: Record<string, unknown>[] }
  if (file?.schemaVersion !== 1 || !Array.isArray(file.tasks)) return raw
  return {
    ...file,
    schemaVersion: 2,
    tasks: file.tasks.map((task) => {
      const status = task.status === "in_progress" ? "in-progress" : task.status
      return {
        ...task,
        status,
        targetDate: toLocalDate(new Date(task.createdAt as string)),
        completionDate: status === "done" ? toLocalDate(new Date(task.updatedAt as string)) : undefined,
      }
    }),
  }
}
