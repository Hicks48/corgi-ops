# Corgi Ops
This is a monorepository which hosts a suite of TUI applications for better work experience.

## Install
### Release binary
No Bun needed. Download the binary for your platform (`darwin-arm64`, `darwin-x64`, `linux-x64` or
`linux-arm64`) into a directory on your `PATH`:
```bash
mkdir -p ~/.local/bin
curl -fsSL https://github.com/Hicks48/corgi-ops/releases/latest/download/corgi-todos-darwin-arm64.tar.gz \
  | tar -xz -C ~/.local/bin
```
Then `corgi-todos` opens the TUI, `corgi-todos list` etc. run the CLI, and Claude Code can use it with
`claude mcp add corgi-todos -- ~/.local/bin/corgi-todos mcp`. To update, run the `curl` again.

The binaries are not signed. On macOS, if you downloaded the archive in a browser instead of with `curl`,
the binary is blocked ("cannot be opened" / "unidentified developer"). Unblock it with:
```bash
xattr -d com.apple.quarantine ~/.local/bin/corgi-todos
```

### From source
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
  bin/    entry of the release binary
```

Releases: see [RELEASING.md](RELEASING.md).

`cli`, `mcp` and `tui` are thin adapters over `core`. App data lives under `~/.corgiops/<app>/`
(created on first use); set `CORGIOPS_HOME` to use a different root than `~/.corgiops`.

## Apps
- [Todos](todos/README.md): daily task tracker (`bun run todos`).

