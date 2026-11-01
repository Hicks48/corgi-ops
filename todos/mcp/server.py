from __future__ import annotations

import json
from typing import Any, Callable, Optional

from todos.core import FIELD_TYPES, STATUSES, UNSET, VIEWS, TodoError, TodoStore

from .protocol import McpServer, ToolResult, array, boolean, enum, nullable, obj, string, text_result

id_ = string("Task id (uuid)")
title = string("Short task title (non-empty)")
description = string("What the task involves (non-empty)")
status = enum(STATUSES, "Task status")
target_date = string("Day the task is planned for, YYYY-MM-DD (local). Defaults to today.")
completion_date = string("Day the task was completed, YYYY-MM-DD. Only valid when status is done.")
parent_id = nullable(string("Id of the parent task, making this a subtask; null for none. Must exist and not create a cycle."))
comment_id = string("Comment id (uuid), from the task's comments")
comment_text = string("Comment text (non-empty)")
field_name = string("Field name, unique within the task")
field_options = {
    "type": enum(FIELD_TYPES, "text = free text; link = http(s) URL; date = YYYY-MM-DD; timestamp = ISO 8601 date-time"),
    "value": string('Field value; "" for empty'),
    "editable": boolean("false locks the field (no changes after it is saved). Default true."),
    "visibleOnLists": boolean("Show on the UI list views. Default false."),
    "textbox": boolean("text fields only: multiline (true, default) or single line"),
}
optional_field_options = {key: field_options[key] for key in ("value", "editable", "visibleOnLists", "textbox")}
field = obj({"name": field_name, "type": field_options["type"], **optional_field_options}, ["name", "type"])
fields = array(field, "Custom fields, in display order")
template = string("Template id (uuid), or its exact name")
template_name = string("Template name (non-empty, unique)")
template_title = string("Title given to tasks made from the template; \"\" leaves the task's own")
template_description = string("Description given to tasks made from the template; \"\" leaves the task's own")
view = enum(
    VIEWS,
    "current = not done and target date today or earlier (today's work); upcoming = not done, target date after today; completed = done, newest first",
)


def run(fn: Callable[[], Any]) -> ToolResult:
    try:
        return text_result(json.dumps(fn(), indent=2, ensure_ascii=False))
    except TodoError as err:
        return text_result(str(err), is_error=True)


def task_args(args: dict) -> dict:
    """Optional task arguments as store keywords. A null parentId clears the parent; absent leaves it."""
    return {
        "status": args.get("status"),
        "target_date": args.get("targetDate"),
        "completion_date": args.get("completionDate"),
        "parent_id": args.get("parentId", UNSET),
    }


def field_args(args: dict) -> dict:
    return {
        "name": args["name"],
        "type": args.get("type"),
        "value": args.get("value"),
        "editable": args.get("editable"),
        "visible_on_lists": args.get("visibleOnLists"),
        "textbox": args.get("textbox"),
    }


