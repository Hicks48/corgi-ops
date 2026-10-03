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
<app>/
  core/   domain + storage; the only package that touches disk
  cli/    terminal commands
  mcp/    MCP server (stdio) for agents
  tui/    OpenTUI (React) app
```

`cli`, `mcp` and `tui` are thin adapters over `core`. App data lives under `~/.corgiops/<app>/`
(created on first use); set `CORGIOPS_HOME` to use a different root than `~/.corgiops`.

## Apps
- [Todos](todos/README.md): daily task tracker (`bun run todos`).

