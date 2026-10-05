#!/usr/bin/env bun
// Entry of the release binary: one executable for all adapters, since each compiled binary embeds the
// whole Bun runtime. Adapters are imported lazily so only the chosen one starts.
import pkg from "../package.json"

const [command] = process.argv.slice(2)

if (command === undefined) await import("../../tui/src/index.tsx")
else if (command === "mcp") await import("../../mcp/src/index.ts")
else if (command === "--version" || command === "-v") console.log(pkg.version)
else await import("../../cli/src/index.ts")
