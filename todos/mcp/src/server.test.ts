import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { TodoStore } from "@corgiops/todos-core"
import { createServer } from "./server.ts"

let root: string
let client: Client

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "corgiops-"))
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await createServer(new TodoStore({ dir: join(root, "todos"), now: () => new Date(2026, 9, 3, 12) })).connect(serverTransport)
  client = new Client({ name: "test", version: "0.0.0" })
  await client.connect(clientTransport)
})

afterEach(async () => {
  await client.close()
  await rm(root, { recursive: true, force: true })
})

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args })
  const text = (result.content as { text: string }[])[0]!.text
  return { isError: result.isError === true, text }
}

test("exposes the task tools", async () => {
  const { tools } = await client.listTools()
  expect(tools.map((t) => t.name).sort()).toEqual([
    "add_task",
    "add_task_comment",
    "add_template",
    "delete_task",
    "delete_task_comment",
    "delete_template",
    "get_task",
    "get_template",
    "list_tasks",
    "list_templates",
    "postpone_task",
    "pull_task_to_today",
    "remove_task_field",
    "remove_template_field",
    "reopen_task",
    "set_task_field",
    "set_task_status",
    "set_template_field",
    "update_task",
    "update_task_comment",
    "update_template",
  ])
})

test("full task lifecycle", async () => {
  const added = JSON.parse((await call("add_task", { title: "Walk corgi", description: "Around the block" })).text)
  expect(added).toMatchObject({ status: "todo", targetDate: "2026-10-03" })
  const id = added.id

  await call("set_task_status", { id, status: "in-progress" })
  await call("update_task", { id, title: "Walk the corgi" })
  expect(JSON.parse((await call("get_task", { id })).text)).toMatchObject({
    title: "Walk the corgi",
    description: "Around the block",
    status: "in-progress",
  })
  expect(JSON.parse((await call("list_tasks", { status: "todo" })).text)).toEqual([])

  expect(JSON.parse((await call("list_tasks", { view: "current" })).text)).toHaveLength(1)
  expect(JSON.parse((await call("postpone_task", { id })).text).targetDate).toBe("2026-10-04")
  expect(JSON.parse((await call("list_tasks", { view: "upcoming" })).text)).toHaveLength(1)
  await call("pull_task_to_today", { id })
  expect(JSON.parse((await call("set_task_status", { id, status: "done" })).text).completionDate).toBe("2026-10-03")
  expect(JSON.parse((await call("reopen_task", { id })).text)).toMatchObject({ status: "in-progress" })

  await call("delete_task", { id })
  expect(JSON.parse((await call("list_tasks")).text)).toEqual([])
})

test("domain errors come back as tool errors", async () => {
  expect(await call("get_task", { id: "nope" })).toEqual({ isError: true, text: "task nope not found" })
  const blank = await call("add_task", { title: " ", description: "x" })
  expect(blank).toEqual({ isError: true, text: "title is required" })
})

test("custom fields", async () => {
  const fields = [{ type: "link", name: "PR", value: "https://example.com", editable: false }]
  const added = JSON.parse((await call("add_task", { title: "Review", description: "x", fields })).text)
  const id = added.id
  expect(added.fields).toEqual([{ type: "link", name: "PR", value: "https://example.com", editable: false, visibleOnLists: false }])

  expect(await call("set_task_field", { id, name: "PR", value: "y" })).toEqual({ isError: true, text: 'field "PR" is not editable' })
  const set = JSON.parse((await call("set_task_field", { id, name: "Due", type: "date", value: "2026-10-09" })).text)
  expect(set.fields.map((f: { name: string }) => f.name)).toEqual(["PR", "Due"])
  const removed = JSON.parse((await call("remove_task_field", { id, name: "PR" })).text)
  expect(removed.fields).toEqual([{ type: "date", name: "Due", value: "2026-10-09", editable: true, visibleOnLists: false }])
})

test("templates", async () => {
  const fields = [{ type: "text", name: "Notes", value: "from template" }]
  const added = JSON.parse((await call("add_template", { name: "Walk", title: "Walk corgi", fields })).text)
  expect(added).toMatchObject({ name: "Walk", title: "Walk corgi", description: "" })
  await call("update_template", { template: "Walk", description: "Around the block" })
  await call("set_template_field", { template: added.id, name: "Route", type: "link" })
  expect(JSON.parse((await call("list_templates")).text).map((t: { name: string }) => t.name)).toEqual(["Walk"])
  expect(JSON.parse((await call("get_template", { template: added.id })).text).fields).toHaveLength(2)

  const task = JSON.parse((await call("add_task", { template: "Walk", title: "Evening walk" })).text)
  expect(task).toMatchObject({ title: "Evening walk", description: "Around the block" })
  expect(task.fields.map((f: { name: string }) => f.name)).toEqual(["Notes", "Route"])
  expect(await call("add_task", { title: "x" })).toEqual({ isError: true, text: "description is required" })

  await call("remove_template_field", { template: "Walk", name: "Route" })
  await call("delete_template", { template: "Walk" })
  expect(await call("get_template", { template: "Walk" })).toEqual({ isError: true, text: 'template "Walk" not found' })
})

test("subtasks", async () => {
  const parent = JSON.parse((await call("add_task", { title: "Groom", description: "All of it" })).text)
  const child = JSON.parse((await call("add_task", { title: "Brush", description: "Coat", parentId: parent.id })).text)
  expect(child.parentId).toBe(parent.id)
  expect(JSON.parse((await call("get_task", { id: parent.id })).text).subtaskIds).toEqual([child.id])
  expect(await call("delete_task", { id: parent.id })).toEqual({
    isError: true,
    text: `task ${parent.id} has 1 subtask; delete or move them first`,
  })
  expect(JSON.parse((await call("update_task", { id: child.id, parentId: null })).text).parentId).toBeUndefined()
  expect((await call("delete_task", { id: parent.id })).isError).toBe(false)
})

test("comments", async () => {
  const task = JSON.parse((await call("add_task", { title: "Walk", description: "Around" })).text)
  const added = JSON.parse((await call("add_task_comment", { id: task.id, text: "Left home" })).text)
  const [comment] = added.comments
  expect(comment).toMatchObject({ text: "Left home" })
  await call("update_task_comment", { id: task.id, commentId: comment.id, text: "Left home at 9" })
  expect(JSON.parse((await call("get_task", { id: task.id })).text).comments).toMatchObject([{ id: comment.id, text: "Left home at 9" }])
  expect(JSON.parse((await call("delete_task_comment", { id: task.id, commentId: comment.id })).text).comments).toEqual([])
  expect(await call("add_task_comment", { id: task.id, text: "" })).toEqual({ isError: true, text: "comment text is required" })
})
