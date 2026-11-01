"""Custom fields: user-defined, typed values on tasks and templates. Names are unique per owner."""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

from .dates import is_iso_datetime, is_local_date
from .validation import Issues, Path, boolean, field, list_of, matching, one_of, or_empty, record, required_text, string

FIELD_TYPES = ("text", "link", "date", "timestamp")

CustomField = Dict[str, Any]
"""`{type, name, editable, visibleOnLists, [textbox,] value}`. `textbox` only on text fields."""


def is_web_url(value: str) -> bool:
    """Links are opened with the OS handler, which would also launch files and apps; so http(s) only."""
    if not isinstance(value, str) or any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in value):
        return False
    try:
        parts = urlsplit(value)
        return parts.scheme.lower() in ("http", "https") and bool(parts.hostname)
    except ValueError:
        return False


field_type = one_of(FIELD_TYPES, "field type")
field_name = required_text("field name is required")

_VALUES = {
    "text": string,
    "link": matching(lambda v: v == "" or is_web_url(v), "link fields must be http(s) URLs", trim=True),
    "date": or_empty(matching(is_local_date, "date fields must be YYYY-MM-DD")),
    "timestamp": or_empty(matching(lambda v: is_iso_datetime(v, offset=True), "timestamp fields must be ISO 8601")),
}


def parse_custom_field(value: Any, path: Path, issues: Issues) -> Optional[CustomField]:
    obj = record(value, path, issues)
    if obj is None:
        return None
    type_ = field_type(obj.get("type"), path + ("type",), issues)
    if type_ is None:
        return None
    out: CustomField = {"type": type_}
    field(obj, "name", field_name, path, issues, out)
    # False locks the field once it has been saved on a task.
    field(obj, "editable", boolean, path, issues, out, default=True)
    field(obj, "visibleOnLists", boolean, path, issues, out, default=False)
    if type_ == "text":
        # Multiline textbox; false for a single line.
        field(obj, "textbox", boolean, path, issues, out, default=True)
    field(obj, "value", _VALUES[type_], path, issues, out, default="")
    return out


def parse_field_list(value: Any, path: Path, issues: Issues) -> Optional[List[CustomField]]:
    before = len(issues.items)
    fields = list_of(parse_custom_field)(value, path, issues)
    if fields is None or len(issues.items) > before:
        return fields
    seen = set()
    for f in fields:
        if f["name"] in seen:
            issues.add(path, f"duplicate field name: {f['name']}")
        seen.add(f["name"])
    return fields


def parse_field_patch(value: Any, path: Path, issues: Issues) -> Optional[dict]:
    """Changes to one field by name. A new field defaults to `text`."""
    obj = record(value, path, issues)
    if obj is None:
        return None
    out: dict = {}
    field(obj, "name", field_name, path, issues, out)
    field(obj, "type", field_type, path, issues, out, optional=True)
    field(obj, "value", string, path, issues, out, optional=True)
    for flag in ("editable", "visibleOnLists", "textbox"):
        field(obj, flag, boolean, path, issues, out, optional=True)
    return out


def locked_field_change(previous: List[CustomField], next_: List[CustomField]) -> Optional[str]:
    """Name of the first locked field in `previous` that `next_` changes, if any. Removing is allowed."""
    for old in previous:
        if old["editable"]:
            continue
        updated = next((f for f in next_ if f["name"] == old["name"]), None)
        if updated is not None and updated != old:
            return old["name"]
    return None
