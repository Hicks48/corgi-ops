import type { InputRenderable } from "@opentui/core"
import { useRef, useState, type Ref } from "react"
import { isLocalDate } from "@corgiops/todos-core"
import { theme } from "./theme.ts"

const DIGITS = 8

/** `YYYY-MM-DD`, or as much of it as `digits` covers. */
const formatDigits = (digits: string) => [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6)].filter(Boolean).join("-")

/** Text index of the spot after `n` digits. */
const indexAfterDigits = (n: number) => n + (n > 4 ? 1 : 0) + (n > 6 ? 1 : 0)

/**
 * Forces `text` into `YYYY-MM-DD` shape: digits only, dashes inserted. Typing into a full date overwrites
 * the digit after the cursor. Returns the new text and cursor.
 */
export const maskDate = (text: string, cursor: number): { text: string; cursor: number } => {
  let digits = text.replace(/\D/g, "")
  let before = text.slice(0, cursor).replace(/\D/g, "").length
  if (digits.length > DIGITS) digits = digits.slice(0, before) + digits.slice(before + digits.length - DIGITS)
  digits = digits.slice(0, DIGITS)
  before = Math.min(before, digits.length)
  return { text: formatDigits(digits), cursor: indexAfterDigits(before) }
}

interface DateInputProps {
  ref?: Ref<InputRenderable>
  value: string
  focused: boolean
  flexGrow?: number
}

/** Single-line `YYYY-MM-DD` input that rejects anything else as it is typed. Incomplete or impossible dates show in red. */
export function DateInput({ ref, value, focused, flexGrow }: DateInputProps) {
  const widget = useRef<InputRenderable | null>(null)
  const [valid, setValid] = useState(value === "" || isLocalDate(value))

  const register = (instance: InputRenderable | null) => {
    widget.current = instance
    if (typeof ref === "function") ref(instance)
    else if (ref) ref.current = instance
  }

  const onInput = () => {
    const input = widget.current
    if (!input) return
    const masked = maskDate(input.value, input.cursorOffset)
    if (masked.text !== input.value) {
      input.value = masked.text
      input.cursorOffset = masked.cursor
    }
    setValid(masked.text === "" || isLocalDate(masked.text))
  }

  const color = valid ? theme.text : theme.error
  return (
    <input
      ref={register}
      value={value}
      placeholder="YYYY-MM-DD"
      focused={focused}
      textColor={color}
      focusedTextColor={color}
      onInput={onInput}
      flexGrow={flexGrow}
    />
  )
}
