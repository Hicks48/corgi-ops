import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useEffect, useRef } from "react"
import type { Template } from "@corgiops/todos-core"
import { Hints } from "./Hints.tsx"
import { theme } from "./theme.ts"

const cardId = (template: Template) => `template-${template.id}`

interface TemplateListViewProps {
  templates: Template[]
  selectedIndex: number
  error: string | null
  onSelect: (index: number) => void
  onOpen: (template: Template) => void
}

export function TemplateListView({ templates, selectedIndex, error, onSelect, onOpen }: TemplateListViewProps) {
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const selected = templates[selectedIndex]

  useEffect(() => {
    if (selected) scrollRef.current?.scrollChildIntoView(cardId(selected))
  }, [selected])

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <box backgroundColor={theme.accent}>
          <text fg={theme.onAccent}> Templates </text>
        </box>
        <text fg={theme.dim}>{`${templates.length} ${templates.length === 1 ? "template" : "templates"} `}</text>
      </box>

      <scrollbox ref={scrollRef} flexGrow={1}>
        {templates.length === 0 ? <text fg={theme.dim}> No templates yet. Press a to add one.</text> : null}
        {templates.map((template, index) => (
          <box
            key={template.id}
            id={cardId(template)}
            border
            borderStyle="rounded"
            borderColor={index === selectedIndex ? theme.accent : theme.border}
            flexDirection="column"
            flexShrink={0}
            paddingLeft={1}
            paddingRight={1}
            onMouseDown={() => (index === selectedIndex ? onOpen(template) : onSelect(index))}
          >
            <box flexDirection="row" gap={1}>
              <text fg={theme.text} attributes={TextAttributes.BOLD} flexShrink={0}>
                {template.name}
              </text>
              <text fg={theme.dim} wrapMode="none" truncate flexGrow={1} flexShrink={1}>
                {template.title}
              </text>
            </box>
            {template.fields.length ? (
              <text fg={theme.dim} wrapMode="none" truncate>
                {`Fields: ${template.fields.map((f) => f.name).join(", ")}`}
              </text>
            ) : null}
            {template.description ? (
              <text fg={theme.dim} wrapMode="word" maxHeight={2}>
                {template.description}
              </text>
            ) : null}
          </box>
        ))}
      </scrollbox>

      {error ? <text fg={theme.error}>{` ${error}`}</text> : null}
      <Hints hints={["↑↓ select", "enter details", "a add", "esc back to tasks", "q quit"]} />
    </box>
  )
}
