# Releasing

Each app ships as one standalone binary per platform (Bun runtime and OpenTUI native lib embedded), so
users need neither Bun nor `bun install`. Built with `bun build --compile` by `scripts/release.ts`.

Platforms: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`.
Tags are per app: `<app>-v<version>`, e.g. `todos-v0.1.0`. The version lives in `<app>/bin/package.json`
(printed by `corgi-todos --version`).

## Manual release
Run on macOS (darwin binaries are ad-hoc signed with `codesign`). Needs the
[GitHub CLI](https://cli.github.com) (`gh auth login`).

1. On a clean, up-to-date `main`, check everything passes:
   ```bash
   bun test && bun run typecheck
   ```
2. Bump `version` in `todos/bin/package.json`, commit and push.
3. Fetch OpenTUI's native packages for all platforms (`bun install` only fetches the host's), then build:
   ```bash
   bun install --os="*" --cpu="*"
   bun run todos:release
   ```
   Output: `dist/corgi-todos-<platform>.tar.gz` and `dist/SHA256SUMS`.
4. Smoke test the host binary:
   ```bash
   tar -xzf dist/corgi-todos-darwin-arm64.tar.gz -C /tmp && /tmp/corgi-todos --version && /tmp/corgi-todos
   ```
5. Tag and publish:
   ```bash
   gh release create todos-v0.1.0 dist/* --title "Todos v0.1.0" --generate-notes
   ```

Asset names carry no version, so `releases/latest/download/corgi-todos-<platform>.tar.gz` always points
at the newest release. With more than one app, "latest" is whichever app released last; link to a tag
(`releases/download/todos-v0.1.0/...`) instead.

## Notes
- Binaries are not signed or notarized. macOS doesn't quarantine files fetched with `curl`, but one
  downloaded in a browser is blocked until `xattr -d com.apple.quarantine corgi-todos`.
- Only the macOS arm64 binary has been run so far; the others are cross-compiled.
