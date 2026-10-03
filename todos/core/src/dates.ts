/** Calendar dates are plain `YYYY-MM-DD` strings in the user's local time zone. */
export type LocalDate = string

const pad = (n: number) => String(n).padStart(2, "0")

export const toLocalDate = (date: Date): LocalDate =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export const addDays = (date: LocalDate, days: number): LocalDate => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number]
  return toLocalDate(new Date(y, m - 1, d + days))
}

/** ISO timestamp as local `YYYY-MM-DD HH:MM`. */
export const formatLocalDateTime = (iso: string): string => {
  const date = new Date(iso)
  return `${toLocalDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
