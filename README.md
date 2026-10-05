# Corgi Ops
This is a monorepository which hosts a suite of TUI applications for better work experience.

## Install
1. Install [Bun](https://bun.sh) >= 1.3:
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```
2. Clone the repo and install dependencies:
   ```bash
   git clone <repo-url> ~/corgi-ops
   cd ~/corgi-ops
   bun install
   ```
3. Add aliases to your shell config (e.g. `~/.zshrc`) so the apps run from any directory, then open a
   new terminal:
   ```bash
   alias todos="bun ~/corgi-ops/todos/tui/src/index.tsx"      # TUI
   alias todos-cli="bun ~/corgi-ops/todos/cli/src/index.ts"   # CLI, e.g. todos-cli list
   ```
4. Optional, to let Claude Code manage your todos:
   ```bash
   claude mcp add corgi-todos -- bun ~/corgi-ops/todos/mcp/src/index.ts
   ```

Data is stored under `~/.corgiops/` and is not touched by updates. To update: `cd ~/corgi-ops && git pull && bun install`.

## Development
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

