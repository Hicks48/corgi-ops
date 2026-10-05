# Todos app

Generic monorepo rules are in the root `CLAUDE.md`. Paths below are relative to `todos/`.

- UI spec written by the user: `tui/README.md`. Treat it as the source of truth for TUI behaviour;
  ask before deviating. User-facing docs (keys, CLI usage, MCP tools): `README.md` in this directory.
- Views (`completed`, `current`, `upcoming`) are defined in `core/src/views.ts` and shared by all adapters.
- Custom fields: schema and lock rule in `core/src/fields.ts`. Names are unique per task/template (the key).
  `update({ fields })` replaces the list; `setField` / `removeField` change one by name. Non-editable fields
  are locked once saved on a task, removable; never locked on templates. Links must be http(s) (`isWebUrl`):
  they're opened with the OS handler, which would also launch files/apps; `system.open` re-checks.
- Templates: `core/src/templates.ts`; `applyTemplate` holds the override rule used by the TUI picker and
  `addFromTemplate`. Templates are referred to by id or name (`TemplateRef`).
- TUI task and template details share `tui/src/DetailsForm.tsx` (title, custom fields, description, keys);
  each passes its own top row and optional sections above / below the description (subtasks, comments).
  Date inputs use `DateInput.tsx`, which masks typing to `YYYY-MM-DD`.
- Clipboard / browser access goes through the injected `System` (`tui/src/system.ts`); tests pass a fake.
- Storage: `TodoStore` (`core/src/store.ts`) owns `todos.json` and `templates.json`, each a `JsonFile`
  (`core/src/jsonFile.ts`) with its own `schemaVersion` and lock.
- Ids: tasks and templates use uuids (`newId`, `shortId` in `core/src/schema.ts`). Subtasks via optional
  `parentId`; rules (exists, no cycles, `null` clears) in `applyParent` in `store.ts`; `remove` refuses a
  task with subtasks. Subtask ids are derived, not stored: `getWithSubtasks` (CLI `show`, MCP `get_task`).
- Comments: `task.comments` (oldest first), each with id and timestamps. `addComment` / `updateComment` /
  `removeComment` for single changes; `update({ comments })` reconciles the whole list (TUI save). Any
  comment change bumps the task's `updatedAt`.
- CLI text output goes through `terminalSafe` / `terminalSafeJson` (`cli/src/terminal.ts`) so stored text
  (often written by agents) can't inject terminal escape sequences.
- Dates helpers: `core/src/dates.ts`. User-facing errors: `TodoError` (`core/src/errors.ts`).
- Tests: `new TodoStore({ dir, now })` with a temp dir and injected clock.
