import { z } from "zod"
import { FieldListSchema, type CustomField } from "./fields.ts"

export const TEMPLATE_SCHEMA_VERSION = 1

const name = z.string().trim().min(1, "template name is required")
/** Empty title / description leave the task's own value alone. */
const title = z.string().trim()
const description = z.string()

export const TemplateSchema = z.object({
  id: z.number().int().positive(),
  /** Unique label shown in lists and the template picker. */
  name,
  title,
  description,
  fields: FieldListSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type Template = z.infer<typeof TemplateSchema>

export const NewTemplateSchema = z.object({
  name,
  title: title.optional(),
  description: description.optional(),
  fields: FieldListSchema.optional(),
})
export type NewTemplate = z.input<typeof NewTemplateSchema>

/** `fields` replaces the whole list. */
export const TemplatePatchSchema = NewTemplateSchema.partial()
export type TemplatePatch = z.input<typeof TemplatePatchSchema>

export const TemplateFileSchema = z.object({
  schemaVersion: z.literal(TEMPLATE_SCHEMA_VERSION),
  nextId: z.number().int().positive(),
  templates: z.array(TemplateSchema).superRefine((templates, ctx) => {
    const seen = new Set<string>()
    for (const { name } of templates) {
      if (seen.has(name)) ctx.addIssue({ code: "custom", message: `duplicate template name: ${name}` })
      seen.add(name)
    }
  }),
})
export type TemplateFile = z.infer<typeof TemplateFileSchema>

export const emptyTemplateFile = (): TemplateFile => ({ schemaVersion: TEMPLATE_SCHEMA_VERSION, nextId: 1, templates: [] })

/** Replaces fields in `base` that share a name with one in `incoming`, and appends the rest. */
export const upsertFields = (base: CustomField[], incoming: CustomField[]): CustomField[] => {
  const byName = new Map(incoming.map((f) => [f.name, f]))
  const kept = base.map((f) => byName.get(f.name) ?? f)
  return [...kept, ...incoming.filter((f) => !base.some((b) => b.name === f.name))]
}

export interface TemplateTarget {
  title: string
  description: string
  fields: CustomField[]
}

/**
 * Overrides `values` with the template's non-empty values. Template fields replace same-named fields,
 * except that an empty template field leaves an existing one alone.
 */
export const applyTemplate = <T extends TemplateTarget>(values: T, template: Template): T => ({
  ...values,
  title: template.title || values.title,
  description: template.description.trim() ? template.description : values.description,
  fields: upsertFields(
    values.fields,
    template.fields.filter((f) => f.value !== "" || !values.fields.some((v) => v.name === f.name)),
  ),
})
