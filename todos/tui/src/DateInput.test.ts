import { expect, test } from "bun:test"
import { maskDate } from "./DateInput.tsx"

test("maskDate keeps digits and inserts dashes", () => {
  expect(maskDate("2026", 4)).toEqual({ text: "2026", cursor: 4 })
  expect(maskDate("20261", 5)).toEqual({ text: "2026-1", cursor: 6 })
  expect(maskDate("2026-", 5)).toEqual({ text: "2026", cursor: 4 })
  expect(maskDate("2026/10/x03", 11)).toEqual({ text: "2026-10-03", cursor: 10 })
  expect(maskDate("", 0)).toEqual({ text: "", cursor: 0 })
})

test("maskDate ignores extra digits at the end and overwrites in the middle", () => {
  expect(maskDate("2026-10-039", 11)).toEqual({ text: "2026-10-03", cursor: 10 })
  // Typed "1" after "2026-1": replaces the next digit.
  expect(maskDate("2026-110-03", 7)).toEqual({ text: "2026-11-03", cursor: 7 })
  // Deleting a dash moves nothing.
  expect(maskDate("202610-03", 4)).toEqual({ text: "2026-10-03", cursor: 4 })
})
