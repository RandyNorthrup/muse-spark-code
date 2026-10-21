import { legacyUsdSchema, nonnegativeUsdSchema } from '../../../shared/usdSchema'
import * as z from 'zod/mini'
import type { UiText } from '../../../shared/l10n/en'
import {
  buildSessionExport,
  sessionExportSchema,
  type SessionExportSource,
} from '../../export/sessionTransfer'
import {
  reportSessionActivitySchema,
  type ReportSourcePayloads,
  type SourceReadContext,
} from './types'
import { joinPartialReasons, readReportRows, type ReportProblem } from './boundary'
import {
  codeUnitCompare,
  localSource,
  LocalSourceError,
  scrubSourceValue,
  type SourceScrub,
} from './local'

const count = z.number().check(z.int(), z.nonnegative())
const cost = z.nullable(legacyUsdSchema)
const certainty = z.enum(['reported', 'estimated', 'unknown'])
const usageHeadSchema = z.object({
  period: z.string(),
  inputTokens: count,
  outputTokens: count,
  cachedTokens: z.nullable(count),
  costUsd: cost,
  certainty,
})
const usageBreakdownRowSchema = z.object({
  key: z.string(),
  inputTokens: count,
  outputTokens: count,
  costUsd: cost,
  certainty,
})
const usageLimitRowSchema = z.union([
  z.object({
    key: z.string(),
    used: nonnegativeUsdSchema,
    limit: nonnegativeUsdSchema,
    resetsAt: z.nullable(z.iso.datetime({ offset: true })),
    unit: z.literal('usd'),
  }),
  z.object({
    key: z.string(),
    used: z.number().check(z.nonnegative()),
    limit: z.number().check(z.nonnegative()),
    resetsAt: z.nullable(z.iso.datetime({ offset: true })),
    unit: z.optional(z.literal('percent')),
  }),
])
type UsageBreakdownRow = z.infer<typeof usageBreakdownRowSchema>
type UsageLimitRow = z.infer<typeof usageLimitRowSchema>
const checkSchema = z.object({
  check: z.string(),
  outcome: z.enum(['passed', 'failed', 'cancelled', 'skipped']),
  durationMs: count,
  commit: z.string(),
  at: z.iso.datetime({ offset: true }),
})

/** M84 history plus facts retained before its portable projection drops turn ids. */
export interface ReportSessionReader {
  read(context: SourceReadContext): Promise<{
    source: SessionExportSource
    activity: ReportSourcePayloads['session']['activity']
    usage: ReportSourcePayloads['session']['usage']
    checkRuns: ReportSourcePayloads['session']['checkRuns']
    observedAt: string
    partial?: string
  } | null>
}
export function sessionSource(
  reader: ReportSessionReader | undefined,
  roots: readonly string[],
  scrub: SourceScrub,
) {
  return localSource('session', async (context) => {
    if (reader === undefined) throw new LocalSourceError('unbound')
    const read = await reader.read(context)
    if (read === null) throw new LocalSourceError('history')
    const exported = await buildSessionExport(
      { ...read.source, exportedAt: new Date(context.asOf).toISOString() },
      { redact: true, localRoots: roots },
    )
    const activity = reportSessionActivitySchema.parse(read.activity)
    if (activity.turns.status === 'unavailable')
      activity.turns.reason = scrub(activity.turns.reason)
    if (activity.approvals.status === 'unavailable')
      activity.approvals.reason = scrub(activity.approvals.reason)
    // Each check run parses on its own: one damaged run is a named
    // problem beside the good rows, never a lost session (RVREPORTJOIN P2-1).
    const checkRuns = readReportRows(
      context.reportText,
      'checks',
      'session/checkRuns',
      scrubSourceValue(read.checkRuns, scrub),
      checkSchema,
    )
    const usage = scrubUsage(context.reportText, read.usage, scrub)
    const partial = joinPartialReasons(context.reportText, [
      read.partial === undefined ? undefined : scrub(read.partial),
      ...usage.problems.map((problem) => problem.reason),
      ...checkRuns.problems.map((problem) => problem.reason),
    ])
    return {
      data: {
        export: sessionExportSchema.parse(scrubSourceValue(exported.doc, scrub)),
        activity,
        backend: read.source.backend,
        usage: usage.usage,
        checkRuns: checkRuns.rows.toSorted(
          // Total order: two records sharing every field are identical rows.
          (a, b) =>
            codeUnitCompare(a.at, b.at) ||
            codeUnitCompare(a.check, b.check) ||
            codeUnitCompare(a.outcome, b.outcome) ||
            codeUnitCompare(a.commit, b.commit) ||
            a.durationMs - b.durationMs ||
            codeUnitCompare(JSON.stringify(a), JSON.stringify(b)),
        ),
      },
      observedAt: read.observedAt,
      ...(partial !== undefined && { partial }),
    }
  })
}
/**
Usage facts keep every valid row: the scalar head is one record, while
each breakdown and limit entry parses on its own, so one damaged entry
is a named problem beside the good rows, never a lost source
(RVREPORTJOIN P2-1).
*/
export function scrubUsage(
  reportText: UiText,
  usage: unknown,
  scrub: SourceScrub,
): { readonly usage: ReportSourcePayloads['usage']; readonly problems: readonly ReportProblem[] } {
  const scrubbed = scrubSourceValue(usage, scrub)
  const head = usageHeadSchema.parse(scrubbed)
  const breakdown = readReportRows<UsageBreakdownRow>(
    reportText,
    'breakdown',
    'usage/breakdown',
    typeof scrubbed === 'object' && scrubbed !== null
      ? Reflect.get(scrubbed, 'breakdown')
      : undefined,
    usageBreakdownRowSchema,
  )
  const limits = readReportRows<UsageLimitRow>(
    reportText,
    'limits',
    'usage/limits',
    typeof scrubbed === 'object' && scrubbed !== null ? Reflect.get(scrubbed, 'limits') : undefined,
    usageLimitRowSchema,
  )
  const parsed = {
    ...head,
    breakdown: breakdown.rows,
    limits: limits.rows,
  }
  const problems = [...breakdown.problems, ...limits.problems]
  const result = {
    ...parsed,
    breakdown: parsed.breakdown.toSorted(
      (a, b) =>
        codeUnitCompare(a.key, b.key) || codeUnitCompare(JSON.stringify(a), JSON.stringify(b)),
    ),
    limits: parsed.limits
      .toSorted(
        (a, b) =>
          codeUnitCompare(a.key, b.key) || codeUnitCompare(JSON.stringify(a), JSON.stringify(b)),
      )
      // Normalize explicit undefined back to an absent unit (exactOptional
      // types), keeping each branch's amount type with its own unit.
      .map((entry) => {
        if (entry.unit === 'usd')
          return {
            key: entry.key,
            used: entry.used,
            limit: entry.limit,
            resetsAt: entry.resetsAt,
            unit: 'usd' as const,
          }
        if (entry.unit === undefined)
          return {
            key: entry.key,
            used: entry.used,
            limit: entry.limit,
            resetsAt: entry.resetsAt,
          }
        return {
          key: entry.key,
          used: entry.used,
          limit: entry.limit,
          resetsAt: entry.resetsAt,
          unit: entry.unit,
        }
      }),
  }
  return { usage: result, problems }
}
