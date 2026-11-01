from __future__ import annotations

import os
import threading
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Union

from .dates import LocalDate, add_days, to_iso, to_local_date
from .errors import TodoError
from .fields import CustomField, locked_field_change, parse_custom_field, parse_field_list, parse_field_patch
from .json_file import PRIVATE_DIR, JsonFile
from .paths import todos_dir
from .schema import (
    Comment,
    Task,
    comment_text,
    empty_todo_file,
    local_date,
    new_id,
    parent_id as parse_parent_id,
    parse_comment_input,
    parse_todo_file,
    status as parse_status,
)
from .templates import (
    Template,
    apply_template,
    empty_template_file,
    parse_template_file,
    template_name,
    template_title,
    upsert_fields,
)
from .validation import Issues, list_of, parse, required_text, string
from .views import tasks_in_view

FILE_NAME = "todos.json"
TEMPLATES_FILE_NAME = "templates.json"


class _Unset:
    def __repr__(self) -> str:
        return "UNSET"


UNSET: Any = _Unset()
"""Default of `parent_id`, where `None` means "clear the parent"."""

ParentId = Union[str, None, _Unset]

TemplateRef = str
"""A template by id, or by name."""

TaskWithSubtasks = Dict[str, Any]
"""A task plus `subtaskIds`: the ids of its direct subtasks, in creation order."""

_title = required_text("title is required")
_description = required_text("description is required")
_target_date = local_date("targetDate")
_completion_date = local_date("completionDate")


class _Input:
    """Collects issues across several arguments, so one error lists every problem like a schema would."""

    def __init__(self) -> None:
        self.issues = Issues()

    def __call__(self, parser, name: str, value: Any) -> Any:
        return None if value is None else parser(value, (name,), self.issues)

    def check(self) -> None:
        if self.issues.items:
            raise TodoError("; ".join(message for _, message in self.issues.items))


