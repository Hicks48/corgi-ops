import type { InputRenderable, KeyEvent } from "@opentui/core"
import { useRef, useState } from "react"
import {
  applyTemplate,
  formatLocalDateTime,
  STATUS_LABELS,
  STATUSES,
  type LocalDate,
  type NewTask,
  type Status,
  type Task,
  type Template,
} from "@corgiops/todos-core"
import { cycle } from "./cycle.ts"
import { DateInput } from "./DateInput.tsx"
import { DetailsForm, type FocusId, type FormApi, type FormValues } from "./DetailsForm.tsx"
import type { System } from "./system.ts"
import { STATUS_COLORS, theme } from "./theme.ts"

export type TaskValues = Required<Pick<NewTask, "title" | "description" | "status" | "targetDate">> &
  Pick<NewTask, "completionDate"> &
  FormValues

interface TaskDetailsProps {
  /** Task being viewed/edited; omit to create a new one. */
  task?: Task
  /** Offered in a picker when creating a task. */
  templates: Template[]
  today: LocalDate
  system: System
  /** Rejecting keeps the view open and shows the error. */
  onSave: (values: TaskValues) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
}

const PICKER_ROWS = 8

export function TaskDetails({ task, templates, today, system, onSave, onDelete, onClose }: TaskDetailsProps) {
  const [status, setStatus] = useState<Status>(task?.status ?? "todo")
  const [picking, setPicking] = useState(false)
  const [pickIndex, setPickIndex] = useState(0)
  const [applied, setApplied] = useState<string | null>(null)
  const targetRef = useRef<InputRenderable>(null)
  const completionRef = useRef<InputRenderable>(null)

  const canPick = !task && templates.length > 0
  const topIds: FocusId[] = [
    ...(canPick ? ["template"] : []),
    "status",
    ...(status === "done" ? ["completionDate"] : []),
    "targetDate",
  ]

  const save = (values: FormValues) =>
    onSave({
      ...values,
      status,
      targetDate: targetRef.current?.value.trim() ?? "",
      completionDate: status === "done" ? completionRef.current?.value.trim() : undefined,
    })

  const pick = (api: FormApi, template: Template) => {
    api.replace(applyTemplate(api.values(), template))
    setApplied(template.name)
    setPicking(false)
    api.setFocus("title")
  }

  const onKey = (key: KeyEvent, api: FormApi) => {
    if (picking) {
      if (key.name === "escape") return setPicking(false)
      if (key.name === "up" || key.name === "k") return setPickIndex(Math.max(0, pickIndex - 1))
      if (key.name === "down" || key.name === "j") return setPickIndex(Math.min(templates.length - 1, pickIndex + 1))
      if (key.name === "return") return pick(api, templates[pickIndex]!)
      return
    }
    if (api.focus === "template" && (key.name === "return" || key.name === "space")) return setPicking(true)
    if (api.focus === "status" && (key.name === "left" || key.name === "right" || key.name === "space")) {
      setStatus(cycle(STATUSES, status, key.name === "left" ? -1 : 1))
    }
  }

  // Scroll the picker so the highlighted template stays in view.
  const pickStart = Math.max(0, pickIndex - PICKER_ROWS + 1)

  const renderTop = (api: FormApi) => (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" gap={1}>
        {canPick ? (
          <box
            title=" Template "
            border
            borderColor={picking ? theme.accent : api.borderColor("template")}
            height={3}
            width={24}
            paddingLeft={1}
            onMouseDown={() => {
              api.setFocus("template")
              setPicking(!picking)
            }}
          >
            <text fg={applied ? theme.text : theme.dim} wrapMode="none" truncate>
              {`${applied ?? "none"} ▾`}
            </text>
          </box>
        ) : null}
        <box
          title=" Status "
          border
          borderColor={api.borderColor("status")}
          height={3}
          width={19}
          paddingLeft={1}
          onMouseDown={() => {
            api.setFocus("status")
            setStatus(cycle(STATUSES, status, 1))
          }}
        >
          <text fg={STATUS_COLORS[status]}>{`‹ ${STATUS_LABELS[status]} ›`}</text>
        </box>
        {status === "done" ? (
          <box
            title=" Completed "
            border
            borderColor={api.borderColor("completionDate")}
            height={3}
            width={18}
            paddingLeft={1}
            onMouseDown={() => api.setFocus("completionDate")}
          >
            <DateInput ref={completionRef} value={task?.completionDate ?? today} focused={api.focused("completionDate")} />
          </box>
        ) : null}
        <box
          title=" Target date "
          border
          borderColor={api.borderColor("targetDate")}
          height={3}
          width={18}
          paddingLeft={1}
          onMouseDown={() => api.setFocus("targetDate")}
        >
          <DateInput ref={targetRef} value={task?.targetDate ?? today} focused={api.focused("targetDate")} />
        </box>
      </box>
      {picking ? (
        <box
          title=" Pick a template · ↑↓ enter esc "
          border
          borderColor={theme.accent}
          flexDirection="column"
          width={48}
          paddingLeft={1}
        >
          {templates.slice(pickStart, pickStart + PICKER_ROWS).map((t) => (
            <box key={t.id} onMouseDown={() => pick(api, t)} backgroundColor={t === templates[pickIndex] ? theme.accent : undefined}>
              <text fg={t === templates[pickIndex] ? theme.onAccent : theme.text} wrapMode="none" truncate>
                {t.title ? `${t.name} · ${t.title}` : t.name}
              </text>
            </box>
          ))}
        </box>
      ) : null}
    </box>
  )

  return (
    <DetailsForm
      header={task ? `Task #${task.id}` : "New Task"}
      system={system}
      initial={{ title: task?.title ?? "", description: task?.description ?? "", fields: task?.fields ?? [] }}
      topIds={topIds}
      renderTop={renderTop}
      onKey={onKey}
      suspended={picking}
      // Locked once saved; a new non-editable field can still be filled in before the first save.
      isLocked={(f) => !f.editable && task?.fields.some((saved) => saved.name === f.name) === true}
      textPlaceholder="Required"
      onSave={save}
      onDelete={task ? { prompt: `Delete #${task.id} "${task.title}"`, run: onDelete } : undefined}
      onClose={onClose}
      hints={[...(canPick ? ["enter pick template"] : []), "←→ status"]}
      meta={task ? `Created ${formatLocalDateTime(task.createdAt)} · Updated ${formatLocalDateTime(task.updatedAt)}` : undefined}
    />
  )
}
