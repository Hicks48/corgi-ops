# Corgi Ops
This is a monorepository which hosts a suite of applications for better work experience. Plain Python, no
third-party packages.

## Install
Needs Python >= 3.9. The desktop UI also needs Tk 8.6 or newer in that Python:
- macOS: the [python.org installer](https://www.python.org/downloads/) bundles Tk. With Homebrew,
  `brew install python-tk` (or, with pyenv, `brew install tcl-tk` before `pyenv install`). Apple's
  `/usr/bin/python3` has Tk 8.5, which hangs on recent macOS; the UI refuses to start on it.
- Linux: the distro's Python plus its Tk package, e.g. `sudo apt install python3-tk`.
- Windows: the python.org installer (Tk included).

Check with `python3 -c "import tkinter; print(tkinter.TkVersion)"`. The CLI and MCP server work without Tk.

Clone and run from source:
```bash
git clone <repo-url> ~/corgi-ops
alias todos="python3 ~/corgi-ops/todos/bin"   # e.g. in ~/.zshrc; todos = UI, todos list = CLI
claude mcp add corgi-todos -- python3 ~/corgi-ops/todos/bin mcp   # optional, for Claude Code
```
Data is stored under `~/.corgiops/` and is not touched by updates. To update: `cd ~/corgi-ops && git pull`.

## Development
```bash
python3 scripts/test.py          # all tests; UI tests skip without a working Tk
python3 -m todos.ui              # UI (from the repo root)
python3 -m todos.cli list        # CLI
python3 -m todos.mcp             # MCP server (stdio)
```

## Layout
Each app is a Python package with one subpackage per layer:

```
<app>/
  core/   domain + storage; the only package that touches disk
  cli/    terminal commands
  mcp/    MCP server (stdio) for agents
  ui/     desktop app (tkinter)
  bin/    single entry point: UI, CLI and MCP server in one command
```

`cli`, `mcp` and `ui` are thin adapters over `core`. App data lives under `~/.corgiops/<app>/`
(created on first use); set `CORGIOPS_HOME` to use a different root than `~/.corgiops`.

## Apps
- [Todos](todos/README.md): daily task tracker (`python3 todos/bin`).
