import { useCallback, useEffect, useState } from "react"
import type { Task, TodoStore } from "@corgiops/todos-core"

/** Tasks from the store, kept in sync with on-disk changes made by other processes (CLI, MCP). */
export function useTasks(store: TodoStore) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<Task[]> => {
    try {
      const next = await store.list()
      setTasks(next)
      setError(null)
      return next
    } catch (err) {
      setError((err as Error).message)
      return []
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

  return { tasks, error, setError, reload }
}
