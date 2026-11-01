"""Task file format. Tasks are plain dicts, stored as-is in todos.json."""
from __future__ import annotations

import re
import uuid
from typing import Any, Dict, Optional

from .dates import is_iso_datetime, is_local_date
from .fields import parse_field_list
from .validation import Issues, Path, field, list_of, matching, one_of, record, required_text

SCHEMA_VERSION = 5

STATUSES = ("todo", "in-progress", "done")
STATUS_LABELS = {"todo": "Todo", "in-progress": "In Progress", "done": "Done"}

Task = Dict[str, Any]
"""`{id, parentId?, title, description, status, targetDate, completionDate?, fields, comments, createdAt, updatedAt}`.
`parentId` makes it a subtask of that task. `targetDate` is the day it's planned for: on or before today =
current, after = upcoming. `completionDate` is set only while status is done. `comments` are oldest first."""

Comment = Dict[str, Any]
"""`{id, text, createdAt, updatedAt}`: a progress note on a task."""

_UUID = re.compile(
    r"^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}"
    r"|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
)


def is_uuid(value: str) -> bool:
    return bool(_UUID.match(value))


def new_id() -> str:
    """Task and template ids are uuids."""
    return str(uuid.uuid4())


def short_id(id_: str) -> str:
    """Enough of an id to tell tasks apart on screen."""
    return id_[:8]


status = one_of(STATUSES, "status")
id_ = matching(is_uuid, "id must be a uuid")
parent_id = matching(is_uuid, "parentId must be a task id (uuid)", trim=True)
timestamp = matching(is_iso_datetime, "timestamps must be ISO 8601 in UTC")
comment_text = required_text("comment text is required")


def local_date(name: str):
    return matching(is_local_date, f"{name} must be a date as YYYY-MM-DD")


def parse_comment(value: Any, path: Path, issues: Issues) -> Optional[Comment]:
    obj = record(value, path, issues)
    if obj is None:
        return None
    out: Comment = {}
    field(obj, "id", id_, path, issues, out)
    field(obj, "text", comment_text, path, issues, out)
    field(obj, "createdAt", timestamp, path, issues, out)
    field(obj, "updatedAt", timestamp, path, issues, out)
    return out


def parse_comment_input(value: Any, path: Path, issues: Issues) -> Optional[dict]:
    """A comment as given in `update(comments=...)`: with the id of an existing one, or without for a new one."""
    obj = record(value, path, issues)
    if obj is None:
        return None
    out: dict = {}
    field(obj, "id", id_, path, issues, out, optional=True)
    field(obj, "text", comment_text, path, issues, out)
    return out


def parse_task(value: Any, path: Path, issues: Issues) -> Optional[Task]:
    obj = record(value, path, issues)
    if obj is None:
        return None
    out: Task = {}
    field(obj, "id", id_, path, issues, out)
    field(obj, "parentId", parent_id, path, issues, out, optional=True)
    field(obj, "title", required_text("title is required"), path, issues, out)
    field(obj, "description", required_text("description is required"), path, issues, out)
    field(obj, "status", status, path, issues, out)
    field(obj, "targetDate", local_date("targetDate"), path, issues, out)
    field(obj, "completionDate", local_date("completionDate"), path, issues, out, optional=True)
    field(obj, "fields", parse_field_list, path, issues, out)
    field(obj, "comments", list_of(parse_comment), path, issues, out)
    field(obj, "createdAt", timestamp, path, issues, out)
    field(obj, "updatedAt", timestamp, path, issues, out)
    return out


def parse_todo_file(value: Any, path: Path, issues: Issues) -> Optional[dict]:
    obj = record(value, path, issues)
    if obj is None:
        return None
    if obj.get("schemaVersion") != SCHEMA_VERSION:
        issues.add(path + ("schemaVersion",), f"schemaVersion must be {SCHEMA_VERSION}")
    out = {"schemaVersion": SCHEMA_VERSION}
    field(obj, "tasks", list_of(parse_task), path, issues, out)
    return out


def empty_todo_file() -> dict:
    return {"schemaVersion": SCHEMA_VERSION, "tasks": []}
