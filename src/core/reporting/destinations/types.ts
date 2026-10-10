import * as z from 'zod/mini'
import {
  REPORT_DESTINATIONS_MAX,
  REPORT_FORMATS,
  REPORT_DELIVERY_ATTEMPTS,
  REPORT_HASH_PATTERN,
  REPORT_MAX_ID_CHARS,
  REPORT_MAX_TEXT_CHARS,
  REPORT_SAVE_RETENTION_DEFAULT,
  REPORT_SAVE_RETENTION_MAX,
  REPORT_SAVE_TEMPLATE_DEFAULT,
  REPORT_STORAGE_KEY_PATTERN,
} from '../../../shared/constants'
import {
  reportOptionsSchema,
  reportDocumentSchema,
  type ReportDocument,
  type ReportTheme,
} from '../../../shared/reportSchema'

const id = z
  .string()
  .check(z.minLength(1), z.maxLength(REPORT_MAX_ID_CHARS), z.regex(REPORT_STORAGE_KEY_PATTERN))
const text = z.string().check(z.minLength(1), z.maxLength(REPORT_MAX_TEXT_CHARS))
export const reportEmailAddressSchema = z.email().check(z.maxLength(REPORT_MAX_ID_CHARS))
export const reportConnectionSchema = z.strictObject({
  provider: z.enum(['smtp', 'gmail', 'outlook']),
  vaultItemId: id,
})
export type ReportMailConnection = z.infer<typeof reportConnectionSchema>
export const reportPostTargetSchema = z.strictObject({
  repository: z.string().check(z.regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)),
  number: z.number().check(z.int(), z.positive()),
  kind: z.enum(['pullRequestComment', 'issueComment', 'statusIssue']),
})
export const reportDestinationSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('save'),
    id,
    root: text,
    storage: z.enum(['local', 'node']),
    template: z.pipe(
      z.optional(text),
      z.transform((value) => value ?? REPORT_SAVE_TEMPLATE_DEFAULT),
    ),
    retention: z.pipe(
      z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(REPORT_SAVE_RETENTION_MAX))),
      z.transform((value) => value ?? REPORT_SAVE_RETENTION_DEFAULT),
    ),
  }),
  z.strictObject({ type: z.literal('browser'), id, storage: z.enum(['local', 'node']) }),
  z.strictObject({
    type: z.literal('email'),
    id,
    address: reportEmailAddressSchema,
    connection: reportConnectionSchema,
  }),
  z.strictObject({ type: z.literal('post'), id, target: reportPostTargetSchema }),
])
export type ReportDestination = z.infer<typeof reportDestinationSchema>
export const scheduledReportActionSchema = z.strictObject({
  type: z.literal('report'),
  options: reportOptionsSchema,
  format: z.enum(REPORT_FORMATS),
  locale: id,
  theme: z.strictObject({
    background: text,
    foreground: text,
    muted: text,
    border: text,
    accent: text,
  }),
  destinations: z.array(reportDestinationSchema).check(
    z.minLength(1),
    z.maxLength(REPORT_DESTINATIONS_MAX),
    z.refine((items) => new Set(items.map((item) => item.id)).size === items.length),
  ),
})
export type ScheduledReportAction = z.infer<typeof scheduledReportActionSchema>
export const reportDeliveryReceiptSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('delivered') }),
  // Only a known failure BEFORE dispatch may be retried. A lost reply is uncertain.
  z.strictObject({ status: z.literal('retryable') }),
  z.strictObject({ status: z.literal('failed') }),
  z.strictObject({ status: z.literal('uncertain') }),
])
export type ReportDeliveryReceipt = z.infer<typeof reportDeliveryReceiptSchema>
export interface ReportDeliveryPayload {
  readonly document: ReportDocument
  readonly format: ScheduledReportAction['format']
  readonly locale: string
  readonly theme: ReportTheme
  readonly attachment: string
  readonly html: string
  readonly text: string
  readonly markdown: string
}
export type ReportDeliveryOutcome =
  | { readonly status: 'delivered'; readonly attempts: number }
  | { readonly status: 'deferred'; readonly attempts: number; readonly reason: 'inactiveSession' }
  | { readonly status: 'failed' | 'uncertain' | 'refused'; readonly attempts: number }

// M115 binds its trusted run context and live, revocable grant here. The full
// destination is checked, not just its id, so editing a target cannot reuse consent.
export interface ReportScheduleAuthorityPort {
  authorize(
    scheduleId: string,
    action: ScheduledReportAction,
  ): Promise<{
    readonly allowed: boolean
    readonly roots: readonly string[]
    readonly network: boolean
    readonly creator: 'user' | 'agent'
  }>
}
export interface ReportGenerationPort {
  generate(options: ScheduledReportAction['options']): Promise<ReportDocument>
}
export interface ReportOccurrenceRecord {
  readonly actionKey: string
  readonly payload: ReportDeliveryPayload
  readonly outcomes: Readonly<Record<string, ReportDeliveryOutcome>>
}
const attempts = z.number().check(z.int(), z.minimum(0), z.maximum(REPORT_DELIVERY_ATTEMPTS))
export const reportOccurrenceRecordSchema = z.strictObject({
  actionKey: z.string().check(z.regex(REPORT_HASH_PATTERN)),
  payload: z.strictObject({
    document: reportDocumentSchema,
    format: z.enum(REPORT_FORMATS),
    locale: id,
    theme: scheduledReportActionSchema.shape.theme,
    attachment: z.string(),
    html: z.string(),
    text: z.string(),
    markdown: z.string(),
  }),
  outcomes: z.record(
    id,
    z.discriminatedUnion('status', [
      z.strictObject({ status: z.literal('delivered'), attempts }),
      z.strictObject({
        status: z.literal('deferred'),
        attempts,
        reason: z.literal('inactiveSession'),
      }),
      z.strictObject({ status: z.enum(['failed', 'uncertain', 'refused']), attempts }),
    ]),
  ),
})
// M115's occurrence claim/store owns serialization across processes and persists
// the frozen payload BEFORE any destination dispatch. Retries never recollect facts.
export interface ReportOccurrencePort {
  exclusive<T>(scheduleId: string, occurrence: string, work: () => Promise<T>): Promise<T>
  read(scheduleId: string, occurrence: string): Promise<ReportOccurrenceRecord | null>
  write(scheduleId: string, occurrence: string, record: ReportOccurrenceRecord): Promise<void>
}
