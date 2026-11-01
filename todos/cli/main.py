from __future__ import annotations

import sys
from typing import Any, List, Optional, TextIO

from todos.core import FIELD_TYPES, STATUS_LABELS, STATUSES, UNSET, VIEWS, TodoError, TodoStore

from .args import ArgsError, parse_args
from .terminal import terminal_safe, terminal_safe_json

USAGE = f"""corgi-todos - manage todos in ~/.corgiops/todos

Usage:
  corgi-todos list [--view <view>] [--status <status>]
  corgi-todos show <id>
  corgi-todos add --title <text> --description <text> [--status <status>] [--target-date <date>]
                  [--parent <id>]
  corgi-todos add --template <template> [--title <text>] [--description <text>] [...]
                                Start from a template; given options win over it
  corgi-todos update <id> [--title <text>] [--description <text>] [--status <status>]
                          [--target-date <date>] [--completion-date <date>] [--parent <id>]
  corgi-todos status <id> <status>
  corgi-todos postpone <id>     Set target date to tomorrow
  corgi-todos pull <id>         Set target date to today
  corgi-todos reopen <id>       Mark a done task in-progress for today
  corgi-todos rm <id>           Refused while the task has subtasks
  corgi-todos field set <id> --name <name> [--type <type>] [--value <text>] [--editable true|false]
                        [--visible-on-lists true|false] [--textbox true|false]
                                Add a custom field, or change the one with that name
  corgi-todos field rm <id> <name>
  corgi-todos comment add <id> --text <text>
  corgi-todos comment update <id> <comment-id> --text <text>
  corgi-todos comment rm <id> <comment-id>
                                Comments are listed by show, oldest first

  corgi-todos template list
  corgi-todos template show <template>
  corgi-todos template add --name <name> [--title <text>] [--description <text>]
  corgi-todos template update <template> [--name <name>] [--title <text>] [--description <text>]
  corgi-todos template rm <template>
  corgi-todos template field set <template> --name <name> [field options as above]
  corgi-todos template field rm <template> <name>

Options:
  --json        Print JSON instead of text
  -h, --help    Show this help

Views:    {", ".join(VIEWS)}
Statuses: {", ".join(STATUSES)}
Fields:   {", ".join(FIELD_TYPES)}; new fields default to text, editable, hidden on lists, textbox
Dates:    YYYY-MM-DD; target date defaults to today, completion date is set when a task is done
Ids:      tasks and templates have uuid ids; --parent <id> makes a subtask, --parent "" clears it
Templates are referred to by id or name. Empty template values leave the task's value alone."""

STRING_OPTIONS = [
    "title",
    "description",
    "status",
    "view",
    "target-date",
    "completion-date",
    "name",
    "type",
    "value",
    "editable",
    "visible-on-lists",
    "textbox",
    "template",
    "parent",
    "text",
]
FLAGS = {"json": None, "help": "h"}


class UsageError(Exception):
    pass


def parse_id(raw: Optional[str]) -> str:
    if not raw or not raw.strip():
        raise UsageError("missing task id")
    return raw.strip()


def parse_status(raw: Optional[str]) -> str:
    if raw not in STATUSES:
        raise UsageError(f"invalid status: {raw if raw is not None else '(missing)'} (expected {', '.join(STATUSES)})")
    return raw


