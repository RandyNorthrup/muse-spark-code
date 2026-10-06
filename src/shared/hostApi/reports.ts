// M113's method family. M104 binds these payload schemas to its MHP envelope
// and capability negotiation; this module makes no host or transport calls.
import * as z from 'zod/mini'
import {
  REPORT_FORMATS,
  REPORT_HISTORY_MAX_PER_KIND,
  REPORT_MAX_ID_CHARS,
  REPORT_MAX_TEXT_CHARS,
  REPORT_STORAGE_KEY_PATTERN,
} from '../constants'
import {
  reportDocumentSchema,
  reportHeaderSchema,
  reportKindSchema,
  reportOptionsSchema,
} from '../reportSchema'

const workspaceKey = z
  .string()
  .check(z.minLength(1), z.maxLength(REPORT_MAX_ID_CHARS), z.regex(REPORT_STORAGE_KEY_PATTERN))
const failed = z.strictObject({
  status: z.literal('failed'),
  reason: z.string().check(z.minLength(1), z.maxLength(REPORT_MAX_TEXT_CHARS)),
})
export const reportHistoryEntrySchema = z.strictObject({
  id: workspaceKey,
  header: reportHeaderSchema,
})
export const reportsMethods = {
  'reports/run': {
    params: z.strictObject({ workspaceKey, options: reportOptionsSchema }),
    result: z.discriminatedUnion('status', [
      z.strictObject({ status: z.literal('generated'), document: reportDocumentSchema }),
      failed,
    ]),
  },
  'reports/history': {
    params: z.strictObject({ workspaceKey, kind: reportKindSchema }),
    result: z.discriminatedUnion('status', [
      z.strictObject({
        status: z.literal('listed'),
        entries: z.array(reportHistoryEntrySchema).check(z.maxLength(REPORT_HISTORY_MAX_PER_KIND)),
      }),
      failed,
    ]),
  },
  'reports/open': {
    params: z.strictObject({ document: reportDocumentSchema, format: z.enum(REPORT_FORMATS) }),
    result: z.discriminatedUnion('status', [
      z.strictObject({ status: z.literal('opened') }),
      failed,
    ]),
  },
}
export interface ReportsHostPort {
  readonly capability: 'reports'
  run(
    params: z.infer<(typeof reportsMethods)['reports/run']['params']>,
  ): Promise<z.infer<(typeof reportsMethods)['reports/run']['result']>>
  history(
    params: z.infer<(typeof reportsMethods)['reports/history']['params']>,
  ): Promise<z.infer<(typeof reportsMethods)['reports/history']['result']>>
  open(
    params: z.infer<(typeof reportsMethods)['reports/open']['params']>,
  ): Promise<z.infer<(typeof reportsMethods)['reports/open']['result']>>
}
