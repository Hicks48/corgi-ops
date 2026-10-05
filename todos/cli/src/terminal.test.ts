import { expect, test } from "bun:test"
import { terminalSafe, terminalSafeJson } from "./terminal.ts"

test("terminalSafe drops control characters but keeps newlines and tabs", () => {
  expect(terminalSafe("a\u001b[2Jb\u001b]52;c;eA==\u0007c\rd\u009be\u007f")).toBe("a[2Jb]52;c;eA==cde")
  expect(terminalSafe("line 1\n\tline 2")).toBe("line 1\n\tline 2")
})

test("terminalSafeJson escapes DEL and C1 characters", () => {
  const json = terminalSafeJson({ title: "a\u001b\u009b\u007fb" })
  expect(json).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/)
  expect(JSON.parse(json)).toEqual({ title: "a\u001b\u009b\u007fb" })
})
