import * as z from 'zod/mini'
import { MHP, MHP_ERROR_CODES } from '../constants'
import { capabilitySchema, versionSchema } from './capabilities'

export const integerSchema = z.number().check(z.int(), z.gte(0), z.lte(MHP.maximumInteger))
export const idSchema = z.union([z.string().check(z.minLength(1)), integerSchema])
export const uriSchema = z.string().check(z.url())
export const positionSchema = z.strictObject({ line: integerSchema, character: integerSchema })
// UTF-16 positions, zero-based. Adapters reject reversed or overlapping ranges
// before editing, and validate the expected version before any side effect.
export const rangeSchema = z.strictObject({ start: positionSchema, end: positionSchema })
export const textEditSchema = z.strictObject({ range: rangeSchema, newText: z.string() })
export const documentSchema = z.strictObject({
  uri: uriSchema,
  version: integerSchema,
  dirty: z.boolean(),
  languageId: z.string(),
})
export const locationSchema = z.strictObject({ uri: uriSchema, range: rangeSchema })
export const folderSchema = z.strictObject({ uri: uriSchema, name: z.string() })
export const selectionSchema = z.strictObject({
  uri: uriSchema,
  version: integerSchema,
  range: rangeSchema,
  excerpt: z.string().check(z.maxLength(MHP.maximumSelectionChars)),
  truncated: z.boolean(),
})
export const diagnosticSchema = z.strictObject({
  uri: uriSchema,
  range: rangeSchema,
  severity: z.enum(['error', 'warning', 'information', 'hint']),
  message: z.string(),
  source: z.optional(z.string()),
  code: z.optional(z.union([z.string(), integerSchema])),
})
export const symbolSchema = z.strictObject({
  name: z.string(),
  kind: integerSchema,
  location: locationSchema,
  selection: rangeSchema,
  container: z.optional(z.string()),
})
export const versionedEditsSchema = z.strictObject({
  uri: uriSchema,
  expectedVersion: integerSchema,
  edits: z.array(textEditSchema).check(z.minLength(1)),
})
export const hunkSchema = z.strictObject({
  id: idSchema,
  uri: uriSchema,
  expectedVersion: integerSchema,
  range: rangeSchema,
  before: z.string(),
  after: z.string(),
})
export const surfaceKindSchema = z.enum([
  'chat',
  'tasks',
  'whatsNew',
  'models',
  'traffic',
  'settings',
  'walkthrough',
  'diff',
  'plans',
  'manager',
  'roles',
])
export const themeSchema = z.strictObject({
  kind: z.enum(['light', 'dark', 'highContrastLight', 'highContrastDark']),
  tokens: z.record(z.string().check(z.regex(/^--muse-[a-zA-Z][\w-]*$/u)), z.string()),
})
// JSON values are for settings/storage only, never credentials. Recursion is
// explicit so JSON Schema consumers get the same boundary as TypeScript.
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export const jsonValueSchema: z.ZodMiniType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
)
export const settingKeySchema = z.string().check(z.regex(/^museSpark\.[a-zA-Z][\w.]*$/u))
export const errorSchema = z.strictObject({
  code: z.union(Object.values(MHP_ERROR_CODES).map((code) => z.literal(code))),
  // A stable technical identifier, not raw provider text or a translated title.
  message: z.string().check(z.regex(/^[A-Z][A-Z_]*$/u)),
  data: z.optional(
    z.strictObject({
      capability: z.optional(capabilitySchema),
      uri: z.optional(uriSchema),
      expectedVersion: z.optional(integerSchema),
      actualVersion: z.optional(integerSchema),
      minimumVersion: z.optional(versionSchema),
      maximumVersionExclusive: z.optional(versionSchema),
    }),
  ),
})
