#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { TodoStore } from "@corgiops/todos-core"
import { App } from "./App.tsx"

const renderer = await createCliRenderer()

const exit = () => {
  renderer.destroy()
  process.exit(0)
}

createRoot(renderer).render(<App store={new TodoStore()} onExit={exit} />)
