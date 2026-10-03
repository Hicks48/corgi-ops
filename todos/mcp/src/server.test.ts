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
    "delete_task",
    "get_task",
    "list_tasks",
    "postpone_task",
    "pull_task_to_today",
    "reopen_task",
    "set_task_status",
    "update_task",
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
