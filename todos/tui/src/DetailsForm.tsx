import type { KeyEvent, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useEffect, useRef, useState, type ReactNode } from "react"
import type { CustomField, TemplateTarget } from "@corgiops/todos-core"
import { cycle } from "./cycle.ts"
import { DateInput } from "./DateInput.tsx"
import { FieldButtons, runFieldAction, type FieldAction } from "./FieldButtons.tsx"
import { Hints } from "./Hints.tsx"
import { NewFieldForm } from "./NewFieldForm.tsx"
import type { System } from "./system.ts"
import { theme } from "./theme.ts"

/** Title, custom fields and description, shared by tasks and templates. */
export type FormValues = TemplateTarget

/** Focusable parts of the form. Custom fields are `custom:<name>`; the top row brings its own ids. */
export type FocusId = string

const customId = (name: string): FocusId => `custom:${name}`
const boxId = (focus: FocusId) => `details-${focus}`

/** Tall enough to show the whole value without scrolling, within reason. */
const textboxHeight = (value: string) => Math.min(10, Math.max(3, value.split("\n").length)) + 2

/** What the top row (status, dates, name, template picker...) gets to work with. */
export interface FormApi {
  focus: FocusId
  setFocus: (focus: FocusId) => void
  /** Whether `id` has focus and the form isn't busy with a popup. */
  focused: (id: FocusId) => boolean
  borderColor: (id: FocusId) => string
  /** Values as currently shown, including unsaved edits. */
  values: () => FormValues
  /** Replaces what the form shows. */
  replace: (values: FormValues) => void
  setError: (message: string) => void
  setNotice: (message: string) => void
}

interface DetailsFormProps {
  header: string
  system: System
  initial: FormValues
  /** Focus ids in the top row, in tab order before the title. */
  topIds: FocusId[]
  renderTop: (api: FormApi) => ReactNode
  /** Keys the form doesn't handle itself (incl. ctrl+y / ctrl+o off a custom field), and every key while `suspended`. */
  onKey?: (key: KeyEvent, api: FormApi) => void
  /** True while the parent (e.g. a dropdown) owns the keyboard. */
  suspended?: boolean
  /** Locked fields are shown read-only. */
  isLocked?: (field: CustomField) => boolean
  textPlaceholder: string
  /** Rejecting keeps the form open and shows the error. */
  onSave: (values: FormValues) => Promise<void>
  /** Omit when there's nothing to delete yet. */
  onDelete?: { prompt: string; run: () => Promise<void> }
  onClose: () => void
  /** Extra footer hints, shown before the field hints. */
  hints: string[]
  /** Dim line above the footer, e.g. timestamps. */
  meta?: string
}

