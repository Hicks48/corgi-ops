import { useKeyboard } from "@opentui/react"
import { useEffect, useState } from "react"
import { tasksInView, VIEWS, type Task, type TodoStore, type View } from "@corgiops/todos-core"
import { ListView, VIEW_ACTIONS } from "./ListView.tsx"
import { TaskDetails, type TaskValues } from "./TaskDetails.tsx"
import { useTasks } from "./useTasks.ts"

type Mode = { kind: "list" } | { kind: "details"; task?: Task }

interface AppProps {
  store: TodoStore
  onExit: () => void
}

export function App({ store, onExit }: AppProps) {
  const { tasks, error, setError, reload } = useTasks(store)
  const [mode, setMode] = useState<Mode>({ kind: "list" })
  const [view, setView] = useState<View>("current")
  const [indexes, setIndexes] = useState<Record<View, number>>({ completed: 0, current: 0, upcoming: 0 })
  const [, setTick] = useState(0)

  // Re-render each minute so views roll over at midnight.
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(timer)
  }, [])

  const today = store.today()
  const viewTasks = tasksInView(tasks, view, today)
  const selectedIndex = Math.max(0, Math.min(indexes[view], viewTasks.length - 1))
  const selected = viewTasks[selectedIndex]

  const select = (index: number) => setIndexes((current) => ({ ...current, [view]: index }))
  const switchView = (delta: number) => {
    const next = VIEWS[VIEWS.indexOf(view) + delta]
    if (next) setView(next)
  }

  /** Reloads, then shows `task` in whichever view it now belongs to. */
  const reloadAndShow = async (task: Task) => {
    const all = await reload()
    const target = VIEWS.find((v) => tasksInView(all, v, today).some((t) => t.id === task.id)) ?? view
    const index = tasksInView(all, target, today).findIndex((t) => t.id === task.id)
    setView(target)
    setIndexes((current) => ({ ...current, [target]: Math.max(0, index) }))
  }

  /** The view's quick action. The task leaves the view, so the cursor lands on its neighbour. */
  const runAction = async (task: Task) => {
    const actions: Record<View, (id: number) => Promise<Task>> = {
      current: (id) => store.postpone(id),
      upcoming: (id) => store.pullToToday(id),
      completed: (id) => store.reopen(id),
    }
    try {
      await actions[view](task.id)
      await reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const save = async (values: TaskValues) => {
    const editing = mode.kind === "details" ? mode.task : undefined
    const task = editing ? await store.update(editing.id, values) : await store.add(values)
    await reloadAndShow(task)
    setMode({ kind: "list" })
  }

  const remove = async () => {
    if (mode.kind === "details" && mode.task) await store.remove(mode.task.id)
    await reload()
    setMode({ kind: "list" })
  }

  useKeyboard((key) => {
    if (mode.kind !== "list") return
    if (key.sequence === VIEW_ACTIONS[view].key) {
      if (selected) void runAction(selected)
      return
    }
    switch (key.name) {
      case "q":
        return onExit()
      case "[":
        return switchView(-1)
      case "]":
        return switchView(1)
      case "up":
      case "k":
        return select(Math.max(0, selectedIndex - 1))
      case "down":
      case "j":
        return select(Math.min(viewTasks.length - 1, selectedIndex + 1))
      case "return":
        if (selected) setMode({ kind: "details", task: selected })
        return
      case "a":
        return setMode({ kind: "details" })
    }
  })

  if (mode.kind === "details") {
    return (
      <TaskDetails
        key={mode.task?.id ?? "new"}
        task={mode.task}
        today={today}
        onSave={save}
        onDelete={remove}
        onClose={() => setMode({ kind: "list" })}
      />
    )
  }

  return (
    <ListView
      view={view}
      tasks={viewTasks}
      selectedIndex={selectedIndex}
      today={today}
      error={error}
      onSwitchView={setView}
      onSelect={select}
      onOpen={(task) => setMode({ kind: "details", task })}
      onAction={(task) => void runAction(task)}
    />
  )
}
