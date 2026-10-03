# CLAUDE.md

Corgi Ops: monorepo of terminal (TUI) apps. Early development; expect structure and features to change.
Prefer reading the code over trusting this file when they disagree, and update this file when you change
something it describes.

## Stack
- Bun (>= 1.3) runtime, package manager and test runner. No Node/npm scripts.
- TypeScript, strict. Root `tsconfig.json` covers all packages.
- TUI: OpenTUI with React (`@opentui/react`, `@opentui/core`). Docs: `node_modules` README of `@opentui/react`.
- Validation: zod v4. MCP: `@modelcontextprotocol/sdk` (stdio).

## Commands
```bash
bun install
bun test              # all tests
bun run typecheck     # tsc --noEmit
bun run <app>         # TUI, e.g. bun run todos
bun run <app>:cli     # CLI
bun run <app>:mcp     # MCP server (stdio)
```
Run `bun test` and `bun run typecheck` before calling work done.

## Apps
Each app has its own `README.md` (user-facing docs: keys, CLI usage, MCP tools) and `CLAUDE.md`
(app-specific notes). Root `README.md` only lists the apps and shared setup.
- `todos/`: daily task tracker. See `todos/CLAUDE.md`.

## Layout
Each app is a directory of Bun workspace packages (`workspaces` in root `package.json`; add the new
app's glob there, e.g. `"<app>/*"`, plus `<app>`, `<app>:cli`, `<app>:mcp` scripts):

```
<app>/
  core/   domain model, validation, storage. Only package that touches disk.
  cli/    terminal commands (node:util parseArgs, no CLI framework)
  mcp/    MCP server; createServer(store) in server.ts, stdio entry in index.ts
  tui/    OpenTUI React app
```
- Adapters (`cli`, `mcp`, `tui`) stay thin: business rules live in `core` so all three behave the same.
  New operations go in core first, then get exposed in each adapter as appropriate.
- Packages are named `@corgiops/<app>-<package>` and import each other by that name. Source is consumed
  directly (`exports: ./src/index.ts`); no build step.
- Code shared across apps goes in a new top-level `shared/` workspace once a second app needs it.

## Data
- App data lives under `~/.corgiops/<app>/` (e.g. `~/.corgiops/todos/todos.json`), created on first use.
  Root is overridable with `CORGIOPS_HOME`.
- Files carry `schemaVersion`. When changing the format: bump it, add a migration step, and add a
  migration test. Old files are upgraded on read, persisted on next write.
- Writes take a lockfile, validate the whole file, then atomically rename into place (see
  `todos/core/src/jsonFile.ts`). TUI, CLI and agents (via MCP) may write concurrently.
- Dates are local `YYYY-MM-DD` strings; timestamps are ISO strings.
- User-facing errors are thrown as one app-level error class (e.g. `TodoError`); adapters show these
  and let other errors crash.

## Gotchas
- **Never let tests touch the real `~/.corgiops`.** `bunfig.toml` preloads `test-setup.ts`, which points
  `CORGIOPS_HOME` at a temp dir. Tests should still pass an explicit temp `dir` to the app's store.
- Inject the clock into stores in tests that depend on "today". Use local-noon dates
  (`new Date(2026, 9, 3, 12)`) so results don't depend on time zone.
- Callers (CLI especially) pass optional fields as explicit `undefined`. Core must treat that as "not
  given", never spread it over defaults.
- TUI tests use `testRender` from `@opentui/react/test-utils`, then set
  `globalThis.IS_REACT_ACT_ENVIRONMENT = false` because store I/O resolves outside `act()`.
  Wait for UI with a time-based `see()` helper (see `todos/tui/src/App.test.tsx`), not `waitForFrame`
  (which counts render passes and doesn't give async work time). Wait for text that only exists in the target screen;
  e.g. a task title is visible in both the details form and the list.
- In TUI forms read values from widget refs (`input.value`, `textarea.plainText`) at submit time, not from
  React state, to avoid stale values right after typing.
- `useKeyboard` handlers are global: every mounted handler sees every key, so gate on the current mode.

## Conventions
- Match existing style: no semicolons, double quotes, 2-space indent, short comments only where the
  why isn't obvious.
- Don't commit unless the user asks; the user reviews before committing.
