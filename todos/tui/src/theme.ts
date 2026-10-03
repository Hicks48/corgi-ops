import type { Status } from "@corgiops/todos-core"

export const theme = {
  accent: "#f5a742",
  onAccent: "#000000",
  text: "#e4e4e4",
  dim: "#8a8a8a",
  border: "#4e4e4e",
  error: "#ff5f5f",
} as const

export const STATUS_COLORS: Record<Status, string> = {
  todo: "#87afd7",
  "in-progress": "#f5a742",
  done: "#87d787",
}

export const STATUS_BADGES: Record<Status, string> = {
  todo: "○ TODO",
  "in-progress": "◐ IN PROGRESS",
  done: "● DONE",
}