class TodoStore:
    """Sole owner of the on-disk todo data. CLI, MCP server and UI all go through this.

    Optional arguments left as `None` are "not given" (callers may pass them straight through), except
    `parent_id`: `None` clears the parent and `UNSET` (the default) leaves it alone.
    """

    def __init__(self, dir: Optional[str] = None, now: Optional[Callable[[], datetime]] = None):
        self.dir = dir or todos_dir()
        # Clock used for "today"; injectable for tests.
        self.now = now or datetime.now
        self._todos = JsonFile(self.dir, FILE_NAME, parse_todo_file, empty_todo_file)
        self._templates = JsonFile(self.dir, TEMPLATES_FILE_NAME, parse_template_file, empty_template_file)
        self.file = self._todos.path
        self.templates_file = self._templates.path

    def today(self) -> LocalDate:
        return to_local_date(self.now())

    def _timestamp(self) -> str:
        return to_iso(self.now())

    def list(self, status: Optional[str] = None, view: Optional[str] = None) -> List[Task]:
        """`view` restricts to a list view and returns tasks in that view's order."""
        tasks = self._todos.read()["tasks"]
        if view is not None:
            tasks = tasks_in_view(tasks, view, self.today())
        return [t for t in tasks if t["status"] == status] if status is not None else tasks

    def get(self, id: str) -> Task:
        return _find(self._todos.read(), id)

    def get_with_subtasks(self, id: str) -> TaskWithSubtasks:
        data = self._todos.read()
        task = _find(data, id)
        return {**task, "subtaskIds": [t["id"] for t in data["tasks"] if t.get("parentId") == id]}

    def add(
        self,
        title: str,
        description: str,
        status: Optional[str] = None,
        target_date: Optional[LocalDate] = None,
        completion_date: Optional[LocalDate] = None,
        fields: Optional[List[dict]] = None,
        parent_id: ParentId = UNSET,
    ) -> Task:
        arg = _Input()
        title = arg(_title, "title", "" if title is None else title)
        description = arg(_description, "description", "" if description is None else description)
        status = arg(parse_status, "status", status) or "todo"
        target_date = arg(_target_date, "targetDate", target_date)
        completion_date = arg(_completion_date, "completionDate", completion_date)
        fields = arg(parse_field_list, "fields", fields)
        parent = _parse_parent(arg, parent_id)
        arg.check()

        def run(data: dict) -> Task:
            now = self._timestamp()
            task: Task = {
                "id": new_id(),
                "title": title,
                "description": description,
                "status": status,
                "targetDate": target_date or self.today(),
                "fields": fields or [],
                "comments": [],
                "createdAt": now,
                "updatedAt": now,
            }
            self._apply_completion(task, completion_date, None)
            _apply_parent(data, task, parent)
            data["tasks"].append(task)
            return task

        return self._todos.mutate(run)

    def add_from_template(
        self,
        ref: TemplateRef,
        title: Optional[str] = None,
        description: Optional[str] = None,
        status: Optional[str] = None,
        target_date: Optional[LocalDate] = None,
        completion_date: Optional[LocalDate] = None,
        fields: Optional[List[dict]] = None,
        parent_id: ParentId = UNSET,
    ) -> Task:
        """Adds a task starting from a template. Values given here win over the template's."""
        template = _find_template(self._templates.read(), ref)
        base = apply_template({"title": "", "description": "", "fields": []}, template)
        explicit = [] if fields is None else parse(parse_field_list, fields)
        return self.add(
            title=base["title"] if title is None else title,
            description=base["description"] if description is None else description,
            status=status,
            target_date=target_date,
            completion_date=completion_date,
            fields=upsert_fields(base["fields"], explicit),
            parent_id=parent_id,
        )

    def update(
        self,
        id: str,
        title: Optional[str] = None,
        description: Optional[str] = None,
        status: Optional[str] = None,
        target_date: Optional[LocalDate] = None,
        completion_date: Optional[LocalDate] = None,
        fields: Optional[List[dict]] = None,
        parent_id: ParentId = UNSET,
        comments: Optional[List[dict]] = None,
    ) -> Task:
        """
        `fields` replaces the whole list. `comments` replaces the list too: listed ids are kept (text
        updated), new ones (without id) added, missing ones removed.
        """
        arg = _Input()
        changes = {
            "title": arg(_title, "title", title),
            "description": arg(_description, "description", description),
            "status": arg(parse_status, "status", status),
            "targetDate": arg(_target_date, "targetDate", target_date),
            "fields": arg(parse_field_list, "fields", fields),
        }
        changes = {key: value for key, value in changes.items() if value is not None}
        completion_date = arg(_completion_date, "completionDate", completion_date)
        parent = _parse_parent(arg, parent_id)
        comment_inputs = arg(list_of(parse_comment_input), "comments", comments)
        arg.check()

        def run(data: dict) -> Task:
            task = _find(data, id)
            previous = task.get("completionDate")
            now = self._timestamp()
            if "fields" in changes:
                _assert_unlocked(task["fields"], changes["fields"])
            task.update(changes, updatedAt=now)
            if comment_inputs is not None:
                task["comments"] = _reconcile_comments(task, comment_inputs, now)
            self._apply_completion(task, completion_date, previous)
            _apply_parent(data, task, parent)
            return task

        return self._todos.mutate(run)

    def postpone(self, id: str) -> Task:
        """Moves the task out of today: target becomes tomorrow, even if it was overdue."""
        return self.update(id, target_date=add_days(self.today(), 1))

    def pull_to_today(self, id: str) -> Task:
        return self.update(id, target_date=self.today())

    def reopen(self, id: str) -> Task:
        """Puts a done task back in progress for today."""
        return self.update(id, status="in-progress", target_date=self.today())

    def set_status(self, id: str, status: str) -> Task:
        return self.update(id, status=status)

    def set_field(
        self,
        id: str,
        name: str,
        type: Optional[str] = None,
        value: Optional[str] = None,
        editable: Optional[bool] = None,
        visible_on_lists: Optional[bool] = None,
        textbox: Optional[bool] = None,
    ) -> Task:
        """Adds the field, or changes the one with the same name. Unspecified options keep their current value."""
        patch = _field_patch(name, type, value, editable, visible_on_lists, textbox)

        def run(data: dict) -> Task:
            task = _find(data, id)
            fields = _with_field(task["fields"], patch)
            _assert_unlocked(task["fields"], fields)
            task.update(fields=fields, updatedAt=self._timestamp())
            return task

        return self._todos.mutate(run)

    def remove_field(self, id: str, name: str) -> Task:
        def run(data: dict) -> Task:
            task = _find(data, id)
            task.update(fields=_without_field(task["fields"], name, f"task {id}"), updatedAt=self._timestamp())
            return task

        return self._todos.mutate(run)

    def add_comment(self, id: str, text: str) -> Task:
        text = parse(comment_text, text)

        def run(data: dict) -> Task:
            task = _find(data, id)
            now = self._timestamp()
            task["comments"].append({"id": new_id(), "text": text, "createdAt": now, "updatedAt": now})
            task["updatedAt"] = now
            return task

        return self._todos.mutate(run)

    def update_comment(self, id: str, comment_id: str, text: str) -> Task:
        text = parse(comment_text, text)

        def run(data: dict) -> Task:
            task = _find(data, id)
            comment = _find_comment(task, comment_id)
            now = self._timestamp()
            if comment["text"] != text:
                comment.update(text=text, updatedAt=now)
            task["updatedAt"] = now
            return task

        return self._todos.mutate(run)

    def remove_comment(self, id: str, comment_id: str) -> Task:
        def run(data: dict) -> Task:
            task = _find(data, id)
            comment = _find_comment(task, comment_id)
            task["comments"] = [c for c in task["comments"] if c is not comment]
            task["updatedAt"] = self._timestamp()
            return task

        return self._todos.mutate(run)

    def remove(self, id: str) -> Task:
        """Refuses while the task has subtasks."""

        def run(data: dict) -> Task:
            task = _find(data, id)
            subtasks = sum(1 for t in data["tasks"] if t.get("parentId") == id)
            if subtasks:
                raise TodoError(f"task {id} has {subtasks} subtask{'' if subtasks == 1 else 's'}; delete or move them first")
            data["tasks"] = [t for t in data["tasks"] if t["id"] != id]
            return task

        return self._todos.mutate(run)

    def list_templates(self) -> List[Template]:
        """Templates, sorted by name."""
        return sorted(self._templates.read()["templates"], key=lambda t: (t["name"].casefold(), t["name"]))

    def get_template(self, ref: TemplateRef) -> Template:
        return _find_template(self._templates.read(), ref)

    def add_template(
        self,
        name: str,
        title: Optional[str] = None,
        description: Optional[str] = None,
        fields: Optional[List[dict]] = None,
    ) -> Template:
        arg = _Input()
        name = arg(template_name, "name", "" if name is None else name)
        title = arg(template_title, "title", title)
        description = arg(string, "description", description)
        fields = arg(parse_field_list, "fields", fields)
        arg.check()

        def run(data: dict) -> Template:
            _assert_name_free(data, name)
            now = self._timestamp()
            template: Template = {
                "id": new_id(),
                "name": name,
                "title": title or "",
                "description": description or "",
                "fields": fields or [],
                "createdAt": now,
                "updatedAt": now,
            }
            data["templates"].append(template)
            return template

        return self._templates.mutate(run)

    def update_template(
        self,
        ref: TemplateRef,
        name: Optional[str] = None,
        title: Optional[str] = None,
        description: Optional[str] = None,
        fields: Optional[List[dict]] = None,
    ) -> Template:
        """`fields` replaces the whole list."""
        arg = _Input()
        changes = {
            "name": arg(template_name, "name", name),
            "title": arg(template_title, "title", title),
            "description": arg(string, "description", description),
            "fields": arg(parse_field_list, "fields", fields),
        }
        changes = {key: value for key, value in changes.items() if value is not None}
        arg.check()

        def run(data: dict) -> Template:
            template = _find_template(data, ref)
            if "name" in changes and changes["name"] != template["name"]:
                _assert_name_free(data, changes["name"])
            template.update(changes, updatedAt=self._timestamp())
            return template

        return self._templates.mutate(run)

    def set_template_field(
        self,
        ref: TemplateRef,
        name: str,
        type: Optional[str] = None,
        value: Optional[str] = None,
        editable: Optional[bool] = None,
        visible_on_lists: Optional[bool] = None,
        textbox: Optional[bool] = None,
    ) -> Template:
        """Like `set_field`, on a template. Template fields are never locked."""
        patch = _field_patch(name, type, value, editable, visible_on_lists, textbox)

        def run(data: dict) -> Template:
            template = _find_template(data, ref)
            template.update(fields=_with_field(template["fields"], patch), updatedAt=self._timestamp())
            return template

        return self._templates.mutate(run)

    def remove_template_field(self, ref: TemplateRef, name: str) -> Template:
        def run(data: dict) -> Template:
            template = _find_template(data, ref)
            fields = _without_field(template["fields"], name, f'template "{template["name"]}"')
            template.update(fields=fields, updatedAt=self._timestamp())
            return template

        return self._templates.mutate(run)

    def remove_template(self, ref: TemplateRef) -> Template:
        def run(data: dict) -> Template:
            template = _find_template(data, ref)
            data["templates"] = [t for t in data["templates"] if t is not template]
            return template

        return self._templates.mutate(run)

    def watch(self, on_change: Callable[[], None], interval: float = 0.1) -> Callable[[], None]:
        """
        Calls `on_change` (on a background thread) whenever todos.json or templates.json changes on disk,
        from any process. Returns an unsubscribe function.
        """
        os.makedirs(self.dir, mode=PRIVATE_DIR, exist_ok=True)
        stopped = threading.Event()

        def signature() -> list:
            # Writes replace the files via rename, so the inode changes even when mtime and size don't.
            result = []
            for path in (self.file, self.templates_file):
                try:
                    s = os.stat(path)
                    result.append((s.st_ino, s.st_mtime_ns, s.st_size))
                except FileNotFoundError:
                    result.append(None)
            return result

        def poll(last: list) -> None:
            while not stopped.wait(interval):
                current = signature()
                if current != last:
                    last = current
                    on_change()

        threading.Thread(target=poll, args=(signature(),), daemon=True, name="todos-watch").start()
        return stopped.set

    def _apply_completion(self, task: Task, requested: Optional[LocalDate], previous: Optional[LocalDate]) -> None:
        """Done tasks always carry a completion date; other tasks never do."""
        if task["status"] == "done":
            task["completionDate"] = requested or previous or self.today()
        elif requested is not None:
            raise TodoError("completionDate can only be set on done tasks")
        else:
            task.pop("completionDate", None)


