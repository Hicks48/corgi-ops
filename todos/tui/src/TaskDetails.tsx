import type { InputRenderable, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useEffect, useRef, useState } from "react"
import {
  formatLocalDateTime,
  STATUS_LABELS,
  STATUSES,
  type CustomField,
  type LocalDate,
  type NewTask,
  type Status,
  type Task,
} from "@corgiops/todos-core"
import { cycle } from "./cycle.ts"
import { FieldButtons, runFieldAction, type FieldAction } from "./FieldButtons.tsx"
import { NewFieldForm } from "./NewFieldForm.tsx"
import type { System } from "./system.ts"
import { STATUS_COLORS, theme } from "./theme.ts"

export type TaskValues = Required<Pick<NewTask, "title" | "description" | "status" | "targetDate">> &
  Pick<NewTask, "completionDate"> & { fields: CustomField[] }

interface TaskDetailsProps {
  /** Task being viewed/edited; omit to create a new one. */
  task?: Task
  today: LocalDate
  system: System
  /** Rejecting keeps the view open and shows the error. */
  onSave: (values: TaskValues) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
}

/** Custom fields are `custom:<name>`. */
type Field = "status" | "completionDate" | "targetDate" | "title" | "description" | `custom:${string}`

const customId = (name: string): Field => `custom:${name}`
const boxId = (field: Field) => `details-${field}`

/** Tall enough to show the whole value without scrolling, within reason. */
const textboxHeight = (value: string) => Math.min(10, Math.max(3, value.split("\n").length)) + 2

