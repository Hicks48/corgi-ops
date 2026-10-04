import type { InputRenderable } from "@opentui/core"
import { useRef } from "react"
import { formatLocalDateTime, shortId, type NewTemplate, type Template } from "@corgiops/todos-core"
import { DetailsForm, type FormApi, type FormValues } from "./DetailsForm.tsx"
import type { System } from "./system.ts"

export type TemplateValues = Required<Pick<NewTemplate, "name">> & FormValues

interface TemplateDetailsProps {
  /** Template being viewed/edited; omit to create a new one. */
  template?: Template
  system: System
  /** Rejecting keeps the view open and shows the error. */
  onSave: (values: TemplateValues) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
}

export function TemplateDetails({ template, system, onSave, onDelete, onClose }: TemplateDetailsProps) {
  const nameRef = useRef<InputRenderable>(null)

  const renderTop = (api: FormApi) => (
    <box flexDirection="row" flexShrink={0}>
      <box
        title=" Name "
        border
        borderColor={api.borderColor("name")}
        height={3}
        width={40}
        paddingLeft={1}
        onMouseDown={() => api.setFocus("name")}
      >
        <input ref={nameRef} value={template?.name ?? ""} placeholder="Required" focused={api.focused("name")} />
      </box>
    </box>
  )

  return (
    <DetailsForm
      header={template ? `Template ${shortId(template.id)}` : "New Template"}
      system={system}
      initial={{ title: template?.title ?? "", description: template?.description ?? "", fields: template?.fields ?? [] }}
      topIds={["name"]}
      renderTop={renderTop}
      textPlaceholder="Optional; empty keeps the task's own"
      onSave={(values) => onSave({ ...values, name: nameRef.current?.value ?? "" })}
      onDelete={template ? { prompt: `Delete template "${template.name}"`, run: onDelete } : undefined}
      onClose={onClose}
      hints={[]}
      meta={
        template
          ? `Created ${formatLocalDateTime(template.createdAt)} · Updated ${formatLocalDateTime(template.updatedAt)}`
          : undefined
      }
    />
  )
}
