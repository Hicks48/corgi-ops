import { useKeyboard } from "@opentui/react"
import { useEffect, useState } from "react"
import { tasksInView, VIEWS, type CustomField, type Task, type Template, type TodoStore, type View } from "@corgiops/todos-core"
import { runFieldAction, type FieldAction } from "./FieldButtons.tsx"
import { ListView, VIEW_ACTIONS } from "./ListView.tsx"
import { TaskDetails, type TaskValues } from "./TaskDetails.tsx"
import type { System } from "./system.ts"
import { TemplateDetails, type TemplateValues } from "./TemplateDetails.tsx"
import { TemplateListView } from "./TemplateListView.tsx"
import { useStoreData } from "./useStoreData.ts"

type Mode =
  | { kind: "list" }
  | { kind: "details"; task?: Task }
  | { kind: "templates" }
  | { kind: "template"; template?: Template }

interface AppProps {
  store: TodoStore
  system: System
  onExit: () => void
}

export function App({ store, system, onExit }: AppProps) {
  const { tasks, templates, error, setError, reload } = useStoreData(store)
  const [mode, setMode] = useState<Mode>({ kind: "list" })
  const [view, setView] = useState<View>("current")
  const [indexes, setIndexes] = useState<Record<View, number>>({ completed: 0, current: 0, upcoming: 0 })
  const [templateIndex, setTemplateIndex] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
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

  const selectedTemplateIndex = Math.max(0, Math.min(templateIndex, templates.length - 1))
  const selectedTemplate = templates[selectedTemplateIndex]

  const select = (index: number) => setIndexes((current) => ({ ...current, [view]: index }))
  const switchView = (delta: number) => {
    const next = VIEWS[VIEWS.indexOf(view) + delta]
    if (next) setView(next)
  }

  /** Reloads, then shows `task` in whichever view it now belongs to. */
  const reloadAndShow = async (task: Task) => {
    const all = (await reload()).tasks
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

  const fieldAction = async (action: FieldAction, field: CustomField) => {
    try {
      setNotice(await runFieldAction(system, action, field))
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

  const saveTemplate = async (values: TemplateValues) => {
    const editing = mode.kind === "template" ? mode.template : undefined
    const template = editing ? await store.updateTemplate(editing.id, values) : await store.addTemplate(values)
    const index = (await reload()).templates.findIndex((t) => t.id === template.id)
    setTemplateIndex(Math.max(0, index))
    setMode({ kind: "templates" })
  }

  const removeTemplate = async () => {
    if (mode.kind === "template" && mode.template) await store.removeTemplate(mode.template.id)
    await reload()
    setMode({ kind: "templates" })
  }

  useKeyboard((key) => {
    if (mode.kind === "templates") {
      switch (key.name) {
        case "q":
          return onExit()
        case "escape":
        case "p":
          return setMode({ kind: "list" })
        case "up":
        case "k":
          return setTemplateIndex(Math.max(0, selectedTemplateIndex - 1))
        case "down":
        case "j":
          return setTemplateIndex(Math.min(templates.length - 1, selectedTemplateIndex + 1))
        case "return":
          if (selectedTemplate) setMode({ kind: "template", template: selectedTemplate })
          return
        case "a":
          return setMode({ kind: "template" })
      }
      return
    }
    if (mode.kind !== "list") return
    setNotice(null)
    // Match printable keys on the typed character, not key.name: with a modifier (e.g. alt+8 for `[` on
    // Nordic layouts) some terminals name the base key instead.
    switch (key.sequence) {
      case VIEW_ACTIONS[view].key:
        if (selected) void runAction(selected)
        return
      case "[":
        return switchView(-1)
      case "]":
        return switchView(1)
    }
    switch (key.name) {
      case "q":
        return onExit()
      case "left":
        return switchView(-1)
      case "right":
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
      case "p":
        return setMode({ kind: "templates" })
    }
  })

  if (mode.kind === "details") {
    return (
      <TaskDetails
        key={mode.task?.id ?? "new"}
        task={mode.task}
        templates={templates}
        today={today}
        system={system}
        onSave={save}
        onDelete={remove}
        onClose={() => setMode({ kind: "list" })}
      />
    )
  }

  if (mode.kind === "template") {
    return (
      <TemplateDetails
        key={mode.template?.id ?? "new"}
        template={mode.template}
        system={system}
        onSave={saveTemplate}
        onDelete={removeTemplate}
        onClose={() => setMode({ kind: "templates" })}
      />
    )
  }

  if (mode.kind === "templates") {
    return (
      <TemplateListView
        templates={templates}
        selectedIndex={selectedTemplateIndex}
        error={error}
        onSelect={setTemplateIndex}
        onOpen={(template) => setMode({ kind: "template", template })}
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
      notice={notice}
      onSwitchView={setView}
      onSelect={select}
      onOpen={(task) => setMode({ kind: "details", task })}
      onAction={(task) => void runAction(task)}
      onFieldAction={(action, field) => void fieldAction(action, field)}
    />
  )
}
