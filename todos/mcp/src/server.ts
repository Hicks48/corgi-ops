import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { FIELD_TYPES, StatusSchema, TodoError, TodoStore, VIEWS } from "@corgiops/todos-core"
import { z } from "zod"

const id = z.string().describe("Task id (uuid)")
const title = z.string().describe("Short task title (non-empty)")
const description = z.string().describe("What the task involves (non-empty)")
const status = StatusSchema.describe("Task status")
const targetDate = z.string().describe("Day the task is planned for, YYYY-MM-DD (local). Defaults to today.")
const completionDate = z.string().describe("Day the task was completed, YYYY-MM-DD. Only valid when status is done.")
const parentId = z
  .string()
  .nullable()
  .describe("Id of the parent task, making this a subtask; null for none. Must exist and not create a cycle.")
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
const template = z.string().describe("Template id (uuid), or its exact name")
const templateName = z.string().describe("Template name (non-empty, unique)")
const templateTitle = z.string().describe('Title given to tasks made from the template; "" leaves the task\'s own')
const templateDescription = z.string().describe('Description given to tasks made from the template; "" leaves the task\'s own')
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
    {
      description: "Get one task by id, with `subtaskIds`: ids of the tasks that have it as parent.",
      inputSchema: { id },
      annotations: { readOnlyHint: true },
    },
    ({ id }) => run(() => store.getWithSubtasks(id)),
  )

  server.registerTool(
    "add_task",
    {
      description:
        "Create a task. Title and description are required unless a template provides them. Status defaults to todo, target date to today. With a template, its non-empty title, description and fields are used; values given here win (fields by name).",
      inputSchema: {
        template: template.optional(),
        title: title.optional(),
        description: description.optional(),
        status: status.optional(),
        targetDate: targetDate.optional(),
        completionDate: completionDate.optional(),
        parentId: parentId.optional(),
        fields: z.array(field).optional().describe("Custom fields, in display order"),
      },
    },
    ({ template, title = "", description = "", ...input }) =>
      run(() =>
        template === undefined
          ? store.add({ title, description, ...input })
          : store.addFromTemplate(template, { title: title || undefined, description: description || undefined, ...input }),
      ),
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
        parentId: parentId.optional(),
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
      description: "Permanently delete a task. Refused while other tasks have it as parent. Returns the deleted task.",
      inputSchema: { id },
      annotations: { destructiveHint: true },
    },
    ({ id }) => run(() => store.remove(id)),
  )

  server.registerTool(
    "list_templates",
    {
      description: "List task templates (starting points for new tasks), sorted by name.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => run(() => store.listTemplates()),
  )

  server.registerTool(
    "get_template",
    { description: "Get one template by id or name.", inputSchema: { template }, annotations: { readOnlyHint: true } },
    ({ template }) => run(() => store.getTemplate(template)),
  )

  server.registerTool(
    "add_template",
    {
      description: "Create a task template. Only the name is required.",
      inputSchema: {
        name: templateName,
        title: templateTitle.optional(),
        description: templateDescription.optional(),
        fields: z.array(field).optional().describe("Custom fields, in display order"),
      },
    },
    (input) => run(() => store.addTemplate(input)),
  )

  server.registerTool(
    "update_template",
    {
      description: "Change a template. Omitted values are left unchanged.",
      inputSchema: {
        template,
        name: templateName.optional(),
        title: templateTitle.optional(),
        description: templateDescription.optional(),
      },
      annotations: { idempotentHint: true },
    },
    ({ template, ...patch }) => run(() => store.updateTemplate(template, patch)),
  )

  server.registerTool(
    "set_template_field",
    {
      description:
        "Add a custom field to a template, or change the existing one with this name. Omitted options keep their current value (new fields default to type text).",
      inputSchema: { template, name: fieldName, type: fieldOptions.type.optional(), ...optionalFieldOptions },
      annotations: { idempotentHint: true },
    },
    ({ template, ...patch }) => run(() => store.setTemplateField(template, patch)),
  )

  server.registerTool(
    "remove_template_field",
    {
      description: "Remove a custom field from a template by name.",
      inputSchema: { template, name: fieldName },
      annotations: { destructiveHint: true },
    },
    ({ template, name }) => run(() => store.removeTemplateField(template, name)),
  )

  server.registerTool(
    "delete_template",
    {
      description: "Permanently delete a template. Tasks made from it are unaffected. Returns the deleted template.",
      inputSchema: { template },
      annotations: { destructiveHint: true },
    },
    ({ template }) => run(() => store.removeTemplate(template)),
  )

  return server
}
