import type { CustomField, FieldType } from "@corgiops/todos-core"
import type { System } from "./system.ts"
import { theme } from "./theme.ts"

export type FieldAction = "copy" | "open"

export const fieldActions = (type: FieldType): FieldAction[] => (type === "link" ? ["open", "copy"] : ["copy"])

interface FieldButtonsProps {
  type: FieldType
  active: boolean
  onAction: (action: FieldAction) => void
}

/** `[ open ] [ copy ]` buttons for a field's value. Clicks don't reach the parent. */
export function FieldButtons({ type, active, onAction }: FieldButtonsProps) {
  return (
    <>
      {fieldActions(type).map((action) => (
        <box
          key={action}
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation()
            onAction(action)
          }}
        >
          <text fg={active ? theme.accent : theme.dim}>{`[ ${action} ]`}</text>
        </box>
      ))}
    </>
  )
}

/** Runs the action; resolves to a message for the user. */
export const runFieldAction = async (
  system: System,
  action: FieldAction,
  { name, value }: Pick<CustomField, "name" | "value">,
): Promise<string> => {
  if (value === "") return `${name} is empty`
  if (action === "open") {
    await system.open(value)
    return `Opened ${name}`
  }
  await system.copy(value)
  return `Copied ${name}`
}