def create_server(store: Optional[TodoStore] = None) -> McpServer:
    store = store or TodoStore()
    server = McpServer("corgi-todos", "0.1.0")

    @server.tool(
        "list_tasks",
        "List the user's todo tasks, optionally restricted to a list view and/or status.",
        {"view": view, "status": status},
        annotations={"readOnlyHint": True},
    )
    def list_tasks(args):
        return run(lambda: store.list(status=args.get("status"), view=args.get("view")))

    @server.tool(
        "get_task",
        "Get one task by id, with `subtaskIds`: ids of the tasks that have it as parent.",
        {"id": id_},
        ["id"],
        annotations={"readOnlyHint": True},
    )
    def get_task(args):
        return run(lambda: store.get_with_subtasks(args["id"]))

    @server.tool(
        "add_task",
        "Create a task. Title and description are required unless a template provides them. Status defaults to todo, target date to today. With a template, its non-empty title, description and fields are used; values given here win (fields by name).",
        {
            "template": template,
            "title": title,
            "description": description,
            "status": status,
            "targetDate": target_date,
            "completionDate": completion_date,
            "parentId": parent_id,
            "fields": fields,
        },
    )
    def add_task(args):
        if "template" not in args:
            return run(lambda: store.add(title=args.get("title", ""), description=args.get("description", ""), fields=args.get("fields"), **task_args(args)))
        return run(
            lambda: store.add_from_template(
                args["template"],
                title=args.get("title") or None,
                description=args.get("description") or None,
                fields=args.get("fields"),
                **task_args(args),
            )
        )

    @server.tool(
        "update_task",
        "Change task fields. Omitted fields are left unchanged. Setting status to done records today as the completion date unless given; leaving done clears it.",
        {
            "id": id_,
            "title": title,
            "description": description,
            "status": status,
            "targetDate": target_date,
            "completionDate": completion_date,
            "parentId": parent_id,
        },
        ["id"],
        annotations={"idempotentHint": True},
    )
    def update_task(args):
        return run(lambda: store.update(args["id"], title=args.get("title"), description=args.get("description"), **task_args(args)))

    @server.tool(
        "set_task_field",
        "Add a custom field to a task, or change the existing one with this name. Omitted options keep their current value (new fields default to type text). Non-editable fields can't be changed.",
        {"id": id_, "name": field_name, "type": field_options["type"], **optional_field_options},
        ["id", "name"],
        annotations={"idempotentHint": True},
    )
    def set_task_field(args):
        return run(lambda: store.set_field(args["id"], **field_args(args)))

    @server.tool(
        "remove_task_field",
        "Remove a custom field from a task by name (also works for non-editable fields).",
        {"id": id_, "name": field_name},
        ["id", "name"],
        annotations={"destructiveHint": True},
    )
    def remove_task_field(args):
        return run(lambda: store.remove_field(args["id"], args["name"]))

    @server.tool(
        "add_task_comment",
        "Add a comment (e.g. a progress note) to a task. Comments are returned with the task, oldest first.",
        {"id": id_, "text": comment_text},
        ["id", "text"],
    )
    def add_task_comment(args):
        return run(lambda: store.add_comment(args["id"], args["text"]))

    @server.tool(
        "update_task_comment",
        "Change a comment's text.",
        {"id": id_, "commentId": comment_id, "text": comment_text},
        ["id", "commentId", "text"],
        annotations={"idempotentHint": True},
    )
    def update_task_comment(args):
        return run(lambda: store.update_comment(args["id"], args["commentId"], args["text"]))

    @server.tool(
        "delete_task_comment",
        "Permanently delete a comment from a task.",
        {"id": id_, "commentId": comment_id},
        ["id", "commentId"],
        annotations={"destructiveHint": True},
    )
    def delete_task_comment(args):
        return run(lambda: store.remove_comment(args["id"], args["commentId"]))

    @server.tool(
        "set_task_status",
        "Move a task to todo, in-progress or done.",
        {"id": id_, "status": status},
        ["id", "status"],
        annotations={"idempotentHint": True},
    )
    def set_task_status(args):
        return run(lambda: store.set_status(args["id"], args["status"]))

    @server.tool("postpone_task", "Push a task out of today: target date becomes tomorrow.", {"id": id_}, ["id"])
    def postpone_task(args):
        return run(lambda: store.postpone(args["id"]))

    @server.tool(
        "pull_task_to_today",
        "Set a task's target date to today.",
        {"id": id_},
        ["id"],
        annotations={"idempotentHint": True},
    )
    def pull_task_to_today(args):
        return run(lambda: store.pull_to_today(args["id"]))

    @server.tool(
        "reopen_task",
        "Reopen a done task: status in-progress, completion date cleared, target date today.",
        {"id": id_},
        ["id"],
        annotations={"idempotentHint": True},
    )
    def reopen_task(args):
        return run(lambda: store.reopen(args["id"]))

    @server.tool(
        "delete_task",
        "Permanently delete a task. Refused while other tasks have it as parent. Returns the deleted task.",
        {"id": id_},
        ["id"],
        annotations={"destructiveHint": True},
    )
    def delete_task(args):
        return run(lambda: store.remove(args["id"]))

    @server.tool(
        "list_templates",
        "List task templates (starting points for new tasks), sorted by name.",
        {},
        annotations={"readOnlyHint": True},
    )
    def list_templates(args):
        return run(store.list_templates)

    @server.tool(
        "get_template",
        "Get one template by id or name.",
        {"template": template},
        ["template"],
        annotations={"readOnlyHint": True},
    )
    def get_template(args):
        return run(lambda: store.get_template(args["template"]))

    @server.tool(
        "add_template",
        "Create a task template. Only the name is required.",
        {"name": template_name, "title": template_title, "description": template_description, "fields": fields},
        ["name"],
    )
    def add_template(args):
        return run(lambda: store.add_template(args["name"], title=args.get("title"), description=args.get("description"), fields=args.get("fields")))

    @server.tool(
        "update_template",
        "Change a template. Omitted values are left unchanged.",
        {"template": template, "name": template_name, "title": template_title, "description": template_description},
        ["template"],
        annotations={"idempotentHint": True},
    )
    def update_template(args):
        return run(
            lambda: store.update_template(args["template"], name=args.get("name"), title=args.get("title"), description=args.get("description"))
        )

    @server.tool(
        "set_template_field",
        "Add a custom field to a template, or change the existing one with this name. Omitted options keep their current value (new fields default to type text).",
        {"template": template, "name": field_name, "type": field_options["type"], **optional_field_options},
        ["template", "name"],
        annotations={"idempotentHint": True},
    )
    def set_template_field(args):
        return run(lambda: store.set_template_field(args["template"], **field_args(args)))

    @server.tool(
        "remove_template_field",
        "Remove a custom field from a template by name.",
        {"template": template, "name": field_name},
        ["template", "name"],
        annotations={"destructiveHint": True},
    )
    def remove_template_field(args):
        return run(lambda: store.remove_template_field(args["template"], args["name"]))

    @server.tool(
        "delete_template",
        "Permanently delete a template. Tasks made from it are unaffected. Returns the deleted template.",
        {"template": template},
        ["template"],
        annotations={"destructiveHint": True},
    )
    def delete_template(args):
        return run(lambda: store.remove_template(args["template"]))

    return server
