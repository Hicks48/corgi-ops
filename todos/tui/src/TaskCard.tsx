import { TextAttributes } from "@opentui/core"
import type { CustomField, Task } from "@corgiops/todos-core"
import { FieldButtons, type FieldAction } from "./FieldButtons.tsx"
import { STATUS_BADGES, STATUS_COLORS, theme } from "./theme.ts"

export const cardId = (task: Task) => `task-${task.id}`

interface TaskCardProps {
  task: Task
  selected: boolean
  /** Dim note next to the title, e.g. a date. */
  note?: string
  actionLabel: string
  onClick: () => void
  onAction: () => void
  onFieldAction: (action: FieldAction, field: CustomField) => void
}

export function TaskCard({ task, selected, note, actionLabel, onClick, onAction, onFieldAction }: TaskCardProps) {
  return (
    <box
      id={cardId(task)}
      border
      borderStyle="rounded"
      borderColor={selected ? theme.accent : theme.border}
      flexDirection="column"
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      onMouseDown={onClick}
    >
      <box flexDirection="row" gap={1}>
        <text fg={STATUS_COLORS[task.status]} flexShrink={0}>
          {STATUS_BADGES[task.status]}
        </text>
        <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none" truncate flexGrow={1} flexShrink={1}>
          {task.title}
        </text>
        {note ? (
          <text fg={theme.dim} flexShrink={0}>
            {note}
          </text>
        ) : null}
        <box
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation()
            onAction()
          }}
        >
          <text fg={selected ? theme.accent : theme.dim}>{`[ ${actionLabel} ]`}</text>
        </box>
      </box>
      {task.fields
        .filter((field) => field.visibleOnLists)
        .map((field) => (
          <box key={field.name} flexDirection="row" gap={1}>
            <text fg={theme.dim} flexShrink={0}>{`${field.name}:`}</text>
            <text fg={theme.text} wrapMode="none" truncate flexGrow={1} flexShrink={1}>
              {/* One line even for textbox fields. */}
              {field.value.replace(/\s*\n\s*/g, " ")}
            </text>
            {field.value ? (
              <FieldButtons type={field.type} active={selected} onAction={(action) => onFieldAction(action, field)} />
            ) : null}
          </box>
        ))}
      <text fg={theme.dim} wrapMode="word" maxHeight={3}>
        {task.description}
      </text>
    </box>
  )
}
