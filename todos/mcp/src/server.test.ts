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
    "add_template",
    "delete_task",
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
    "update_template",
  ])
})

test("full task lifecycle", async () => {
  const added = JSON.parse((await call("add_task", { title: "Walk corgi", description: "Around the block" })).text)
  expect(added).toMatchObject({ id: 1, status: "todo", targetDate: "2026-10-03" })

  await call("set_task_status", { id: 1, status: "in-progress" })
  await call("update_task", { id: 1, title: "Walk the corgi" })
  expect(JSON.parse((await call("get_task", { id: 1 })).text)).toMatchObject({
    title: "Walk the corgi",
    description: "Around the block",
    status: "in-progress",
  })
  expect(JSON.parse((await call("list_tasks", { status: "todo" })).text)).toEqual([])

  expect(JSON.parse((await call("list_tasks", { view: "current" })).text)).toHaveLength(1)
  expect(JSON.parse((await call("postpone_task", { id: 1 })).text).targetDate).toBe("2026-10-04")
  expect(JSON.parse((await call("list_tasks", { view: "upcoming" })).text)).toHaveLength(1)
  await call("pull_task_to_today", { id: 1 })
  expect(JSON.parse((await call("set_task_status", { id: 1, status: "done" })).text).completionDate).toBe("2026-10-03")
  expect(JSON.parse((await call("reopen_task", { id: 1 })).text)).toMatchObject({ status: "in-progress" })

  await call("delete_task", { id: 1 })
  expect(JSON.parse((await call("list_tasks")).text)).toEqual([])
})

test("domain errors come back as tool errors", async () => {
  expect(await call("get_task", { id: 99 })).toEqual({ isError: true, text: "task 99 not found" })
  const blank = await call("add_task", { title: " ", description: "x" })
  expect(blank).toEqual({ isError: true, text: "title is required" })
})

test("custom fields", async () => {
  const fields = [{ type: "link", name: "PR", value: "https://example.com", editable: false }]
  const added = JSON.parse((await call("add_task", { title: "Review", description: "x", fields })).text)
  expect(added.fields).toEqual([{ type: "link", name: "PR", value: "https://example.com", editable: false, visibleOnLists: false }])

  expect(await call("set_task_field", { id: 1, name: "PR", value: "y" })).toEqual({ isError: true, text: 'field "PR" is not editable' })
  const set = JSON.parse((await call("set_task_field", { id: 1, name: "Due", type: "date", value: "2026-10-09" })).text)
  expect(set.fields.map((f: { name: string }) => f.name)).toEqual(["PR", "Due"])
  const removed = JSON.parse((await call("remove_task_field", { id: 1, name: "PR" })).text)
  expect(removed.fields).toEqual([{ type: "date", name: "Due", value: "2026-10-09", editable: true, visibleOnLists: false }])
})

test("templates", async () => {
  const fields = [{ type: "text", name: "Notes", value: "from template" }]
  const added = JSON.parse((await call("add_template", { name: "Walk", title: "Walk corgi", fields })).text)
  expect(added).toMatchObject({ id: 1, name: "Walk", title: "Walk corgi", description: "" })
  await call("update_template", { template: "Walk", description: "Around the block" })
  await call("set_template_field", { template: 1, name: "Route", type: "link" })
  expect(JSON.parse((await call("list_templates")).text).map((t: { name: string }) => t.name)).toEqual(["Walk"])
  expect(JSON.parse((await call("get_template", { template: 1 })).text).fields).toHaveLength(2)

  const task = JSON.parse((await call("add_task", { template: "Walk", title: "Evening walk" })).text)
  expect(task).toMatchObject({ title: "Evening walk", description: "Around the block" })
  expect(task.fields.map((f: { name: string }) => f.name)).toEqual(["Notes", "Route"])
  expect(await call("add_task", { title: "x" })).toEqual({ isError: true, text: "description is required" })

  await call("remove_template_field", { template: "Walk", name: "Route" })
  await call("delete_template", { template: "Walk" })
  expect(await call("get_template", { template: "Walk" })).toEqual({ isError: true, text: 'template "Walk" not found' })
})
