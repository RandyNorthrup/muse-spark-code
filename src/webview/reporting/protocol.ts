// This page has a separate, strict bridge. Chat/model actions are never accepted here.
import * as z from 'zod/mini'
import {
  REPORT_FORMATS,
  REPORT_MAX_TEXT_CHARS,
  REPORT_HISTORY_MAX_PER_KIND,
} from '../../shared/constants'
import { reportHistoryEntrySchema } from '../../shared/hostApi/reports'
import { reportDiffSchema, reportHeaderSchema } from '../../shared/reportSchema'

const text = z.string().check(z.maxLength(REPORT_MAX_TEXT_CHARS))
export const reportingWebviewMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('reportingReady') }),
  z.strictObject({
    type: z.literal('reportingAction'),
    action: z.enum(['copy', 'attach', 'history', 'diff', 'refresh', 'pick']),
  }),
  z.strictObject({ type: z.literal('reportingSave'), format: z.enum(REPORT_FORMATS) }),
  z.strictObject({ type: z.literal('reportingOpen'), id: reportHistoryEntrySchema.shape.id }),
])
export type ReportingWebviewMessage = z.infer<typeof reportingWebviewMessageSchema>

export const reportingHostMessageSchema = z.strictObject({
  type: z.literal('reportingState'),
  busy: z.boolean(),
  header: z.nullable(reportHeaderSchema),
  // Renderer output can exceed one source field's bound; document bounds govern it.
  html: z.string(),
  history: z.nullable(
    z.array(reportHistoryEntrySchema).check(z.maxLength(REPORT_HISTORY_MAX_PER_KIND)),
  ),
  diff: z.nullable(reportDiffSchema),
  status: text,
  isError: z.boolean(),
})
export type ReportingHostMessage = z.infer<typeof reportingHostMessageSchema>
