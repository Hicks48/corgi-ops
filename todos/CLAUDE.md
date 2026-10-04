# Todos app

Generic monorepo rules are in the root `CLAUDE.md`. Paths below are relative to `todos/`.

- UI spec written by the user: `tui/README.md`. Treat it as the source of truth for TUI behaviour;
  ask before deviating. User-facing docs (keys, CLI usage, MCP tools): `README.md` in this directory.
- Views (`completed`, `current`, `upcoming`) are defined in `core/src/views.ts` and shared by all adapters.
- Custom fields: schema and lock rule in `core/src/fields.ts`. Names are unique per task/template (the key).
  `update({ fields })` replaces the list; `setField` / `removeField` change one by name. Non-editable fields
  are locked once saved on a task, removable; never locked on templates.
- Templates: `core/src/templates.ts`; `applyTemplate` holds the override rule used by the TUI picker and
  `addFromTemplate`. Templates are referred to by id or name (`TemplateRef`).
- TUI task and template details share `tui/src/DetailsForm.tsx` (title, custom fields, description, keys);
  each passes its own top row (and optionally a bottom section, e.g. the subtask list). Date inputs use
  `DateInput.tsx`, which masks typing to `YYYY-MM-DD`.
- Clipboard / browser access goes through the injected `System` (`tui/src/system.ts`); tests pass a fake.
- Storage: `TodoStore` (`core/src/store.ts`) owns `todos.json` and `templates.json`, each a `JsonFile`
  (`core/src/jsonFile.ts`) with its own `schemaVersion` and lock. Task format migrations: `migrate()` in
  `core/src/schema.ts`.
- Ids: tasks and templates use uuids (`newId`, `shortId` in `core/src/schema.ts`). Subtasks via optional
  `parentId`; rules (exists, no cycles, `null` clears) in `applyParent` in `store.ts`; `remove` refuses a
  task with subtasks. Subtask ids are derived, not stored: `getWithSubtasks` (CLI `show`, MCP `get_task`).
  Pre-uuid files (todos v<4, templates v<2) are not migrated.
- Dates helpers: `core/src/dates.ts`. User-facing errors: `TodoError` (`core/src/errors.ts`).
- Tests: `new TodoStore({ dir, now })` with a temp dir and injected clock.
