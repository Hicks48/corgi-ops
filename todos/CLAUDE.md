# Todos app

Generic monorepo rules are in the root `CLAUDE.md`. Paths below are relative to `todos/`.

- UI spec written by the user: `ui/README.md`. Treat it as the source of truth for UI behaviour;
  ask before deviating. User-facing docs (keys, CLI usage, MCP tools): `README.md` in this directory.
- Views (`completed`, `current`, `upcoming`) are defined in `core/views.py` and shared by all adapters.
- Validation: `core/validation.py` holds small parsers (check + normalize, collect issues); schemas built from
  them are in `core/schema.py` (tasks, comments), `core/fields.py`, `core/templates.py`. Reading a file
  validates it fully; `TodoStore` validates arguments the same way before taking the lock.
- Custom fields: schema and lock rule in `core/fields.py`. Names are unique per task/template (the key).
  `update(fields=...)` replaces the list; `set_field` / `remove_field` change one by name. Non-editable fields
  are locked once saved on a task, removable; never locked on templates. Links must be http(s) (`is_web_url`):
  they're opened with the OS handler, which would also launch files/apps; `ui/system.py` re-checks and runs
  the opener with an argument list (no shell).
- Templates: `core/templates.py`; `apply_template` holds the override rule used by the UI picker and
  `add_from_template`. Templates are referred to by id or name (`TemplateRef`).
- UI task and template details share `ui/details_form.py` (`DetailsForm`: title, custom fields, description,
  keys, focus order); `TaskDetails` / `TemplateDetails` override hooks (`build_top`, `build_above` /
  `build_below`, `on_key`, `collect`...). Date inputs use `DateEntry` in `ui/widgets.py` (`mask_date`).
- UI look (terminal-like: monospace, dark, boxes with titles in the border, `[ button ]` labels) is in
  `ui/theme.py` and `ui/widgets.py`; build new screens from those widgets.
- App icon: `ui/assets/icon.png` (512px RGBA, transparent outside the rounded square; Tk reads PNG, not
  JPEG), set via `iconphoto` in `ui/__init__.py`.
- Clipboard / browser access goes through the injected `System` (`ui/system.py`); tests pass a fake.
- Storage: `TodoStore` (`core/store.py`) owns `todos.json` and `templates.json`, each a `JsonFile`
  (`core/json_file.py`) with its own `schemaVersion` and lock. `watch` polls both files on a background thread;
  the UI turns that into reloads on the Tk thread (`App._poll_changes`).
- Ids: tasks and templates use uuids (`new_id`, `short_id` in `core/schema.py`). Subtasks via optional
  `parentId`; rules (exists, no cycles, `None` clears) in `_apply_parent` in `store.py`; `remove` refuses a
  task with subtasks. Subtask ids are derived, not stored: `get_with_subtasks` (CLI `show`, MCP `get_task`).
- Comments: `task["comments"]` (oldest first), each with id and timestamps. `add_comment` / `update_comment` /
  `remove_comment` for single changes; `update(comments=...)` reconciles the whole list (UI save). Any
  comment change bumps the task's `updatedAt`.
- CLI text output goes through `terminal_safe` / `terminal_safe_json` (`cli/terminal.py`) so stored text
  (often written by agents) can't inject terminal escape sequences.
- MCP tools and their JSON schemas: `mcp/server.py`. Arguments are validated against the schema
  (`protocol.validate`, unknown keys dropped) before reaching the store; `TodoError` becomes an `isError` result.
- Dates helpers: `core/dates.py`. User-facing errors: `TodoError` (`core/errors.py`).
- Tests: in `<layer>/test/`. `TodoStore(dir=..., now=...)` with a temp dir and injected clock.
