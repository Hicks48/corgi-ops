// Task text can come from agents; control characters (ANSI/OSC escapes etc.) could take over the terminal.
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g
/** Drops control characters except newline and tab. */
export const terminalSafe = (text: string): string => text.replace(CONTROL_CHARS, "")
/** JSON.stringify escapes C0 but not DEL / C1; escape those too (they only occur inside strings). */
export const terminalSafeJson = (value: unknown): string =>
  JSON.stringify(value, null, 2).replace(/[\u007f-\u009f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
