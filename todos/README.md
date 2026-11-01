# Todos
Task tracker for the day's work: a desktop UI, a CLI and an MCP server for agents, all over the same data.

Packages: `core` (domain + storage), `cli`, `mcp`, `ui`, `bin`. Plain Python >= 3.9, no third-party packages;
the UI needs Tk 8.6+ (see the root README). Run the `python3 -m` commands from the repo root.

Tasks have a required title and description, a status (`todo`, `in-progress`, `done`), a target
date (the day it's planned for) and, once done, a completion date. Tasks can also carry custom fields
(see below). Tasks and templates have uuid ids. A task can name another as its parent (`parentId`),
making it a subtask; the parent must exist, can't create a cycle, and can't be deleted while it has
subtasks. Tasks also hold comments (progress notes: `text`, `createdAt`, `updatedAt`), oldest first.
Data lives in
`~/.corgiops/todos/todos.json` (created on first use). Set `CORGIOPS_HOME` to use a different root
than `~/.corgiops`.

Custom fields have a `name` (unique per task), a `type` and a `value`:
- `text` (free text; `textbox: false` for a single line), `link` (`http`/`https` URL only), `date` (`YYYY-MM-DD`),
  `timestamp` (ISO 8601). Values may be empty.
- `editable` (default `true`): `false` locks the field once saved. It can still be removed.
- `visibleOnLists` (default `false`): show it (one line) on the UI list views.

Templates are starting points for new tasks, stored in `~/.corgiops/todos/templates.json`. A template
has a unique `name` plus an optional title, description and custom fields. Applying one overrides the
new task's values with the template's non-empty ones; template fields replace task fields with the same
name (an empty template field doesn't replace an existing one). Tasks keep no link to their template.

Views:
- **Current**: not done, target date today or earlier. In-progress first.
- **Upcoming**: not done, target date after today. Earliest first.
- **Completed**: done. Most recently completed first.

One command bundles everything: `python3 todos/bin`. Run it without arguments for the UI, with `mcp` for the
MCP server, and any other arguments go to the CLI (`python3 todos/bin list` = `python3 -m todos.cli list`).
`python3 todos/bin --version` prints the version.

## UI
```bash
python3 -m todos.ui
```
A desktop window styled like a terminal. Opens on Current Tasks. UI spec: [ui/README.md](ui/README.md).

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
(e.g. `[ copy ]` / `[ open ]` on custom fields). The mouse wheel / trackpad scrolls.

Task details: `tab` / `shift+tab` or a click move between fields, `←` `→` change status, `ctrl+s` (or `cmd+s`
on macOS) save, `esc` back without saving, `ctrl+d` delete (asks to confirm). The `[ save ]`, `[ back ]` and
`[ delete ]` buttons at the top do the same. Created/updated times are shown read-only.
The `Id` box shows the short id; `ctrl+y` on it (or `[ copy ]`) copies the full id. `Parent` takes a
parent task's id (empty for none); `ctrl+p` or `[ open ]` opens the saved parent, discarding unsaved edits.
A parent lists its subtasks above the description; `tab` to one and `enter` (or `[ open ]`) opens it.
Comments are listed below the description and edited in place; type in `New comment` to add one, `ctrl+x`
on a comment (or its `[ remove ]`) removes it. Like everything else, comment changes are saved with `ctrl+s`.
Custom fields: `ctrl+n` new field, and on a focused field `ctrl+y` copy, `ctrl+o` open (links),
`ctrl+x` remove (also `[ copy ]`, `[ open ]`, `[ remove ]`). Field changes are saved with `ctrl+s` like everything else.
Date inputs only accept digits and format them as `YYYY-MM-DD` (incomplete or impossible dates show red).
New task: pick a template from the `Template` dropdown (focus it and press `enter`, or click it).

Template details work like task details, with a `Name` instead of status and dates.

Keys are matched on the typed character, so `[` `]` work on layouts where they need `option` (e.g. Finnish
`option+8`).

The views reload when another process (CLI, MCP server) changes the file.

## CLI
```bash
python3 -m todos.cli list [--view current|upcoming|completed] [--status <status>] [--json]
python3 -m todos.cli show <id>
python3 -m todos.cli add --title <text> --description <text> [--status <status>] [--target-date YYYY-MM-DD] [--parent <id>]
python3 -m todos.cli update <id> [--title ...] [--description ...] [--status ...] [--target-date ...] [--completion-date ...] [--parent <id>]
python3 -m todos.cli status <id> <status>
python3 -m todos.cli postpone <id>
python3 -m todos.cli pull <id>
python3 -m todos.cli reopen <id>
python3 -m todos.cli rm <id>
python3 -m todos.cli field set <id> --name <name> [--type text|link|date|timestamp] [--value <text>]
                     [--editable true|false] [--visible-on-lists true|false] [--textbox true|false]
python3 -m todos.cli field rm <id> <name>
python3 -m todos.cli comment add <id> --text <text>
python3 -m todos.cli comment update <id> <comment-id> --text <text>
python3 -m todos.cli comment rm <id> <comment-id>
python3 -m todos.cli add --template <id|name> [--title ...] [--description ...] [...]
python3 -m todos.cli template list|show|add|update|rm ...
python3 -m todos.cli template field set|rm <id|name> ...
```
Ids are the full uuids shown by `list`. `--parent ""` clears the parent. `show` lists the ids of the
task's subtasks (also in `--json`, as `subtaskIds`) and its comments with their ids.
`field set` adds the field or changes the one with that name; unspecified options keep their values.
`add --template` starts from the template; options given on the command line win. Run with `--help` for
the full template usage.

## MCP server
Tools: `list_tasks`, `get_task`, `add_task` (accepts `fields`), `update_task`, `set_task_field`,
`remove_task_field`, `add_task_comment`, `update_task_comment`, `delete_task_comment`, `set_task_status`, `postpone_task`, `pull_task_to_today`, `reopen_task`, `delete_task`,
`list_templates`, `get_template`, `add_template`, `update_template`, `set_template_field`,
`remove_template_field`, `delete_template`. `add_task` accepts `template` (id or name). `add_task` and
`update_task` accept `parentId` (`null` clears it). `get_task` also returns `subtaskIds`.

Register with Claude Code:

```bash
claude mcp add corgi-todos -- python3 /absolute/path/to/corgi-ops/todos/bin mcp
```
