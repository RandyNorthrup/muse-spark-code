// The application's report contract, not a provider wire shape. Source text
// remains data; labels are keys, and scrubbing belongs to both snapshot and output.
import * as z from 'zod/mini'
import {
  REPORT_FAIL_ON,
  REPORT_FORMAT_VERSION,
  REPORT_HASH_PATTERN,
  REPORT_ID_PATTERN,
  REPORT_KINDS,
  REPORT_LABEL_KEYS,
  REPORT_MAX_COLUMNS,
  REPORT_MAX_ID_CHARS,
  REPORT_MAX_ROWS,
  REPORT_MAX_SECTIONS,
  REPORT_MAX_SOURCES,
  REPORT_MAX_TEXT_CHARS,
} from './constants'

const id = z
  .string()
  .check(z.minLength(1), z.maxLength(REPORT_MAX_ID_CHARS), z.regex(REPORT_ID_PATTERN))
const text = z.string().check(z.maxLength(REPORT_MAX_TEXT_CHARS))
const reason = text.check(z.minLength(1))
const count = z.number().check(z.int(), z.nonnegative())
const timestamp = z.iso.datetime({ offset: true })
const label = z.enum(REPORT_LABEL_KEYS)
const hash = z.string().check(z.regex(REPORT_HASH_PATTERN))

export const reportKindSchema = z.enum(REPORT_KINDS)
export type ReportKind = z.infer<typeof reportKindSchema>
export type ReportLabelKey = z.infer<typeof label>

export const reportValueSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), value: text }),
  z.strictObject({ type: z.literal('label'), value: label }),
  z.strictObject({ type: z.literal('count'), value: count }),
  z.strictObject({ type: z.literal('number'), value: z.number() }),
  z.strictObject({ type: z.literal('percent'), value: z.number() }),
  z.strictObject({
    type: z.literal('usd'),
    value: z.nullable(z.number().check(z.nonnegative())),
    certainty: z.enum(['reported', 'estimated', 'unknown']),
  }),
  z.strictObject({ type: z.literal('durationMs'), value: z.number().check(z.nonnegative()) }),
  z.strictObject({ type: z.literal('timestamp'), value: timestamp }),
  z.strictObject({ type: z.literal('boolean'), value: z.boolean() }),
  z.strictObject({
    type: z.literal('textList'),
    value: z.array(text).check(z.maxLength(REPORT_MAX_ROWS)),
  }),
])
export type ReportValue = z.infer<typeof reportValueSchema>

export const reportRowSchema = z.strictObject({
  key: id,
  cells: z.record(id, reportValueSchema),
  sourceIds: z.array(id).check(z.maxLength(REPORT_MAX_SOURCES)),
})
export type ReportRow = z.infer<typeof reportRowSchema>

function areUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

export const reportSectionSchema = z
  .strictObject({
    id,
    label,
    // All kinds sort by stable row key, by code unit. Needs-you keys carry
    // priority prefixes: 0 questions, 1 channels, 2 default-branch CI.
    sortKey: z.literal('key'),
    columns: z
      .array(z.strictObject({ key: id, label }))
      .check(z.minLength(1), z.maxLength(REPORT_MAX_COLUMNS)),
    rows: z.array(reportRowSchema).check(z.maxLength(REPORT_MAX_ROWS)),
    omittedRows: count,
  })
  .check(
    z.refine((section) => {
      const columns = section.columns.map((column) => column.key)
      return (
        areUnique(columns) &&
        areUnique(section.rows.map((row) => row.key)) &&
        section.rows.every(
          (row) =>
            Object.keys(row.cells).length === columns.length &&
            columns.every((key) => Object.hasOwn(row.cells, key)) &&
            areUnique(row.sourceIds),
        )
      )
    }),
  )
export type ReportSection = z.infer<typeof reportSectionSchema>

const freshness = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('fresh'), ageMs: count }),
  z.strictObject({ state: z.literal('stale'), ageMs: count }),
  z.strictObject({ state: z.literal('unknown'), ageMs: z.null() }),
])
const sourceFields = { id, observedAt: z.nullable(timestamp), freshness }
export const reportSourceSchema = z
  .discriminatedUnion('status', [
    z.strictObject({ ...sourceFields, status: z.literal('ok'), reason: z.null() }),
    z.strictObject({ ...sourceFields, status: z.literal('partial'), reason }),
    z.strictObject({ ...sourceFields, status: z.literal('unavailable'), reason }),
    z.strictObject({ ...sourceFields, status: z.literal('notApplicable'), reason }),
  ])
  .check(z.refine((source) => source.observedAt !== null || source.freshness.state === 'unknown'))
export type ReportSourceRecord = z.infer<typeof reportSourceSchema>

export const reportOptionsSchema = z.strictObject({
  kind: reportKindSchema,
  asOf: timestamp,
  scope: text,
  full: z.boolean(),
  by: z.optional(z.enum(['model', 'provider', 'kind', 'tool', 'session', 'client', 'account'])),
  sessionId: z.optional(id),
  module: z.optional(text),
  milestone: z.optional(id),
  deadline: z.optional(timestamp),
  fleet: z.optional(z.enum(['current', 'minimum', 'optimum'])),
  network: z.boolean(),
  failOn: z.array(z.enum(REPORT_FAIL_ON)),
})
export type ReportOptions = z.infer<typeof reportOptionsSchema>

export const reportHeaderSchema = z.strictObject({
  kind: reportKindSchema,
  scope: text,
  asOf: timestamp,
  generatorVersion: id,
  contentHash: hash,
})

export const reportDocumentSchema = z
  .strictObject({
    format: z.literal(REPORT_FORMAT_VERSION),
    header: reportHeaderSchema,
    needsYou: reportSectionSchema,
    sections: z.array(reportSectionSchema).check(z.maxLength(REPORT_MAX_SECTIONS)),
    sources: z.array(reportSourceSchema).check(z.minLength(1), z.maxLength(REPORT_MAX_SOURCES)),
    footer: z.strictObject({ rendererVersion: id, icuVersion: id, locale: id }),
  })
  .check(
    z.refine((document) => {
      const sections = [document.needsYou, ...document.sections]
      const sources = new Set(document.sources.map((source) => source.id))
      return (
        document.needsYou.id === 'needsYou' &&
        document.needsYou.label === 'needsYou' &&
        areUnique(sections.map((section) => section.id)) &&
        sources.size === document.sources.length &&
        sections.every((section) =>
          section.rows.every((row) => row.sourceIds.every((source) => sources.has(source))),
        )
      )
    }),
  )
export type ReportDocument = z.infer<typeof reportDocumentSchema>

export interface ReportTheme {
  readonly background: string
  readonly foreground: string
  readonly muted: string
  readonly border: string
  readonly accent: string
}
// Locale and theme are explicit inputs. Renderers must not install global state.
export type ReportRenderer = (
  document: ReportDocument,
  locale: string,
  theme: ReportTheme,
) => string