/** Details / edit form with custom fields. Owns the keyboard unless `suspended`. */
export function DetailsForm(props: DetailsFormProps) {
  const { header, initial, topIds, renderTop, onKey, suspended = false, isLocked = () => false, textPlaceholder } = props
  const { system, onSave, onDelete, onClose, hints, meta } = props
  // Bumped by `replace` so the uncontrolled widgets remount with the new values.
  const [seed, setSeed] = useState({ ...initial, generation: 0 })
  const [customFields, setCustomFields] = useState<CustomField[]>(initial.fields)
  const [focus, setFocus] = useState<FocusId>("title")
  const [addingField, setAddingField] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const titleRef = useRef<TextareaRenderable>(null)
  const descriptionRef = useRef<TextareaRenderable>(null)
  // Inputs are textareas too, so `plainText` reads either.
  const customRefs = useRef(new Map<string, TextareaRenderable>())
  const scrollRef = useRef<ScrollBoxRenderable>(null)

  const order: FocusId[] = [...topIds, "title", ...customFields.map((f) => customId(f.name)), "description"]

  useEffect(() => {
    scrollRef.current?.scrollChildIntoView(boxId(focus))
  }, [focus])

  /** Field as currently shown, including unsaved edits. */
  const currentValue = (f: CustomField): CustomField => {
    const widget = customRefs.current.get(f.name)
    if (isLocked(f) || !widget) return f
    const value = widget.plainText
    return { ...f, value: f.type === "text" && f.textbox ? value : value.trim() }
  }

  // Read straight from the widgets so a save right after typing never sees stale state.
  const values = (): FormValues => ({
    // Titles are one logical line; a pasted newline becomes a space.
    title: titleRef.current?.plainText.replace(/\s*\n\s*/g, " ") ?? "",
    description: descriptionRef.current?.plainText ?? "",
    fields: customFields.map(currentValue),
  })

  const replace = (next: FormValues) => {
    setSeed((current) => ({ ...next, generation: current.generation + 1 }))
    setCustomFields(next.fields)
  }

  const fail = (err: Error) => setError(err.message)
  const show = (message: string) => {
    setError(null)
    setNotice(message)
  }

  const busy = addingField || suspended
  const focused = (id: FocusId) => !busy && focus === id
  const borderColor = (id: FocusId) => (focused(id) ? theme.accent : theme.border)
  const api: FormApi = { focus, setFocus, focused, borderColor, values, replace, setError, setNotice: show }

  const save = () => void onSave(values()).catch(fail)

  const fieldAction = (action: FieldAction, f: CustomField) =>
    void runFieldAction(system, action, currentValue(f)).then(show, fail)

  const focusedCustom = customFields.find((f) => customId(f.name) === focus)

  const removeField = (f: CustomField) => {
    const index = customFields.indexOf(f)
    setCustomFields(customFields.filter((other) => other !== f))
    // Land on the neighbour, or the description when the last field goes.
    const next = customFields[index + 1] ?? customFields[index - 1]
    setFocus(next ? customId(next.name) : "description")
    show(`Removed ${f.name} (ctrl+s to save, esc to discard)`)
  }

  const addField = (f: CustomField) => {
    setCustomFields([...customFields, f])
    setAddingField(false)
    setFocus(customId(f.name))
  }

  useKeyboard((key) => {
    if (addingField) return // NewFieldForm handles keys
    if (suspended) return onKey?.(key, api)
    setNotice(null)
    if (confirmingDelete) {
      setConfirmingDelete(false)
      if (key.name === "y") void onDelete?.run().catch(fail)
      return
    }
    if (key.name === "escape") return onClose()
    if (key.name === "tab") {
      key.preventDefault()
      return setFocus(cycle(order, focus, key.shift ? -1 : 1))
    }
    if (key.ctrl && ["s", "d", "n", "x", "y", "o"].includes(key.name)) {
      key.preventDefault()
      switch (key.name) {
        case "s":
          return save()
        case "d":
          if (onDelete) setConfirmingDelete(true)
          return
        case "n":
          return setAddingField(true)
        case "x":
          if (focusedCustom) removeField(focusedCustom)
          return
        case "y":
          if (focusedCustom) return fieldAction("copy", focusedCustom)
          break
        case "o":
          if (focusedCustom?.type === "link") return fieldAction("open", focusedCustom)
          break
      }
    }
    onKey?.(key, api)
  })

  const renderCustom = (f: CustomField) => {
    const id = customId(f.name)
    const locked = isLocked(f)
    const multiline = f.type === "text" && f.textbox
    const register = (widget: TextareaRenderable | null) => {
      if (widget) customRefs.current.set(f.name, widget)
      else customRefs.current.delete(f.name)
    }
    const widgetKey = `${f.name}-${seed.generation}`
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
        onMouseDown={() => setFocus(id)}
      >
        {locked ? (
          <text fg={theme.dim} wrapMode="word" flexGrow={1} flexShrink={1}>
            {f.value || "—"}
          </text>
        ) : multiline ? (
          <textarea key={widgetKey} ref={register} initialValue={f.value} focused={focused(id)} wrapMode="word" flexGrow={1} />
        ) : f.type === "date" ? (
          <DateInput key={widgetKey} ref={register} value={f.value} focused={focused(id)} flexGrow={1} />
        ) : (
          <input
            key={widgetKey}
            ref={register}
            value={f.value}
            placeholder={f.type === "timestamp" ? "ISO 8601, e.g. 2026-10-03T09:00:00Z" : ""}
            focused={focused(id)}
            flexGrow={1}
          />
        )}
        <FieldButtons type={f.type} active={focus === id} onAction={(action) => fieldAction(action, f)} />
      </box>
    )
  }

  const footer = [
    "tab next field",
    ...hints,
    "ctrl+s save",
    "esc back",
    "ctrl+n new field",
    ...(focusedCustom ? ["ctrl+x remove field", "ctrl+y copy", ...(focusedCustom.type === "link" ? ["ctrl+o open"] : [])] : []),
    ...(onDelete ? ["ctrl+d delete"] : []),
  ]

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" flexShrink={0}>
        <box backgroundColor={theme.accent}>
          <text fg={theme.onAccent}>{` ${header} `}</text>
        </box>
      </box>

      {renderTop(api)}

      <scrollbox ref={scrollRef} flexGrow={1}>
        <box
          id={boxId("title")}
          title=" Title "
          border
          borderColor={borderColor("title")}
          height={4}
          flexShrink={0}
          paddingLeft={1}
          onMouseDown={() => setFocus("title")}
        >
          {/* A wrapping textarea so long titles are shown in full; enter moves on instead of adding a line. */}
          <textarea
            key={`title-${seed.generation}`}
            ref={titleRef}
            initialValue={seed.title}
            placeholder={textPlaceholder}
            focused={focused("title")}
            wrapMode="word"
            flexGrow={1}
            onKeyDown={(key) => {
              if (key.name !== "return") return
              key.preventDefault()
              setFocus(cycle(order, "title", 1))
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
          minHeight={textboxHeight(seed.description)}
          flexShrink={0}
          paddingLeft={1}
          onMouseDown={() => setFocus("description")}
        >
          <textarea
            key={`description-${seed.generation}`}
            ref={descriptionRef}
            initialValue={seed.description}
            placeholder={textPlaceholder}
            focused={focused("description")}
            wrapMode="word"
            flexGrow={1}
          />
        </box>
      </scrollbox>

      {meta ? (
        <text fg={theme.dim} flexShrink={0}>
          {` ${meta}`}
        </text>
      ) : null}
      {addingField ? (
        <NewFieldForm taken={customFields.map((f) => f.name)} onAdd={addField} onCancel={() => setAddingField(false)} />
      ) : null}
      {confirmingDelete && onDelete ? (
        <text fg={theme.error}>{` ${onDelete.prompt}? y to confirm, any other key to cancel`}</text>
      ) : error ? (
        <text fg={theme.error}>{` ${error}`}</text>
      ) : notice ? (
        <text fg={theme.accent}>{` ${notice}`}</text>
      ) : null}
      <Hints hints={footer} />
    </box>
  )
}