def _parse_parent(arg: _Input, parent_id: ParentId) -> ParentId:
    if parent_id is UNSET or parent_id is None:
        return parent_id
    return arg(parse_parent_id, "parentId", parent_id)


def _field_patch(name, type, value, editable, visible_on_lists, textbox) -> dict:
    given = {"type": type, "value": value, "editable": editable, "visibleOnLists": visible_on_lists, "textbox": textbox}
    return parse(parse_field_patch, {"name": name, **{k: v for k, v in given.items() if v is not None}})


def _with_field(fields: List[CustomField], patch: dict) -> List[CustomField]:
    """`fields` with the patch applied to the field of that name, or with a new field."""
    index = next((i for i, f in enumerate(fields) if f["name"] == patch["name"]), -1)
    current = fields[index] if index >= 0 else {}
    updated = parse(parse_custom_field, {"type": "text", **current, **patch})
    return fields + [updated] if index < 0 else fields[:index] + [updated] + fields[index + 1 :]


def _without_field(fields: List[CustomField], name: str, owner: str) -> List[CustomField]:
    if not any(f["name"] == name for f in fields):
        raise TodoError(f'{owner} has no field "{name}"')
    return [f for f in fields if f["name"] != name]


def _assert_unlocked(previous: List[CustomField], next_: List[CustomField]) -> None:
    locked = locked_field_change(previous, next_)
    if locked is not None:
        raise TodoError(f'field "{locked}" is not editable')


