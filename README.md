# Corgi Ops
This is a monorepository which hosts a suite of TUI applications for better work experience.

## Setup
Requires [Bun](https://bun.sh) >= 1.3.

```bash
bun install
bun test
bun run typecheck
```

## Layout
Each app is a directory of Bun workspace packages:

```
todos/
  core/   domain + storage; the only package that touches disk
  cli/    terminal commands
  mcp/    MCP server (stdio) for agents
  tui/    OpenTUI (React) app
```

`cli`, `mcp` and `tui` are thin adapters over `core`.

## Todos
Tasks have a required title and description, a status (`todo`, `in-progress`, `done`), a target
date (the day it's planned for) and, once done, a completion date. Data lives in
`~/.corgiops/todos/todos.json` (created on first use). Set `CORGIOPS_HOME` to use a different root
than `~/.corgiops`.

Views:
- **Current**: not done, target date today or earlier. In-progress first.
- **Upcoming**: not done, target date after today. Earliest first.
- **Completed**: done. Most recently completed first.

### TUI
```bash
bun run todos
```
Opens on Current Tasks. UI spec: [todos/tui/README.md](todos/tui/README.md).

List views:

| Key | Action |
| --- | --- |
| `[` `]` | Previous / next view (Completed, Current, Upcoming) |
| `↑` `↓` / `k` `j` | Select task |
| `enter` | Open task details |
| `a` | Add task (todo, target today) |
| `+` | Current: +1 day (target becomes tomorrow) |
| `t` | Upcoming: pull to today |
| `r` | Completed: reopen |
| `q` | Quit |

Mouse: click a tab to switch view, a card to select it (click again to open), a `[ button ]` to run it.

Task details: `tab` / `shift+tab` move between fields, `←` `→` change status, `ctrl+s` save,
`esc` back without saving, `ctrl+d` delete (asks to confirm). Created/updated times are shown read-only.

The views reload when another process (CLI, MCP server) changes the file.

### CLI
```bash
bun run todos:cli list [--view current|upcoming|completed] [--status <status>] [--json]
bun run todos:cli show <id>
bun run todos:cli add --title <text> --description <text> [--status <status>] [--target-date YYYY-MM-DD]
bun run todos:cli update <id> [--title ...] [--description ...] [--status ...] [--target-date ...] [--completion-date ...]
bun run todos:cli status <id> <status>
bun run todos:cli postpone <id>
bun run todos:cli pull <id>
bun run todos:cli reopen <id>
bun run todos:cli rm <id>
```

### MCP server
Tools: `list_tasks`, `get_task`, `add_task`, `update_task`, `set_task_status`, `postpone_task`,
`pull_task_to_today`, `reopen_task`, `delete_task`.

Register with Claude Code:

```bash
claude mcp add corgi-todos -- bun /absolute/path/to/corgi-ops/todos/mcp/src/index.ts
```
