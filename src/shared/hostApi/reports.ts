// M113's method family. M104 binds these payload schemas to its MHP envelope
// and capability negotiation; this module makes no host or transport calls.
// MHP 1.2 is host-initiated. get/compare require the same workspace/kind
// authorization as history; ids select saved documents inside that scope.
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
  reportDiffSchema,
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
  'reports/get': {
    params: z.strictObject({ workspaceKey, kind: reportKindSchema, id: workspaceKey }),
    result: z.discriminatedUnion('status', [
      z.strictObject({ status: z.literal('retrieved'), document: reportDocumentSchema }),
      failed,
    ]),
  },
  'reports/compare': {
    params: z.strictObject({
      workspaceKey,
      kind: reportKindSchema,
      fromId: workspaceKey,
      toId: workspaceKey,
    }),
    result: z.discriminatedUnion('status', [
      z.strictObject({ status: z.literal('compared'), diff: reportDiffSchema }),
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
  get(
    params: z.infer<(typeof reportsMethods)['reports/get']['params']>,
  ): Promise<z.infer<(typeof reportsMethods)['reports/get']['result']>>
  compare(
    params: z.infer<(typeof reportsMethods)['reports/compare']['params']>,
  ): Promise<z.infer<(typeof reportsMethods)['reports/compare']['result']>>
}
