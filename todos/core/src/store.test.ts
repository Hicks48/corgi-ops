import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyTemplate, TodoError, TodoStore, type Template } from "./index.ts"

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
    expect(onDisk.schemaVersion).toBe(3)
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
    expect(JSON.parse(await readFile(store.file, "utf8")).schemaVersion).toBe(3)
  })

  test("migrates schema v2 files", async () => {
    await store.list()
    const at = new Date(2026, 9, 1, 9).toISOString()
    const v2 = {
      schemaVersion: 2,
      nextId: 2,
      tasks: [{ id: 1, title: "A", description: "a", status: "todo", targetDate: "2026-10-01", createdAt: at, updatedAt: at }],
    }
    await writeFile(store.file, JSON.stringify(v2))
    expect(await store.list()).toMatchObject([{ id: 1, fields: [] }])
    await store.add({ title: "B", description: "b" })
    expect(JSON.parse(await readFile(store.file, "utf8")).schemaVersion).toBe(3)
  })
})

describe("custom fields", () => {
  test("fill in option defaults and validate values", async () => {
    const task = await store.add({
      title: "A",
      description: "a",
      fields: [
        { type: "text", name: "Notes", value: "hi" },
        { type: "link", name: "PR", value: " https://example.com ", visibleOnLists: true },
        { type: "date", name: "Due" },
        { type: "timestamp", name: "At", value: "2026-10-03T09:00:00+03:00", editable: false },
      ],
    })
    expect(task.fields).toEqual([
      { type: "text", name: "Notes", editable: true, visibleOnLists: false, textbox: true, value: "hi" },
      { type: "link", name: "PR", editable: true, visibleOnLists: true, value: "https://example.com" },
      { type: "date", name: "Due", editable: true, visibleOnLists: false, value: "" },
      { type: "timestamp", name: "At", editable: false, visibleOnLists: false, value: "2026-10-03T09:00:00+03:00" },
    ])
    await expect(store.add({ title: "B", description: "b", fields: [{ type: "date", name: "Due", value: "soon" }] })).rejects.toThrow("YYYY-MM-DD")
    await expect(store.add({ title: "B", description: "b", fields: [{ type: "text", name: " " }] })).rejects.toThrow("field name is required")
    await expect(
      store.add({ title: "B", description: "b", fields: [{ type: "text", name: "X" }, { type: "link", name: "X" }] }),
    ).rejects.toThrow("duplicate field name: X")
  })

  test("setField adds or changes a field by name, keeping unspecified options", async () => {
    const task = await store.add({ title: "A", description: "a" })
    await store.setField(task.id, { name: "PR", type: "link", value: "x", visibleOnLists: true })
    const updated = await store.setField(task.id, { name: "PR", value: "y", type: undefined })
    expect(updated.fields).toEqual([{ type: "link", name: "PR", editable: true, visibleOnLists: true, value: "y" }])
    expect((await store.setField(task.id, { name: "Notes" })).fields[1]).toMatchObject({ type: "text", textbox: true })

    expect((await store.removeField(task.id, "PR")).fields.map((f) => f.name)).toEqual(["Notes"])
    await expect(store.removeField(task.id, "PR")).rejects.toThrow('no field "PR"')
  })

  test("non-editable fields are locked once saved but can be removed", async () => {
    const task = await store.add({ title: "A", description: "a", fields: [{ type: "text", name: "Id", value: "1", editable: false }] })
    await expect(store.setField(task.id, { name: "Id", value: "2" })).rejects.toThrow('field "Id" is not editable')
    await expect(store.setField(task.id, { name: "Id", editable: true })).rejects.toThrow("not editable")
    await expect(store.update(task.id, { fields: [{ ...task.fields[0]!, value: "2" }] })).rejects.toThrow("not editable")
    // Unchanged locked fields pass through a full update.
    expect((await store.update(task.id, { title: "A2", fields: task.fields })).fields).toEqual(task.fields)

    // Added later, it locks from then on.
    await store.setField(task.id, { name: "Ref", value: "r", editable: false })
    await expect(store.setField(task.id, { name: "Ref", value: "s" })).rejects.toThrow("not editable")

    expect((await store.update(task.id, { fields: [] })).fields).toEqual([])
  })
})

