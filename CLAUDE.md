# CLAUDE.md

Corgi Ops: monorepo of small productivity apps. Early development; expect structure and features to change.
Prefer reading the code over trusting this file when they disagree, and update this file when you change
something it describes.

## Stack
- Python >= 3.9, **standard library only**: no pip packages, no build step. Keep it that way (security and
  zero setup are the point); hand-roll small things instead (validation, MCP protocol, arg parsing).
- Code must run on 3.9 (Apple's `/usr/bin/python3`): `from __future__ import annotations`, no `match`, no
  `X | Y` outside annotations, no 3.10+ stdlib APIs (e.g. `nametofont(name, root)`).
- UI: tkinter, needs Tk 8.6+. Apple's Python has Tk 8.5, which hangs on recent macOS; the UI refuses it and
  UI tests skip. Dev machine: `~/.pyenv/versions/3.15.2/bin/python3` (Tk 9.1, from Homebrew `tcl-tk`).
- MCP: hand-rolled stdio JSON-RPC (`todos/mcp/protocol.py`). No HTTP transport, no network listeners.

## Commands
```bash
python3 scripts/test.py            # all tests (unittest discovery of test_*.py); -k <pattern> to filter
python3 -m todos.ui                # UI
python3 -m todos.cli <args>        # CLI
python3 -m todos.mcp               # MCP server (stdio)
python3 todos/bin [args]           # all-in-one entry (no args = UI, `mcp`, else CLI)
```
No release builds for now: apps are cloned and run from source.
Run `python3 scripts/test.py` with a Tk 8.6+ Python before calling work done (otherwise UI tests skip), and
with `/usr/bin/python3` (3.9) when touching core, CLI or MCP.

## Apps
Each app has its own `README.md` (user-facing docs: keys, CLI usage, MCP tools) and `CLAUDE.md`
(app-specific notes). Root `README.md` only lists the apps and shared setup.
- `todos/`: daily task tracker. See `todos/CLAUDE.md`.

## Layout
Each app is a top-level Python package; layers are subpackages imported as `<app>.<layer>`
(e.g. `from todos.core import TodoStore`). Run from the repo root (or via `<app>/bin`, which fixes the path).

```
<app>/
  core/   domain model, validation, storage. Only package that touches disk.
  cli/    terminal commands (own small arg parser in args.py, no argparse)
  mcp/    MCP server; create_server(store) in server.py, generic protocol in protocol.py
  ui/     tkinter desktop app
  bin/    single entry: no args = UI, `mcp` = MCP server, else CLI; holds VERSION
```
- Tests live in a `test/` package inside each layer (e.g. `todos/ui/test/test_app.py`, with an empty
  `__init__.py`). Use absolute imports (`from todos.core import ...`).
- Adapters (`cli`, `mcp`, `ui`) stay thin: business rules live in `core` so all three behave the same.
  New operations go in core first, then get exposed in each adapter as appropriate.
- Code shared across apps goes in a new top-level `shared/` package once a second app needs it.

## Data
- App data lives under `~/.corgiops/<app>/` (e.g. `~/.corgiops/todos/todos.json`), created on first use.
  Root is overridable with `CORGIOPS_HOME`. Dirs are created `0700`, files written `0600` (owner only).
- Files carry `schemaVersion`. The format is the same as the earlier TypeScript version's (files are
  interchangeable). Apps not yet in use (todos) change the format freely, without migrations. Once an app is
  in use: bump it, add a migration step that upgrades old files on read (persisted on next write), and add a
  migration test.
- Writes take a lockfile, validate the whole file, then atomically rename into place (see
  `todos/core/json_file.py`). UI, CLI and agents (via MCP) may write concurrently.
- Dates are local `YYYY-MM-DD` strings; timestamps are UTC ISO strings with milliseconds (`to_iso`).
- Records are plain dicts with camelCase keys, exactly as stored and as returned by MCP / `--json`.
  Store methods take snake_case keyword arguments.
- User-facing errors are raised as one app-level exception (e.g. `TodoError`); adapters show these and let
  other errors crash. Validation collects every problem and joins the messages with `; `.

## Gotchas
- **Never let tests touch the real `~/.corgiops`.** `scripts/test.py` points `CORGIOPS_HOME` at a temp dir
  before discovery. Tests should still pass an explicit temp `dir` to the app's store.
- Inject the clock into stores in tests that depend on "today". Use local-noon dates
  (`datetime(2026, 10, 3, 12)`) so results don't depend on time zone.
- Optional store arguments: `None` means "not given" (callers pass them straight through), except where
  `None` is meaningful; then the default is the `UNSET` sentinel (e.g. `parent_id=None` clears the parent).
- UI tests: one shared `Tk` per run, a `Toplevel` per test (Tk 9 on macOS crashes when a new `Tk` follows a
  destroyed one). The window must be mapped: Tk only delivers clicks to windows on screen. Drive keys through
  `App.handle_key(Key(...))`, type by inserting into `screen.focused_widget()`, and read the screen with the
  test's `frame()` (text of all laid-out labels and inputs).
- UI keys: the app puts its bindtag first on every widget (`App.install_keys`, call it after adding widgets)
  so keys reach `handle_key` before Tk's text bindings; returning True swallows the key. Match printable keys
  on `key.char`, not the keysym (keyboard layouts differ).
- In UI forms read values from the widgets at save time, never from cached state.
- Don't name methods on tkinter widget subclasses after `Misc` methods (`register`, `keys`, `config`...).

## Conventions
- Match existing style: 4-space indent, double quotes, type hints, line length ~120, short comments only
  where the why isn't obvious (see CONTRIBUTION.md).
- Don't commit unless the user asks; the user reviews before committing.
