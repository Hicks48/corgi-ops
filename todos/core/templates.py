"""Templates: starting points for new tasks, stored in templates.json."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .fields import CustomField, parse_field_list
from .schema import id_, timestamp
from .validation import Issues, Path, field, list_of, record, required_text, string

TEMPLATE_SCHEMA_VERSION = 2

Template = Dict[str, Any]
"""`{id, name, title, description, fields, createdAt, updatedAt}`. `name` is a unique label shown in lists and
the template picker. Empty title / description leave the task's own value alone."""

template_name = required_text("template name is required")


def template_title(value: Any, path: Path, issues: Issues) -> Optional[str]:
    return string(value, path, issues, trim=True)


def parse_template(value: Any, path: Path, issues: Issues) -> Optional[Template]:
    obj = record(value, path, issues)
    if obj is None:
        return None
    out: Template = {}
    field(obj, "id", id_, path, issues, out)
    field(obj, "name", template_name, path, issues, out)
    field(obj, "title", template_title, path, issues, out)
    field(obj, "description", string, path, issues, out)
    field(obj, "fields", parse_field_list, path, issues, out)
    field(obj, "createdAt", timestamp, path, issues, out)
    field(obj, "updatedAt", timestamp, path, issues, out)
    return out


def parse_template_file(value: Any, path: Path, issues: Issues) -> Optional[dict]:
    obj = record(value, path, issues)
    if obj is None:
        return None
    if obj.get("schemaVersion") != TEMPLATE_SCHEMA_VERSION:
        issues.add(path + ("schemaVersion",), f"schemaVersion must be {TEMPLATE_SCHEMA_VERSION}")
    out = {"schemaVersion": TEMPLATE_SCHEMA_VERSION}
    field(obj, "templates", list_of(parse_template), path, issues, out)
    seen = set()
    for name in (t.get("name") for t in out.get("templates") or [] if t):
        if name in seen:
            issues.add(path + ("templates",), f"duplicate template name: {name}")
        seen.add(name)
    return out


def empty_template_file() -> dict:
    return {"schemaVersion": TEMPLATE_SCHEMA_VERSION, "templates": []}


def upsert_fields(base: List[CustomField], incoming: List[CustomField]) -> List[CustomField]:
    """Replaces fields in `base` that share a name with one in `incoming`, and appends the rest."""
    by_name = {f["name"]: f for f in incoming}
    kept = [by_name.get(f["name"], f) for f in base]
    base_names = {f["name"] for f in base}
    return kept + [f for f in incoming if f["name"] not in base_names]


def apply_template(values: dict, template: Template) -> dict:
    """
    `values` (title, description, fields, ...) overridden with the template's non-empty values. Template
    fields replace same-named fields, except that an empty template field leaves an existing one alone.
    """
    names = {v["name"] for v in values["fields"]}
    return {
        **values,
        "title": template["title"] or values["title"],
        "description": template["description"] if template["description"].strip() else values["description"],
        "fields": upsert_fields(values["fields"], [f for f in template["fields"] if f["value"] != "" or f["name"] not in names]),
    }