def parse_view(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    if raw not in VIEWS:
        raise UsageError(f"invalid view: {raw} (expected {', '.join(VIEWS)})")
    return raw


def parse_field_type(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    if raw not in FIELD_TYPES:
        raise UsageError(f"invalid field type: {raw} (expected {', '.join(FIELD_TYPES)})")
    return raw


def parse_bool(flag: str, raw: Optional[str]) -> Optional[bool]:
    if raw is None:
        return None
    if raw not in ("true", "false"):
        raise UsageError(f"--{flag} must be true or false")
    return raw == "true"


def parse_template_ref(raw: Optional[str]) -> str:
    if not raw or not raw.strip():
        raise UsageError("missing template id or name")
    return raw


def format_field(f: dict) -> str:
    return f"{f['name']} ({f['type']}{'' if f['editable'] else ', locked'}): {f['value']}"


def format_line(t: dict) -> str:
    return f"{t['id']}  {STATUS_LABELS[t['status']]:<11}  {t.get('completionDate') or t['targetDate']}  {t['title']}"


def format_detail(t: dict) -> str:
    lines = [
        f"{t['id']} {t['title']}",
        f"Status:  {STATUS_LABELS[t['status']]}",
        f"Target:  {t['targetDate']}",
        *([f"Parent:  {t['parentId']}"] if t.get("parentId") else []),
        *([f"Subtasks: {', '.join(t['subtaskIds'])}"] if t["subtaskIds"] else []),
        *([f"Done:    {t['completionDate']}"] if t.get("completionDate") else []),
        *map(format_field, t["fields"]),
        f"Created: {t['createdAt']}",
        f"Updated: {t['updatedAt']}",
        "",
        t["description"],
    ]
    if t["comments"]:
        lines += ["", "Comments:"]
    for c in t["comments"]:
        edited = "" if c["updatedAt"] == c["createdAt"] else f" (edited {c['updatedAt']})"
        lines.append(f"  {c['id']}  {c['createdAt']}{edited}")
        lines += [f"    {line}" for line in c["text"].split("\n")]
    return "\n".join(lines)


def format_template_line(t: dict) -> str:
    title = f"  ({t['title']})" if t["title"] else ""
    return f"{t['id']}  {t['name']}{title}"


def format_template(t: dict) -> str:
    return "\n".join(
        [
            f"{t['id']} {t['name']}",
            f"Title:   {t['title']}",
            *map(format_field, t["fields"]),
            f"Created: {t['createdAt']}",
            f"Updated: {t['updatedAt']}",
            "",
            t["description"],
        ]
    )


def run(argv: List[str], store: Optional[TodoStore] = None, out: TextIO = sys.stdout) -> None:
    options, positionals = parse_args(argv, STRING_OPTIONS, FLAGS)
    get = options.get
    command, args = (positionals[0], positionals[1:]) if positionals else (None, [])
    if options["help"] or command is None:
        print(USAGE, file=out)
        return

    store = store or TodoStore()
    status = None if get("status") is None else parse_status(get("status"))
    view = parse_view(get("view"))
    target_date = get("target-date")
    completion_date = get("completion-date")
    # "" clears the parent.
    parent_id: Any = UNSET if get("parent") is None else (get("parent").strip() or None)
    title, description = get("title"), get("description")

    def show(result: Any, text: str) -> None:
        print(terminal_safe_json(result) if options["json"] else terminal_safe(text), file=out)

    def show_task(task: dict, verb: str) -> None:
        show(task, f"{verb} {task['id']} {task['title']}")

    def show_template(template: dict, verb: str) -> None:
        show(template, f"{verb} template {template['id']} {template['name']}")

    def field_patch() -> dict:
        if get("name") is None:
            raise UsageError("field set requires --name")
        return {
            "name": get("name"),
            "type": parse_field_type(get("type")),
            "value": get("value"),
            "editable": parse_bool("editable", get("editable")),
            "visible_on_lists": parse_bool("visible-on-lists", get("visible-on-lists")),
            "textbox": parse_bool("textbox", get("textbox")),
        }

    def template(action: Optional[str], rest: List[str]) -> None:
        name = get("name")
        ref = rest[0] if rest else None
        if action in ("list", "ls"):
            templates = store.list_templates()
            show(templates, "\n".join(map(format_template_line, templates)) if templates else "No templates.")
        elif action == "show":
            found = store.get_template(parse_template_ref(ref))
            show(found, format_template(found))
        elif action == "add":
            if name is None:
                raise UsageError("template add requires --name")
            show_template(store.add_template(name=name, title=title, description=description), "Added")
        elif action == "update":
            if name is None and title is None and description is None:
                raise UsageError("template update requires at least one of --name, --title, --description")
            show_template(store.update_template(parse_template_ref(ref), name=name, title=title, description=description), "Updated")
        elif action in ("rm", "delete"):
            show_template(store.remove_template(parse_template_ref(ref)), "Removed")
        elif action == "field":
            field_action, ref, field_name = (rest + [None, None, None])[:3]
            if field_action == "set":
                patch = field_patch()
                updated = store.set_template_field(parse_template_ref(ref), **patch)
                show(updated, f'template "{updated["name"]}" field "{patch["name"].strip()}" set')
            elif field_action == "rm":
                if field_name is None:
                    raise UsageError("template field rm requires a field name")
                updated = store.remove_template_field(parse_template_ref(ref), field_name)
                show(updated, f'template "{updated["name"]}" field "{field_name}" removed')
            else:
                raise UsageError(f"unknown template field action: {field_action or '(missing)'} (expected set, rm)")
        else:
            raise UsageError(f"unknown template action: {action or '(missing)'} (expected list, show, add, update, rm, field)")

    arg = lambda index: args[index] if len(args) > index else None  # noqa: E731
    task_input = dict(status=status, target_date=target_date, completion_date=completion_date, parent_id=parent_id)

    if command in ("list", "ls"):
        tasks = store.list(status=status, view=view)
        show(tasks, "\n".join(map(format_line, tasks)) if tasks else "No tasks.")
    elif command == "show":
        task = store.get_with_subtasks(parse_id(arg(0)))
        show(task, format_detail(task))
    elif command == "add":
        if get("template") is not None:
            show_task(store.add_from_template(parse_template_ref(get("template")), title=title, description=description, **task_input), "Added")
            return
        if title is None or description is None:
            raise UsageError("add requires --title and --description")
        show_task(store.add(title=title, description=description, **task_input), "Added")
    elif command == "update":
        if parent_id is UNSET and all(v is None for v in [title, description, status, target_date, completion_date]):
            raise UsageError("update requires at least one field option")
        show_task(store.update(parse_id(arg(0)), title=title, description=description, **task_input), "Updated")
    elif command == "status":
        task = store.set_status(parse_id(arg(0)), parse_status(arg(1)))
        show(task, f"{task['id']} -> {STATUS_LABELS[task['status']]}")
    elif command == "postpone":
        task = store.postpone(parse_id(arg(0)))
        show(task, f"{task['id']} target -> {task['targetDate']}")
    elif command == "pull":
        task = store.pull_to_today(parse_id(arg(0)))
        show(task, f"{task['id']} target -> {task['targetDate']}")
    elif command == "reopen":
        show_task(store.reopen(parse_id(arg(0))), "Reopened")
    elif command in ("rm", "delete"):
        show_task(store.remove(parse_id(arg(0))), "Removed")
    elif command == "field":
        action, id_, name = arg(0), parse_id(arg(1)), arg(2)
        if action == "set":
            patch = field_patch()
            task = store.set_field(id_, **patch)
            show(task, f'{task["id"]} field "{patch["name"].strip()}" set')
        elif action == "rm":
            if name is None:
                raise UsageError("field rm requires a field name")
            show(store.remove_field(id_, name), f'{id_} field "{name}" removed')
        else:
            raise UsageError(f"unknown field action: {action or '(missing)'} (expected set, rm)")
    elif command == "comment":
        action, id_, comment_id = arg(0), parse_id(arg(1)), arg(2)

        def text() -> str:
            if get("text") is None:
                raise UsageError(f"comment {action} requires --text")
            return get("text")

        if action == "add":
            task = store.add_comment(id_, text())
            show(task, f"{task['id']} comment {task['comments'][-1]['id']} added")
        elif action in ("update", "rm"):
            if not comment_id:
                raise UsageError(f"comment {action} requires a comment id")
            if action == "update":
                show(store.update_comment(id_, comment_id, text()), f"{id_} comment {comment_id} updated")
            else:
                show(store.remove_comment(id_, comment_id), f"{id_} comment {comment_id} removed")
        else:
            raise UsageError(f"unknown comment action: {action or '(missing)'} (expected add, update, rm)")
    elif command == "template":
        template(arg(0), args[1:])
    else:
        raise UsageError(f"unknown command: {command}")


def main(argv: Optional[List[str]] = None, store: Optional[TodoStore] = None, out: TextIO = sys.stdout, err: TextIO = sys.stderr) -> int:
    """Runs one command; returns the exit code (2 for usage errors, 1 for TodoError)."""
    try:
        run(sys.argv[1:] if argv is None else argv, store, out)
        return 0
    except (UsageError, ArgsError, TodoError) as error:
        usage = not isinstance(error, TodoError)
        print(f"error: {terminal_safe(str(error))}", file=err)
        if usage:
            print(f"\n{USAGE}", file=err)
        return 2 if usage else 1
