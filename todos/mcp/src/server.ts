import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { FIELD_TYPES, StatusSchema, TodoError, TodoStore, VIEWS } from "@corgiops/todos-core"
import { z } from "zod"

const id = z.number().int().positive().describe("Task id")
const title = z.string().describe("Short task title (non-empty)")
const description = z.string().describe("What the task involves (non-empty)")
const status = StatusSchema.describe("Task status")
const targetDate = z.string().describe("Day the task is planned for, YYYY-MM-DD (local). Defaults to today.")
const completionDate = z.string().describe("Day the task was completed, YYYY-MM-DD. Only valid when status is done.")
const fieldName = z.string().describe("Field name, unique within the task")
const fieldOptions = {
  type: z
    .enum(FIELD_TYPES)
    .describe("text = free text; link = URL; date = YYYY-MM-DD; timestamp = ISO 8601 date-time"),
  value: z.string().describe('Field value; "" for empty'),
  editable: z.boolean().describe("false locks the field (no changes after it is saved). Default true."),
  visibleOnLists: z.boolean().describe("Show on the TUI list views. Default false."),
  textbox: z.boolean().describe("text fields only: multiline (true, default) or single line"),
}
const optionalFieldOptions = {
  value: fieldOptions.value.optional(),
  editable: fieldOptions.editable.optional(),
  visibleOnLists: fieldOptions.visibleOnLists.optional(),
  textbox: fieldOptions.textbox.optional(),
}
const field = z.object({ name: fieldName, type: fieldOptions.type, ...optionalFieldOptions })
const view = z
  .enum(VIEWS)
  .describe(
    "current = not done and target date today or earlier (today's work); upcoming = not done, target date after today; completed = done, newest first",
  )

const run = async (fn: () => Promise<unknown>): Promise<CallToolResult> => {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await fn(), null, 2) }] }
  } catch (err) {
    if (!(err instanceof TodoError)) throw err
    return { content: [{ type: "text", text: err.message }], isError: true }
  }
}

export function createServer(store: TodoStore = new TodoStore()): McpServer {
  const server = new McpServer({ name: "corgi-todos", version: "0.1.0" })

  server.registerTool(
    "list_tasks",
    {
      description: "List the user's todo tasks, optionally restricted to a list view and/or status.",
      inputSchema: { view: view.optional(), status: status.optional() },
      annotations: { readOnlyHint: true },
    },
    (filter) => run(() => store.list(filter)),
  )

  server.registerTool(
    "get_task",
    { description: "Get one task by id.", inputSchema: { id }, annotations: { readOnlyHint: true } },
    ({ id }) => run(() => store.get(id)),
  )

  server.registerTool(
    "add_task",
    {
      description:
        "Create a task. Title and description are required. Status defaults to todo, target date to today.",
      inputSchema: {
        title,
        description,
        status: status.optional(),
        targetDate: targetDate.optional(),
        completionDate: completionDate.optional(),
        fields: z.array(field).optional().describe("Custom fields, in display order"),
      },
    },
    (input) => run(() => store.add(input)),
  )

  server.registerTool(
    "update_task",
    {
      description:
        "Change task fields. Omitted fields are left unchanged. Setting status to done records today as the completion date unless given; leaving done clears it.",
      inputSchema: {
        id,
        title: title.optional(),
        description: description.optional(),
        status: status.optional(),
        targetDate: targetDate.optional(),
        completionDate: completionDate.optional(),
      },
      annotations: { idempotentHint: true },
    },
    ({ id, ...patch }) => run(() => store.update(id, patch)),
  )

  server.registerTool(
    "set_task_field",
    {
      description:
        "Add a custom field to a task, or change the existing one with this name. Omitted options keep their current value (new fields default to type text). Non-editable fields can't be changed.",
      inputSchema: {
        id,
        name: fieldName,
        type: fieldOptions.type.optional(),
        ...optionalFieldOptions,
      },
      annotations: { idempotentHint: true },
    },
    ({ id, ...patch }) => run(() => store.setField(id, patch)),
  )

  server.registerTool(
    "remove_task_field",
    {
      description: "Remove a custom field from a task by name (also works for non-editable fields).",
      inputSchema: { id, name: fieldName },
      annotations: { destructiveHint: true },
    },
    ({ id, name }) => run(() => store.removeField(id, name)),
  )

  server.registerTool(
    "set_task_status",
    {
      description: "Move a task to todo, in-progress or done.",
      inputSchema: { id, status },
      annotations: { idempotentHint: true },
    },
    ({ id, status }) => run(() => store.setStatus(id, status)),
  )

  server.registerTool(
    "postpone_task",
    {
      description: "Push a task out of today: target date becomes tomorrow.",
      inputSchema: { id },
    },
    ({ id }) => run(() => store.postpone(id)),
  )

  server.registerTool(
    "pull_task_to_today",
    { description: "Set a task's target date to today.", inputSchema: { id }, annotations: { idempotentHint: true } },
    ({ id }) => run(() => store.pullToToday(id)),
  )

  server.registerTool(
    "reopen_task",
    {
      description: "Reopen a done task: status in-progress, completion date cleared, target date today.",
      inputSchema: { id },
      annotations: { idempotentHint: true },
    },
    ({ id }) => run(() => store.reopen(id)),
  )

  server.registerTool(
    "delete_task",
    {
      description: "Permanently delete a task. Returns the deleted task.",
      inputSchema: { id },
      annotations: { destructiveHint: true },
    },
    ({ id }) => run(() => store.remove(id)),
  )

  return server
}
