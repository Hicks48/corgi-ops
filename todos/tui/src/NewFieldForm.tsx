import type { InputRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useRef, useState } from "react"
import { CustomFieldSchema, FIELD_TYPES, type CustomField, type FieldType } from "@corgiops/todos-core"
import { cycle } from "./cycle.ts"
import { theme } from "./theme.ts"

type Control = "type" | "name" | "editable" | "visibleOnLists" | "textbox"
type Flag = "editable" | "visibleOnLists" | "textbox"

const FLAG_LABELS: Record<Flag, string> = {
  editable: "editable",
  visibleOnLists: "visible on lists",
  textbox: "textbox",
}

interface NewFieldFormProps {
  /** Names already on the task. */
  taken: string[]
  onAdd: (field: CustomField) => void
  onCancel: () => void
}

/** Inline form for a new custom field. Owns the keyboard while mounted. */
export function NewFieldForm({ taken, onAdd, onCancel }: NewFieldFormProps) {
  const [type, setType] = useState<FieldType>("text")
  const [flags, setFlags] = useState<Record<Flag, boolean>>({ editable: true, visibleOnLists: false, textbox: true })
  const [control, setControl] = useState<Control>("name")
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<InputRenderable>(null)

  const controls: Control[] = ["type", "name", "editable", "visibleOnLists", ...(type === "text" ? ["textbox" as const] : [])]
  const toggle = (flag: Flag) => setFlags((current) => ({ ...current, [flag]: !current[flag] }))

  const add = () => {
    const result = CustomFieldSchema.safeParse({ type, name: nameRef.current?.value ?? "", ...flags })
    if (!result.success) return setError(result.error.issues.map((i) => i.message).join("; "))
    if (taken.includes(result.data.name)) return setError(`duplicate field name: ${result.data.name}`)
    onAdd(result.data)
  }

  useKeyboard((key) => {
    if (key.name === "escape") return onCancel()
    if (key.name === "return") return add()
    if (key.name === "tab") {
      key.preventDefault()
      return setControl(cycle(controls, control, key.shift ? -1 : 1))
    }
    if (control === "name" || !["left", "right", "space"].includes(key.name)) return
    if (control === "type") setType(cycle(FIELD_TYPES, type, key.name === "left" ? -1 : 1))
    else toggle(control)
  })

  const color = (target: Control) => (control === target ? theme.accent : theme.dim)

  return (
    <box title=" New field " border borderColor={theme.accent} flexDirection="column" flexShrink={0} paddingLeft={1}>
      <box flexDirection="row" gap={2}>
        <box
          onMouseDown={() => {
            setControl("type")
            setType(cycle(FIELD_TYPES, type, 1))
          }}
        >
          <text fg={color("type")}>{`Type ‹ ${type} ›`}</text>
        </box>
        <box flexDirection="row" gap={1} onMouseDown={() => setControl("name")}>
          <text fg={color("name")}>Name</text>
          <input ref={nameRef} placeholder="Required" focused={control === "name"} width={24} />
        </box>
      </box>
      <box flexDirection="row" gap={2}>
        {controls
          .filter((c): c is Flag => c in FLAG_LABELS)
          .map((flag) => (
            <box
              key={flag}
              onMouseDown={() => {
                setControl(flag)
                toggle(flag)
              }}
            >
              <text fg={color(flag)}>{`[${flags[flag] ? "x" : " "}] ${FLAG_LABELS[flag]}`}</text>
            </box>
          ))}
      </box>
      {error ? <text fg={theme.error}>{error}</text> : null}
      <text fg={theme.dim}>tab next  ←→/space change  enter add  esc cancel</text>
    </box>
  )
}