export function TaskDetails({ task, today, system, onSave, onDelete, onClose }: TaskDetailsProps) {
  const [status, setStatus] = useState<Status>(task?.status ?? "todo")
  const [customFields, setCustomFields] = useState<CustomField[]>(task?.fields ?? [])
  const [field, setField] = useState<Field>("title")
  const [addingField, setAddingField] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const titleRef = useRef<TextareaRenderable>(null)
  const descriptionRef = useRef<TextareaRenderable>(null)
  const targetRef = useRef<InputRenderable>(null)
  const completionRef = useRef<InputRenderable>(null)
  // Inputs are textareas too, so `plainText` reads either.
  const customRefs = useRef(new Map<string, TextareaRenderable>())
  const scrollRef = useRef<ScrollBoxRenderable>(null)

  const fields: Field[] = [
    "status",
    ...(status === "done" ? (["completionDate"] as const) : []),
    "targetDate",
    "title",
    ...customFields.map((f) => customId(f.name)),
    "description",
  ]

  useEffect(() => {
    scrollRef.current?.scrollChildIntoView(boxId(field))
  }, [field])

  /** Locked once saved; a new non-editable field can still be filled in before the first save. */
  const isLocked = (f: CustomField) => !f.editable && task?.fields.some((saved) => saved.name === f.name) === true

  /** Field as currently shown, including unsaved edits. */
  const currentValue = (f: CustomField): CustomField => {
    const widget = customRefs.current.get(f.name)
    if (isLocked(f) || !widget) return f
    const value = widget.plainText
    return { ...f, value: f.type === "text" && f.textbox ? value : value.trim() }
  }

  const fail = (err: Error) => setError(err.message)
  const show = (message: string) => {
    setError(null)
    setNotice(message)
  }

  // Read straight from the widgets so a save right after typing never sees stale state.
  const save = () =>
    onSave({
      status,
      // Titles are one logical line; a pasted newline becomes a space.
      title: titleRef.current?.plainText.replace(/\s*\n\s*/g, " ") ?? "",
      description: descriptionRef.current?.plainText ?? "",
      targetDate: targetRef.current?.value.trim() ?? "",
      completionDate: status === "done" ? completionRef.current?.value.trim() : undefined,
      fields: customFields.map(currentValue),
    }).catch(fail)

  const fieldAction = (action: FieldAction, f: CustomField) =>
    void runFieldAction(system, action, currentValue(f)).then(show, fail)

  const focusedCustom = customFields.find((f) => customId(f.name) === field)

  const removeField = (f: CustomField) => {
    const index = customFields.indexOf(f)
    setCustomFields(customFields.filter((other) => other !== f))
    // Land on the neighbour, or the description when the last field goes.
    const next = customFields[index + 1] ?? customFields[index - 1]
    setField(next ? customId(next.name) : "description")
    show(`Removed ${f.name} (ctrl+s to save, esc to discard)`)
  }

  const addField = (f: CustomField) => {
    setCustomFields([...customFields, f])
    setAddingField(false)
    setField(customId(f.name))
  }

  useKeyboard((key) => {
    if (addingField) return // NewFieldForm handles keys
    setNotice(null)
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
    if (key.ctrl) {
      const handled = ["s", "d", "n", "x", "y", "o"].includes(key.name)
      if (handled) key.preventDefault()
      switch (key.name) {
        case "s":
          return void save()
        case "d":
          if (task) setConfirmingDelete(true)
          return
        case "n":
          return setAddingField(true)
        case "x":
          if (focusedCustom) removeField(focusedCustom)
          return
        case "y":
          if (focusedCustom) fieldAction("copy", focusedCustom)
          return
        case "o":
          if (focusedCustom?.type === "link") fieldAction("open", focusedCustom)
          return
      }
    }
    if (field === "status" && (key.name === "left" || key.name === "right" || key.name === "space")) {
      setStatus(cycle(STATUSES, status, key.name === "left" ? -1 : 1))
    }
  })

  const focused = (target: Field) => !addingField && field === target
  const borderColor = (target: Field) => (focused(target) ? theme.accent : theme.border)
  const header = task ? `Task #${task.id}` : "New Task"

  const renderCustom = (f: CustomField) => {
    const id = customId(f.name)
    const locked = isLocked(f)
    const multiline = f.type === "text" && f.textbox
    const register = (widget: TextareaRenderable | null) => {
      if (widget) customRefs.current.set(f.name, widget)
      else customRefs.current.delete(f.name)
    }
    return (
      <box
        key={f.name}
        id={boxId(id)}
        title={` ${f.name} · ${f.type}${locked ? " · locked" : ""} `}
        border
        borderColor={borderColor(id)}
        flexDirection="row"
        gap={1}
        flexShrink={0}
        paddingLeft={1}
        height={locked ? undefined : multiline ? textboxHeight(f.value) : 3}
        onMouseDown={() => setField(id)}
      >
        {locked ? (
          <text fg={theme.dim} wrapMode="word" flexGrow={1} flexShrink={1}>
            {f.value || "—"}
          </text>
        ) : multiline ? (
          <textarea ref={register} initialValue={f.value} focused={focused(id)} wrapMode="word" flexGrow={1} />
        ) : (
          <input
            ref={register}
            value={f.value}
            placeholder={f.type === "date" ? "YYYY-MM-DD" : f.type === "timestamp" ? "ISO 8601, e.g. 2026-10-03T09:00:00Z" : ""}
            focused={focused(id)}
            flexGrow={1}
          />
        )}
        <FieldButtons type={f.type} active={field === id} onAction={(action) => fieldAction(action, f)} />
      </box>
    )
  }

  const footer = [
    "tab next field",
    "←→ status",
    "ctrl+s save",
    "esc back",
    "ctrl+n new field",
    ...(focusedCustom ? ["ctrl+x remove field", "ctrl+y copy", ...(focusedCustom.type === "link" ? ["ctrl+o open"] : [])] : []),
    ...(task ? ["ctrl+d delete"] : []),
  ]

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" flexShrink={0}>
        <box backgroundColor={theme.accent}>
          <text fg={theme.onAccent}>{` ${header} `}</text>
        </box>
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
          <box
            title=" Completed "
            border
            borderColor={borderColor("completionDate")}
            height={3}
            width={18}
            paddingLeft={1}
            onMouseDown={() => setField("completionDate")}
          >
            <input
              ref={completionRef}
              value={task?.completionDate ?? today}
              placeholder="YYYY-MM-DD"
              focused={focused("completionDate")}
            />
          </box>
        ) : null}
        <box
          title=" Target date "
          border
          borderColor={borderColor("targetDate")}
          height={3}
          width={18}
          paddingLeft={1}
          onMouseDown={() => setField("targetDate")}
        >
          <input
            ref={targetRef}
            value={task?.targetDate ?? today}
            placeholder="YYYY-MM-DD"
            focused={focused("targetDate")}
          />
        </box>
      </box>

      <scrollbox ref={scrollRef} flexGrow={1}>
        <box
          id={boxId("title")}
          title=" Title "
          border
          borderColor={borderColor("title")}
          height={4}
          flexShrink={0}
          paddingLeft={1}
          onMouseDown={() => setField("title")}
        >
          {/* A wrapping textarea so long titles are shown in full; enter moves on instead of adding a line. */}
          <textarea
            ref={titleRef}
            initialValue={task?.title ?? ""}
            placeholder="Required"
            focused={focused("title")}
            wrapMode="word"
            flexGrow={1}
            onKeyDown={(key) => {
              if (key.name !== "return") return
              key.preventDefault()
              setField(cycle(fields, "title", 1))
            }}
          />
        </box>
        {customFields.map(renderCustom)}
        <box
          id={boxId("description")}
          title=" Description "
          border
          borderColor={borderColor("description")}
          flexGrow={1}
          minHeight={textboxHeight(task?.description ?? "")}
          flexShrink={0}
          paddingLeft={1}
          onMouseDown={() => setField("description")}
        >
          <textarea
            ref={descriptionRef}
            initialValue={task?.description ?? ""}
            placeholder="Required"
            focused={focused("description")}
            wrapMode="word"
            flexGrow={1}
          />
        </box>
      </scrollbox>

      {task ? (
        <text fg={theme.dim} flexShrink={0}>
          {` Created ${formatLocalDateTime(task.createdAt)} · Updated ${formatLocalDateTime(task.updatedAt)}`}
        </text>
      ) : null}
      {addingField ? (
        <NewFieldForm taken={customFields.map((f) => f.name)} onAdd={addField} onCancel={() => setAddingField(false)} />
      ) : null}
      {confirmingDelete && task ? (
        <text fg={theme.error}>{` Delete #${task.id} "${task.title}"? y to confirm, any other key to cancel`}</text>
      ) : error ? (
        <text fg={theme.error}>{` ${error}`}</text>
      ) : notice ? (
        <text fg={theme.accent}>{` ${notice}`}</text>
      ) : null}
      <box flexDirection="row" flexWrap="wrap" columnGap={2} flexShrink={0} paddingLeft={1}>
        {footer.map((hint) => (
          <text key={hint} fg={theme.dim}>
            {hint}
          </text>
        ))}
      </box>
    </box>
  )
}