describe("templates", () => {
  test("CRUD, stored apart from tasks", async () => {
    const bug = await store.addTemplate({ name: "Bug", title: "Fix: ", fields: [{ type: "link", name: "Issue" }] })
    expect(bug).toMatchObject({ id: 1, name: "Bug", title: "Fix:", description: "", fields: [{ name: "Issue", value: "" }] })
    await store.addTemplate({ name: "Admin" })
    expect((await store.listTemplates()).map((t) => t.name)).toEqual(["Admin", "Bug"])
    expect(existsSync(store.templatesFile)).toBe(true)
    expect(existsSync(store.file)).toBe(false)

    await expect(store.addTemplate({ name: "Bug" })).rejects.toThrow('a template named "Bug" already exists')
    await expect(store.updateTemplate(1, { name: "Admin" })).rejects.toThrow("already exists")
    await expect(store.addTemplate({ name: " " })).rejects.toThrow("template name is required")

    expect(await store.updateTemplate("Bug", { name: "Defect", description: "Steps:", title: undefined })).toMatchObject({
      name: "Defect",
      title: "Fix:",
      description: "Steps:",
    })
    expect((await store.setTemplateField(1, { name: "Issue", value: "https://x", editable: false })).fields[0]).toMatchObject({
      type: "link",
      value: "https://x",
      editable: false,
    })
    // Not locked on a template.
    expect((await store.setTemplateField(1, { name: "Issue", value: "https://y" })).fields[0]!.value).toBe("https://y")
    expect((await store.removeTemplateField("Defect", "Issue")).fields).toEqual([])
    await expect(store.removeTemplateField(1, "Issue")).rejects.toThrow('template "Defect" has no field "Issue"')

    await store.removeTemplate("Defect")
    await expect(store.getTemplate(1)).rejects.toThrow("template 1 not found")
    await expect(store.getTemplate("Nope")).rejects.toThrow('template "Nope" not found')
  })

  test("addFromTemplate fills in from the template; explicit values win", async () => {
    await store.addTemplate({
      name: "Review",
      title: "Review PR",
      description: "Check tests",
      fields: [
        { type: "link", name: "PR", value: "https://default" },
        { type: "text", name: "Notes" },
      ],
    })
    const task = await store.addFromTemplate("Review", {
      title: "Review #42",
      targetDate: "2026-10-05",
      fields: [{ type: "link", name: "PR", value: "https://42" }],
    })
    expect(task).toMatchObject({ title: "Review #42", description: "Check tests", targetDate: "2026-10-05", status: "todo" })
    expect(task.fields.map((f) => [f.name, f.value])).toEqual([
      ["PR", "https://42"],
      ["Notes", ""],
    ])

    await store.addTemplate({ name: "Blank" })
    await expect(store.addFromTemplate("Blank")).rejects.toThrow("title is required")
  })
})

describe("applyTemplate", () => {
  const template = (fields: Partial<Template>): Template => ({
    id: 1,
    name: "T",
    title: "",
    description: "",
    fields: [],
    createdAt: "2026-10-03T09:00:00.000Z",
    updatedAt: "2026-10-03T09:00:00.000Z",
    ...fields,
  })
  const text = (name: string, value: string) => ({ type: "text" as const, name, value, editable: true, visibleOnLists: false, textbox: true })

  test("only non-empty template values override", () => {
    const values = { title: "Mine", description: "Mine too", fields: [text("A", "a"), text("B", "b")], extra: 1 }
    expect(applyTemplate(values, template({ description: "  " }))).toEqual(values)
    expect(
      applyTemplate(values, template({ title: "T", description: "D", fields: [text("B", "tb"), text("A", ""), text("C", "")] })),
    ).toEqual({ title: "T", description: "D", fields: [text("A", "a"), text("B", "tb"), text("C", "")], extra: 1 })
  })
})
