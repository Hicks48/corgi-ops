import type { CliRenderer } from "@opentui/core"
import { isWebUrl, TodoError } from "@corgiops/todos-core"

/** Side effects outside the terminal; injectable so tests don't touch the real clipboard or browser. */
export interface System {
  copy: (text: string) => Promise<void>
  open: (url: string) => Promise<void>
}

const run = async (cmd: string[], stdin?: string): Promise<boolean> => {
  try {
    const proc = Bun.spawn(cmd, { stdin: stdin === undefined ? "ignore" : "pipe", stdout: "ignore", stderr: "ignore" })
    if (stdin !== undefined && proc.stdin) {
      proc.stdin.write(stdin)
      await proc.stdin.end()
    }
    return (await proc.exited) === 0
  } catch {
    return false // command not installed
  }
}

const COPY_COMMANDS: string[][] =
  process.platform === "darwin" ? [["pbcopy"]] : [["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "-ib"]]

const OPEN_COMMAND = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open"

export const createSystem = (renderer: CliRenderer): System => ({
  copy: async (text) => {
    for (const cmd of COPY_COMMANDS) if (await run(cmd, text)) return
    // Over SSH etc.: ask the terminal to do it (OSC 52).
    if (!renderer.copyToClipboardOSC52(text)) throw new Error("could not copy to clipboard")
  },
  open: async (url) => {
    // Core already validates links; this guards against anything else reaching the OS handler.
    if (!isWebUrl(url)) throw new TodoError(`not an http(s) link: ${url}`)
    if (!(await run([OPEN_COMMAND, url]))) throw new Error(`could not open ${url}`)
  },
})
