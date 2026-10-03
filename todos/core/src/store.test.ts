import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TodoError, TodoStore } from "./index.ts"

let root: string
let store: TodoStore
// Local noon, so "today" is stable regardless of time zone.
let clock = new Date(2026, 9, 3, 12)

beforeEach(async () => {
  clock = new Date(2026, 9, 3, 12)
  root = await mkdtemp(join(tmpdir(), "corgiops-"))
  store = new TodoStore({ dir: join(root, "todos"), now: () => clock })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("TodoStore", () => {
  test("creates the directory and returns no tasks when empty", async () => {
    expect(await store.list()).toEqual([])
    expect(existsSync(store.dir)).toBe(true)
  })

  test("adds tasks with incrementing ids and persists them", async () => {
    const a = await store.add({ title: "A", description: "first" })
    const b = await store.add({ title: "B", description: "second", status: "done" })
    expect([a.id, b.id]).toEqual([1, 2])
    expect(a).toMatchObject({ status: "todo", targetDate: "2026-10-03" })
    expect(a.completionDate).toBeUndefined()
    expect(b.completionDate).toBe("2026-10-03")

    const onDisk = JSON.parse(await readFile(store.file, "utf8"))
    expect(onDisk.schemaVersion).toBe(2)
    expect(onDisk.tasks).toHaveLength(2)
    expect(await new TodoStore({ dir: store.dir, now: () => clock }).list({ status: "done" })).toEqual([b])
  })

  test("requires title and description", async () => {
    await expect(store.add({ title: "  ", description: "x" })).rejects.toThrow("title is required")
    await expect(store.add({ title: "x", description: "" })).rejects.toThrow("description is required")
    const task = await store.add({ title: "x", description: "y" })
    await expect(store.update(task.id, { description: " " })).rejects.toThrow(TodoError)
  })

  test("updates, changes status and removes", async () => {
    const task = await store.add({ title: "A", description: "first" })
    const updated = await store.update(task.id, { title: "A2" })
    expect(updated).toMatchObject({ title: "A2", description: "first" })
    expect(await store.update(task.id, { title: undefined, status: undefined })).toMatchObject({
      title: "A2",
      description: "first",
      status: "todo",
    })

    expect((await store.setStatus(task.id, "in-progress")).status).toBe("in-progress")
    await store.remove(task.id)
    expect(await store.list()).toEqual([])
    await expect(store.get(task.id)).rejects.toThrow("task 1 not found")
  })

  test("does not reuse ids after removal", async () => {
    const a = await store.add({ title: "A", description: "a" })
    await store.remove(a.id)
    expect((await store.add({ title: "B", description: "b" })).id).toBe(2)
  })

  test("concurrent writers do not lose tasks", async () => {
    const stores = Array.from({ length: 20 }, () => new TodoStore({ dir: store.dir, now: () => clock }))
    await Promise.all(stores.map((s, i) => s.add({ title: `T${i}`, description: "d" })))
    const ids = (await store.list()).map((t) => t.id).sort((x, y) => x - y)
    expect(ids).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  })

  test("reports a corrupt file instead of overwriting it", async () => {
    await store.list()
    await writeFile(store.file, "{not json")
    await expect(store.add({ title: "A", description: "a" })).rejects.toThrow("corrupt")
    expect(await readFile(store.file, "utf8")).toBe("{not json")
  })

  test("watch fires on changes from another store", async () => {
    let calls = 0
    const stop = await store.watch(() => calls++)
    await new TodoStore({ dir: store.dir, now: () => clock }).add({ title: "A", description: "a" })
    await new Promise((resolve) => setTimeout(resolve, 200))
    stop()
    expect(calls).toBeGreaterThan(0)
  })

  test("completion date follows the done status", async () => {
    const task = await store.add({ title: "A", description: "a" })
    await expect(store.update(task.id, { completionDate: "2026-10-01" })).rejects.toThrow("only be set on done")

    const done = await store.update(task.id, { status: "done", completionDate: "2026-10-01" })
    expect(done.completionDate).toBe("2026-10-01")
    expect((await store.update(task.id, { title: "A2" })).completionDate).toBe("2026-10-01")

    const reopened = await store.update(task.id, { status: "todo" })
    expect(reopened.completionDate).toBeUndefined()
    expect((await store.setStatus(task.id, "done")).completionDate).toBe("2026-10-03")
  })

  test("explicitly undefined optional fields fall back to defaults", async () => {
    const task = await store.add({ title: "A", description: "a", status: undefined, targetDate: undefined, completionDate: undefined })
    expect(task).toMatchObject({ status: "todo", targetDate: "2026-10-03" })
    expect((await store.update(task.id, { targetDate: undefined })).targetDate).toBe("2026-10-03")
  })

  test("rejects malformed dates", async () => {
    await expect(store.add({ title: "A", description: "a", targetDate: "tomorrow" })).rejects.toThrow("YYYY-MM-DD")
  })

  test("postpone, pull to today and reopen", async () => {
    const overdue = await store.add({ title: "A", description: "a", targetDate: "2026-09-20" })
    expect((await store.postpone(overdue.id)).targetDate).toBe("2026-10-04")
    // Always tomorrow, not target + 1.
    expect((await store.postpone(overdue.id)).targetDate).toBe("2026-10-04")
    expect((await store.pullToToday(overdue.id)).targetDate).toBe("2026-10-03")

    await store.update(overdue.id, { status: "done", targetDate: "2026-10-01" })
    expect(await store.reopen(overdue.id)).toMatchObject({ status: "in-progress", targetDate: "2026-10-03" })
    expect((await store.get(overdue.id)).completionDate).toBeUndefined()
  })

  test("list views filter and sort", async () => {
    const add = (title: string, fields: Partial<Parameters<TodoStore["add"]>[0]>) =>
      store.add({ title, description: "d", ...fields })
    await add("todo-today", {})
    await add("doing-overdue", { status: "in-progress", targetDate: "2026-10-01" })
    await add("later", { targetDate: "2026-10-10" })
    await add("soon", { targetDate: "2026-10-04" })
    await add("done-old", { status: "done", completionDate: "2026-09-01" })
    await add("done-new", { status: "done", completionDate: "2026-10-02" })

    const titles = async (view: "current" | "upcoming" | "completed") =>
      (await store.list({ view })).map((t) => t.title)
    expect(await titles("current")).toEqual(["doing-overdue", "todo-today"])
    expect(await titles("upcoming")).toEqual(["soon", "later"])
    expect(await titles("completed")).toEqual(["done-new", "done-old"])

    clock = new Date(2026, 9, 4, 12)
    expect(await titles("current")).toEqual(["doing-overdue", "todo-today", "soon"])
  })

  test("migrates schema v1 files", async () => {
    await store.list()
    const v1 = {
      schemaVersion: 1,
      nextId: 3,
      tasks: [
        { id: 1, title: "A", description: "a", status: "in_progress", createdAt: new Date(2026, 9, 1, 9).toISOString(), updatedAt: new Date(2026, 9, 1, 9).toISOString() },
        { id: 2, title: "B", description: "b", status: "done", createdAt: new Date(2026, 9, 1, 9).toISOString(), updatedAt: new Date(2026, 9, 2, 9).toISOString() },
      ],
    }
    await writeFile(store.file, JSON.stringify(v1))
    expect(await store.list()).toMatchObject([
      { id: 1, status: "in-progress", targetDate: "2026-10-01" },
      { id: 2, status: "done", targetDate: "2026-10-01", completionDate: "2026-10-02" },
    ])
    await store.add({ title: "C", description: "c" })
    expect(JSON.parse(await readFile(store.file, "utf8")).schemaVersion).toBe(2)
  })
})
