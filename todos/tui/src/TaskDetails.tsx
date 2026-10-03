import type { InputRenderable, TextareaRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useRef, useState } from "react"
import { formatLocalDateTime, STATUS_LABELS, STATUSES, type LocalDate, type NewTask, type Status, type Task } from "@corgiops/todos-core"
import { STATUS_COLORS, theme } from "./theme.ts"

export type TaskValues = Required<Pick<NewTask, "title" | "description" | "status" | "targetDate">> &
  Pick<NewTask, "completionDate">

interface TaskDetailsProps {
  /** Task being viewed/edited; omit to create a new one. */
  task?: Task
  today: LocalDate
  /** Rejecting keeps the view open and shows the error. */
  onSave: (values: TaskValues) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
}

type Field = "status" | "completionDate" | "targetDate" | "title" | "description"

const cycle = <T,>(items: readonly T[], current: T, delta: number): T =>
  items[(items.indexOf(current) + delta + items.length) % items.length]!

export function TaskDetails({ task, today, onSave, onDelete, onClose }: TaskDetailsProps) {
  const [status, setStatus] = useState<Status>(task?.status ?? "todo")
  const [field, setField] = useState<Field>("title")
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<TextareaRenderable>(null)
  const descriptionRef = useRef<TextareaRenderable>(null)
  const targetRef = useRef<InputRenderable>(null)
  const completionRef = useRef<InputRenderable>(null)

  const fields: Field[] =
    status === "done"
      ? ["status", "completionDate", "targetDate", "title", "description"]
      : ["status", "targetDate", "title", "description"]

  const fail = (err: Error) => setError(err.message)

  // Read straight from the widgets so a save right after typing never sees stale state.
  const save = () =>
    onSave({
      status,
      // Titles are one logical line; a pasted newline becomes a space.
      title: titleRef.current?.plainText.replace(/\s*\n\s*/g, " ") ?? "",
      description: descriptionRef.current?.plainText ?? "",
      targetDate: targetRef.current?.value.trim() ?? "",
      completionDate: status === "done" ? completionRef.current?.value.trim() : undefined,
    }).catch(fail)

  useKeyboard((key) => {
    if (confirmingDelete) {
      setConfirmingDelete(false)
      if (key.name === "y") void onDelete().catch(fail)
      return
    }
    if (key.name === "escape") return onClose()
    if (key.name === "tab") {
      key.preventDefault()
      return setField(cycle(fields, field, key.shift ? -1 : 1))
    }
    if (key.ctrl && key.name === "s") {
      key.preventDefault()
      return void save()
    }
    if (key.ctrl && key.name === "d" && task) {
      key.preventDefault()
      return setConfirmingDelete(true)
    }
    if (field === "status" && (key.name === "left" || key.name === "right" || key.name === "space")) {
      setStatus(cycle(STATUSES, status, key.name === "left" ? -1 : 1))
    }
  })

  const borderColor = (target: Field) => (field === target ? theme.accent : theme.border)
  const header = task ? `Task #${task.id}` : "New Task"

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <box backgroundColor={theme.accent}>
          <text fg={theme.onAccent}>{` ${header} `}</text>
        </box>
        {task ? (
          <text fg={theme.dim}>
            {`Created ${formatLocalDateTime(task.createdAt)} · Updated ${formatLocalDateTime(task.updatedAt)} `}
          </text>
        ) : null}
      </box>

      <box flexDirection="row" gap={1} flexShrink={0}>
        <box
          title=" Status "
          border
          borderColor={borderColor("status")}
          height={3}
          width={19}
          paddingLeft={1}
          onMouseDown={() => {
            setField("status")
            setStatus(cycle(STATUSES, status, 1))
          }}
        >
          <text fg={STATUS_COLORS[status]}>{`‹ ${STATUS_LABELS[status]} ›`}</text>
        </box>
        {status === "done" ? (
          <box title=" Completed " border borderColor={borderColor("completionDate")} height={3} width={18} paddingLeft={1}>
            <input
              ref={completionRef}
              value={task?.completionDate ?? today}
              placeholder="YYYY-MM-DD"
              focused={field === "completionDate"}
            />
          </box>
        ) : null}
        <box title=" Target date " border borderColor={borderColor("targetDate")} height={3} width={18} paddingLeft={1}>
          <input
            ref={targetRef}
            value={task?.targetDate ?? today}
            placeholder="YYYY-MM-DD"
            focused={field === "targetDate"}
          />
        </box>
      </box>

      <box title=" Title " border borderColor={borderColor("title")} height={4} flexShrink={0} paddingLeft={1}>
        {/* A wrapping textarea so long titles are shown in full; enter moves on instead of adding a line. */}
        <textarea
          ref={titleRef}
          initialValue={task?.title ?? ""}
          placeholder="Required"
          focused={field === "title"}
          wrapMode="word"
          flexGrow={1}
          onKeyDown={(key) => {
            if (key.name !== "return") return
            key.preventDefault()
            setField("description")
          }}
        />
      </box>
      <box title=" Description " border borderColor={borderColor("description")} flexGrow={1} paddingLeft={1}>
        <textarea
          ref={descriptionRef}
          initialValue={task?.description ?? ""}
          placeholder="Required"
          focused={field === "description"}
          wrapMode="word"
          flexGrow={1}
        />
      </box>

      {confirmingDelete && task ? (
        <text fg={theme.error}>{` Delete #${task.id} "${task.title}"? y to confirm, any other key to cancel`}</text>
      ) : error ? (
        <text fg={theme.error}>{` ${error}`}</text>
      ) : null}
      <text fg={theme.dim} flexShrink={0}>
        {` tab next field  ←→ change status  ctrl+s save  esc back${task ? "  ctrl+d delete" : ""}`}
      </text>
    </box>
  )
}
