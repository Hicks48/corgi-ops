/** User-facing errors; adapters show these and let anything else crash. */
export class TodoError extends Error {
  override name = "TodoError"
}
