// Worker report validation is deferred with the worker, not the Roles editor.
import * as z from 'zod/mini'
import { reviewFindingSchema } from './reviewFindings'

// A worker's report status (D75). `unstructured` is assigned by the parser
// to a last message with no valid block, never sent by a worker.
export const teamReportStatuses = [
  'done',
  'partial',
  'blocked',
  'failed',
  'capped',
  'unstructured',
] as const
export const teamReportStatusSchema = z.enum(teamReportStatuses)
export type TeamReportStatus = z.infer<typeof teamReportStatusSchema>

/** A report in its fenced block, parsed with zod as M70's `muse-review` is. */
export const teamReportSchema = z.object({
  status: teamReportStatusSchema,
  summary: z.string().check(z.minLength(1)),
  files: z.optional(z.array(z.string())),
  checks: z.optional(z.array(z.string())),
  sources: z.optional(z.array(z.string())),
  questions: z.optional(z.array(z.string())),
  next: z.optional(z.string()),
  findings: z.optional(z.array(reviewFindingSchema)),
})
export type TeamReport = z.infer<typeof teamReportSchema>
