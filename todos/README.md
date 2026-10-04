# Todos
Task tracker for the day's work: a TUI, a CLI and an MCP server for agents, all over the same data.

Packages: `core` (domain + storage), `cli`, `mcp`, `tui`. Run commands from the repo root.

Tasks have a required title and description, a status (`todo`, `in-progress`, `done`), a target
date (the day it's planned for) and, once done, a completion date. Tasks can also carry custom fields
(see below). Tasks and templates have uuid ids. A task can name another as its parent (`parentId`),
making it a subtask; the parent must exist, can't create a cycle, and can't be deleted while it has
subtasks. Data lives in
`~/.corgiops/todos/todos.json` (created on first use). Set `CORGIOPS_HOME` to use a different root
than `~/.corgiops`.

Custom fields have a `name` (unique per task), a `type` and a `value`:
- `text` (free text; `textbox: false` for a single line), `link` (URL), `date` (`YYYY-MM-DD`),
  `timestamp` (ISO 8601). Values may be empty.
- `editable` (default `true`): `false` locks the field once saved. It can still be removed.
- `visibleOnLists` (default `false`): show it (one line) on the TUI list views.

Templates are starting points for new tasks, stored in `~/.corgiops/todos/templates.json`. A template
has a unique `name` plus an optional title, description and custom fields. Applying one overrides the
new task's values with the template's non-empty ones; template fields replace task fields with the same
name (an empty template field doesn't replace an existing one). Tasks keep no link to their template.

Views:
- **Current**: not done, target date today or earlier. In-progress first.
- **Upcoming**: not done, target date after today. Earliest first.
- **Completed**: done. Most recently completed first.

## TUI
```bash
bun run todos
```
Opens on Current Tasks. UI spec: [tui/README.md](tui/README.md).

List views:

| Key | Action |
| --- | --- |
| `[` `]` / `←` `→` | Previous / next view (Completed, Current, Upcoming) |
| `↑` `↓` / `k` `j` | Select task |
| `enter` | Open task details |
| `a` | Add task (todo, target today) |
| `p` | Templates list (`↑` `↓` select, `enter` details, `a` add, `esc` back) |
| `+` | Current: +1 day (target becomes tomorrow) |
| `t` | Upcoming: pull to today |
| `r` | Completed: reopen |
| `q` | Quit |

Mouse: click a tab to switch view, a card to select it (click again to open), a `[ button ]` to run it
(e.g. `[ copy ]` / `[ open ]` on custom fields).

Task details: `tab` / `shift+tab` or a click move between fields, `←` `→` change status, `ctrl+s` save,
`esc` back without saving, `ctrl+d` delete (asks to confirm). Created/updated times are shown read-only.
The `Id` box shows the short id; `ctrl+y` on it (or `[ copy ]`) copies the full id. `Parent` takes a
parent task's id (empty for none); `ctrl+p` or `[ open ]` opens the saved parent, discarding unsaved edits.
A parent lists its subtasks below the description; `tab` to one and `enter` (or `[ open ]`) opens it.
Custom fields: `ctrl+n` new field, and on a focused field `ctrl+y` copy, `ctrl+o` open (links),
`ctrl+x` remove. Field changes are saved with `ctrl+s` like everything else.
Date inputs only accept digits and format them as `YYYY-MM-DD` (incomplete or impossible dates show red).
New task: focus the `Template` box and press `enter` (or click it) to pick a template.

Template details work like task details, with a `Name` instead of status and dates.

On macOS keyboard layouts where `[` `]` need `option` (e.g. Finnish `option+8`), Terminal.app's
"Use Option as Meta key" setting makes `option+8` arrive as `meta+8` instead of `[`. Use `←` `→` or turn
that setting off (Settings > Profiles > Keyboard).

The views reload when another process (CLI, MCP server) changes the file.

## CLI
```bash
bun run todos:cli list [--view current|upcoming|completed] [--status <status>] [--json]
bun run todos:cli show <id>
bun run todos:cli add --title <text> --description <text> [--status <status>] [--target-date YYYY-MM-DD] [--parent <id>]
bun run todos:cli update <id> [--title ...] [--description ...] [--status ...] [--target-date ...] [--completion-date ...] [--parent <id>]
bun run todos:cli status <id> <status>
bun run todos:cli postpone <id>
bun run todos:cli pull <id>
bun run todos:cli reopen <id>
bun run todos:cli rm <id>
bun run todos:cli field set <id> --name <name> [--type text|link|date|timestamp] [--value <text>]
                  [--editable true|false] [--visible-on-lists true|false] [--textbox true|false]
bun run todos:cli field rm <id> <name>
bun run todos:cli add --template <id|name> [--title ...] [--description ...] [...]
bun run todos:cli template list|show|add|update|rm ...
bun run todos:cli template field set|rm <id|name> ...
```
Ids are the full uuids shown by `list`. `--parent ""` clears the parent. `show` lists the ids of the
task's subtasks (also in `--json`, as `subtaskIds`).
`field set` adds the field or changes the one with that name; unspecified options keep their values.
`add --template` starts from the template; options given on the command line win. Run with `--help` for
the full template usage.

## MCP server
Tools: `list_tasks`, `get_task`, `add_task` (accepts `fields`), `update_task`, `set_task_field`,
`remove_task_field`, `set_task_status`, `postpone_task`, `pull_task_to_today`, `reopen_task`, `delete_task`,
`list_templates`, `get_template`, `add_template`, `update_template`, `set_template_field`,
`remove_template_field`, `delete_template`. `add_task` accepts `template` (id or name). `add_task` and
`update_task` accept `parentId` (`null` clears it). `get_task` also returns `subtaskIds`.

Register with Claude Code:

```bash
claude mcp add corgi-todos -- bun /absolute/path/to/corgi-ops/todos/mcp/src/index.ts
```
