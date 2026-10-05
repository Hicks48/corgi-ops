#!/usr/bin/env bun
// Builds an app's standalone release binaries into dist/: one .tar.gz per platform plus SHA256SUMS.
// Usage: bun scripts/release.ts <app>
import { $ } from "bun"
import { mkdir, rm } from "node:fs/promises"
import { dirname, resolve } from "node:path"

const APPS: Record<string, { entry: string; binary: string }> = {
  todos: { entry: "todos/bin/src/index.ts", binary: "corgi-todos" },
}

const TARGETS = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"]

const appName = process.argv[2] ?? ""
const app = APPS[appName]
if (!app) {
  console.error(`usage: bun scripts/release.ts <app> (one of ${Object.keys(APPS).join(", ")})`)
  process.exit(2)
}

// OpenTUI's native lib comes from a per-platform optional dependency; bun install only fetches the host's.
const opentuiCore = dirname(Bun.resolveSync("@opentui/core/package.json", resolve(`${appName}/tui`)))
const resolves = (pkg: string) => {
  try {
    Bun.resolveSync(pkg, opentuiCore)
    return true
  } catch {
    return false
  }
}
const missing = TARGETS.filter((t) => !resolves(`@opentui/core-${t}/package.json`))
if (missing.length) {
  console.error(`missing OpenTUI native packages for ${missing.join(", ")}; run: bun install --os="*" --cpu="*"`)
  process.exit(1)
}

const dist = "dist"
await rm(dist, { recursive: true, force: true })
await mkdir(dist)

const sums: string[] = []
for (const target of TARGETS) {
  const name = `${app.binary}-${target}`
  const dir = `${dist}/${name}`
  await mkdir(dir)
  // No autoloading: a .env or bunfig.toml in the user's cwd must not change how the binary runs.
  await $`bun build ${app.entry} --compile --minify --target=bun-${target} --outfile ${dir}/${app.binary} --no-compile-autoload-dotenv --no-compile-autoload-bunfig`.quiet()
  // Cross-compiled darwin binaries keep Bun's own signature, which no longer matches; replace it with an
  // ad-hoc one so macOS sees a valid signature.
  if (target.startsWith("darwin")) await $`codesign --force --sign - ${dir}/${app.binary}`.quiet()
  await $`tar -czf ${dist}/${name}.tar.gz -C ${dir} ${app.binary}`
  await rm(dir, { recursive: true })
  const hash = new Bun.CryptoHasher("sha256").update(await Bun.file(`${dist}/${name}.tar.gz`).arrayBuffer()).digest("hex")
  sums.push(`${hash}  ${name}.tar.gz`)
  console.log(`built ${dist}/${name}.tar.gz`)
}
await Bun.write(`${dist}/SHA256SUMS`, sums.join("\n") + "\n")

// bun build --compile leaves a copy of the host runtime behind in the cwd when building for the host.
for (const leftover of new Bun.Glob(".*.bun-build").scanSync({ dot: true })) await rm(leftover)
