import type { LocalDate } from "./dates.ts"
import type { Task } from "./schema.ts"

export const VIEWS = ["completed", "current", "upcoming"] as const
export type View = (typeof VIEWS)[number]

export const VIEW_LABELS: Record<View, string> = {
  completed: "Completed Tasks",
  current: "Current Tasks",
  upcoming: "Upcoming Tasks",
}

type Compare = (a: Task, b: Task) => number

const by =
  (...compares: Compare[]): Compare =>
  (a, b) => {
    for (const compare of compares) {
      const result = compare(a, b)
      if (result !== 0) return result
    }
    return 0
  }

const inProgressFirst: Compare = (a, b) => Number(b.status === "in-progress") - Number(a.status === "in-progress")
const targetAsc: Compare = (a, b) => a.targetDate.localeCompare(b.targetDate)
const completionDesc: Compare = (a, b) => (b.completionDate ?? "").localeCompare(a.completionDate ?? "")
const updatedDesc: Compare = (a, b) => b.updatedAt.localeCompare(a.updatedAt)
/** Tasks belonging to `view` on `today`, in display order. Ties keep file (creation) order. */
export function tasksInView(tasks: Task[], view: View, today: LocalDate): Task[] {
  switch (view) {
    case "current":
      return tasks
        .filter((t) => t.status !== "done" && t.targetDate <= today)
        .sort(by(inProgressFirst, targetAsc))
    case "upcoming":
      return tasks
        .filter((t) => t.status !== "done" && t.targetDate > today)
        .sort(by(targetAsc, inProgressFirst))
    case "completed":
      return tasks.filter((t) => t.status === "done").sort(by(completionDesc, updatedDesc))
  }
}
