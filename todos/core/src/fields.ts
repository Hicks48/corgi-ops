import { z } from "zod"

export const FIELD_TYPES = ["text", "link", "date", "timestamp"] as const
export const FieldTypeSchema = z.enum(FIELD_TYPES)
export type FieldType = z.infer<typeof FieldTypeSchema>

const options = {
  name: z.string().trim().min(1, "field name is required"),
  /** False locks the field once it has been saved on a task. */
  editable: z.boolean().default(true),
  visibleOnLists: z.boolean().default(false),
}

const orEmpty = (schema: z.ZodType<string>) => z.union([z.literal(""), schema])

export const CustomFieldSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    ...options,
    /** Multiline textbox; false for a single line. */
    textbox: z.boolean().default(true),
    value: z.string().default(""),
  }),
  z.object({ type: z.literal("link"), ...options, value: z.string().trim().default("") }),
  z.object({
    type: z.literal("date"),
    ...options,
    value: orEmpty(z.iso.date("date fields must be YYYY-MM-DD")).default(""),
  }),
  z.object({
    type: z.literal("timestamp"),
    ...options,
    value: orEmpty(z.iso.datetime({ offset: true, message: "timestamp fields must be ISO 8601" })).default(""),
  }),
])
export type CustomField = z.output<typeof CustomFieldSchema>
export type NewCustomField = z.input<typeof CustomFieldSchema>

export const FieldListSchema = z.array(CustomFieldSchema).superRefine((fields, ctx) => {
  const seen = new Set<string>()
  for (const { name } of fields) {
    if (seen.has(name)) ctx.addIssue({ code: "custom", message: `duplicate field name: ${name}` })
    seen.add(name)
  }
})

/** Changes to one field by name. A new field defaults to `text`. */
export const FieldPatchSchema = z.object({
  name: z.string().trim().min(1, "field name is required"),
  type: FieldTypeSchema.optional(),
  value: z.string().optional(),
  editable: z.boolean().optional(),
  visibleOnLists: z.boolean().optional(),
  textbox: z.boolean().optional(),
})
export type FieldPatch = z.input<typeof FieldPatchSchema>

const sameField = (a: CustomField, b: CustomField) => JSON.stringify(a) === JSON.stringify(b)

/** Name of the first locked field in `previous` that `next` changes, if any. Removing is allowed. */
export const lockedFieldChange = (previous: CustomField[], next: CustomField[]): string | undefined =>
  previous.find((old) => {
    if (old.editable) return false
    const updated = next.find((f) => f.name === old.name)
    return updated !== undefined && !sameField(old, updated)
  })?.name
