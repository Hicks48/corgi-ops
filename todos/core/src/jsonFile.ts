import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { z } from "zod"
import { TodoError } from "./errors.ts"

const LOCK_STALE_MS = 10_000
const LOCK_RETRY_MS = 25
const LOCK_TIMEOUT_MS = 5_000

const isCode = (err: unknown, code: string) => (err as NodeJS.ErrnoException)?.code === code

interface JsonFileOptions<T> {
  dir: string
  /** File name inside `dir`; the lock is `<stem>.lock`. */
  name: string
  schema: z.ZodType<T>
  empty: () => T
  /** Upgrades older formats in memory before validation. */
  migrate?: (raw: unknown) => unknown
}

/** One validated JSON file, written under a lockfile with atomic renames. */
export class JsonFile<T> {
  readonly dir: string
  readonly path: string
  private readonly lock: string
  private readonly schema: z.ZodType<T>
  private readonly empty: () => T
  private readonly migrate: (raw: unknown) => unknown

  constructor({ dir, name, schema, empty, migrate = (raw) => raw }: JsonFileOptions<T>) {
    this.dir = dir
    this.path = join(dir, name)
    this.lock = join(dir, `${basename(name, ".json")}.lock`)
    this.schema = schema
    this.empty = empty
    this.migrate = migrate
  }

  async read(): Promise<T> {
    await mkdir(this.dir, { recursive: true })
    let raw: string
    try {
      raw = await readFile(this.path, "utf8")
    } catch (err) {
      if (isCode(err, "ENOENT")) return this.empty()
      throw err
    }
    try {
      return this.schema.parse(this.migrate(JSON.parse(raw)))
    } catch (err) {
      const detail = err instanceof z.ZodError ? z.prettifyError(err) : (err as Error).message
      throw new TodoError(`${this.path} is corrupt or has an unsupported format:\n${detail}`)
    }
  }

  async mutate<R>(fn: (data: T) => R): Promise<R> {
    await mkdir(this.dir, { recursive: true })
    await this.acquireLock()
    try {
      const data = await this.read()
      const result = fn(data)
      // Never let a bug write a file that the next read would reject.
      const valid = this.schema.safeParse(data)
      if (!valid.success) throw new TodoError(`refusing to write invalid data:\n${z.prettifyError(valid.error)}`)
      // Atomic replace so readers never see a half-written file.
      const tmp = `${this.path}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(data, null, 2) + "\n")
      await rename(tmp, this.path)
      return result
    } finally {
      await rm(this.lock, { force: true })
    }
  }

  private async acquireLock(): Promise<void> {
    const deadline = Date.now() + LOCK_TIMEOUT_MS
    for (;;) {
      try {
        const handle = await open(this.lock, "wx")
        await handle.close()
        return
      } catch (err) {
        if (!isCode(err, "EEXIST")) throw err
      }
      // A crashed writer leaves its lock behind; steal it once it is clearly stale.
      const age = await stat(this.lock).then(
        (s) => Date.now() - s.mtimeMs,
        () => 0,
      )
      if (age > LOCK_STALE_MS) {
        await rm(this.lock, { force: true })
        continue
      }
      if (Date.now() > deadline) throw new TodoError(`timed out waiting for lock ${this.lock}`)
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS))
    }
  }
}
