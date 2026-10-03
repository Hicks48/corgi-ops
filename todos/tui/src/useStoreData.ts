import { useCallback, useEffect, useState } from "react"
import type { Task, Template, TodoStore } from "@corgiops/todos-core"

/** Tasks and templates from the store, kept in sync with on-disk changes made by other processes (CLI, MCP). */
export function useStoreData(store: TodoStore) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<{ tasks: Task[]; templates: Template[] }> => {
    try {
      const [nextTasks, nextTemplates] = await Promise.all([store.list(), store.listTemplates()])
      setTasks(nextTasks)
      setTemplates(nextTemplates)
      setError(null)
      return { tasks: nextTasks, templates: nextTemplates }
    } catch (err) {
      setError((err as Error).message)
      return { tasks: [], templates: [] }
    }
  }, [store])

  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false
    void reload()
    void store.watch(() => void reload()).then((unsubscribe) => {
      if (cancelled) unsubscribe()
      else stop = unsubscribe
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [store, reload])

  return { tasks, templates, error, setError, reload }
}