def _apply_parent(data: dict, task: Task, parent_id: ParentId) -> None:
    """Sets (str), clears (None) or leaves (UNSET) the parent; refuses unknown parents and cycles."""
    if parent_id is UNSET:
        return
    if parent_id is None:
        task.pop("parentId", None)
        return
    ancestor: Optional[Task] = _find(data, parent_id)
    while ancestor is not None:
        if ancestor["id"] == task["id"]:
            raise TodoError("a task can't be its own parent or ancestor")
        above = ancestor.get("parentId")
        ancestor = None if above is None else next((t for t in data["tasks"] if t["id"] == above), None)
    task["parentId"] = parent_id


def _find_comment(task: Task, comment_id: str) -> Comment:
    comment = next((c for c in task["comments"] if c["id"] == comment_id.strip()), None)
    if comment is None:
        raise TodoError(f"task {task['id']} has no comment {comment_id}")
    return comment


def _reconcile_comments(task: Task, inputs: List[dict], now: str) -> List[Comment]:
    """The task's comments after `update(comments=...)`. Only changed text moves a comment's `updatedAt`."""
    ids = [c["id"] for c in inputs if "id" in c]
    if len(set(ids)) != len(ids):
        raise TodoError("a comment is listed twice")
    result = []
    for entry in inputs:
        if "id" not in entry:
            result.append({"id": new_id(), "text": entry["text"], "createdAt": now, "updatedAt": now})
            continue
        comment = _find_comment(task, entry["id"])
        result.append(comment if comment["text"] == entry["text"] else {**comment, "text": entry["text"], "updatedAt": now})
    return result


def _find(data: dict, id: str) -> Task:
    task = next((t for t in data["tasks"] if t["id"] == id), None)
    if task is None:
        raise TodoError(f"task {id} not found")
    return task


def _find_template(data: dict, ref: TemplateRef) -> Template:
    key = ref.strip()
    template = next((t for t in data["templates"] if t["id"] == key), None) or next(
        (t for t in data["templates"] if t["name"] == key), None
    )
    if template is None:
        raise TodoError(f'template "{ref}" not found')
    return template


def _assert_name_free(data: dict, name: str) -> None:
    if any(t["name"] == name for t in data["templates"]):
        raise TodoError(f'a template named "{name}" already exists')
