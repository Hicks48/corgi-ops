import type { ScrollBoxRenderable } from "@opentui/core"
import { useEffect, useRef } from "react"
import { VIEW_LABELS, VIEWS, type Task, type View } from "@corgiops/todos-core"
import { cardId, TaskCard } from "./TaskCard.tsx"
import { theme } from "./theme.ts"

export interface ViewAction {
  label: string
  /** Key that triggers the action on the selected task. */
  key: string
}

export const VIEW_ACTIONS: Record<View, ViewAction> = {
  current: { label: "+1 day", key: "+" },
  upcoming: { label: "Pull to today", key: "t" },
  completed: { label: "Reopen", key: "r" },
}

const EMPTY_TEXT: Record<View, string> = {
  current: "Nothing on for today. Press a to add a task.",
  upcoming: "No upcoming tasks.",
  completed: "No completed tasks yet.",
}

const noteFor = (view: View, task: Task) =>
  view === "upcoming" ? task.targetDate : view === "completed" ? task.completionDate : undefined

interface ListViewProps {
  view: View
  tasks: Task[]
  selectedIndex: number
  today: string
  error: string | null
  onSwitchView: (view: View) => void
  onSelect: (index: number) => void
  onOpen: (task: Task) => void
  onAction: (task: Task) => void
}

export function ListView(props: ListViewProps) {
  const { view, tasks, selectedIndex, today, error, onSwitchView, onSelect, onOpen, onAction } = props
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const selected = tasks[selectedIndex]
  const action = VIEW_ACTIONS[view]

  useEffect(() => {
    if (selected) scrollRef.current?.scrollChildIntoView(cardId(selected))
  }, [selected])

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <box flexDirection="row" gap={1}>
          {VIEWS.map((v) => (
            <box key={v} onMouseDown={() => onSwitchView(v)} backgroundColor={v === view ? theme.accent : undefined}>
              <text fg={v === view ? theme.onAccent : theme.dim}>{` ${VIEW_LABELS[v]} `}</text>
            </box>
          ))}
        </box>
        <text fg={theme.dim}>{`${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} · ${today} `}</text>
      </box>

      <scrollbox ref={scrollRef} flexGrow={1}>
        {tasks.length === 0 ? <text fg={theme.dim}>{` ${EMPTY_TEXT[view]}`}</text> : null}
        {tasks.map((task, index) => (
          <TaskCard
            key={task.id}
            task={task}
            selected={index === selectedIndex}
            note={noteFor(view, task)}
            actionLabel={action.label}
            onClick={() => (index === selectedIndex ? onOpen(task) : onSelect(index))}
            onAction={() => onAction(task)}
          />
        ))}
      </scrollbox>

      {error ? <text fg={theme.error}>{` ${error}`}</text> : null}
      <text fg={theme.dim} flexShrink={0}>
        {` [ ] switch view  ↑↓ select  enter details  a add  ${action.key} ${action.label}  q quit`}
      </text>
    </box>
  )
}
