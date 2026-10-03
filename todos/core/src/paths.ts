import { homedir } from "node:os"
import { join } from "node:path"

/** Root for all corgi-ops app data. Override with CORGIOPS_HOME (used by tests). */
export const corgiopsHome = (): string => process.env.CORGIOPS_HOME ?? join(homedir(), ".corgiops")

export const todosDir = (): string => join(corgiopsHome(), "todos")
