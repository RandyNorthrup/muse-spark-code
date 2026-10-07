import * as z from 'zod/mini'
import { REPORT_MAX_ROWS } from '../../../shared/constants'
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
import {
  codeUnitCompare,
  localSource,
  LocalSourceError,
  scrubSourceValue,
  type SourceScrub,
} from './local'

const count = z.number().check(z.int(), z.nonnegative())
const cost = z.nullable(z.number().check(z.nonnegative()))
const certainty = z.enum(['reported', 'estimated', 'unknown'])
const usageSchema = z.object({
  period: z.string(),
  inputTokens: count,
  outputTokens: count,
  cachedTokens: z.nullable(count),
  costUsd: cost,
  certainty,
  breakdown: z
    .array(
      z.object({
        key: z.string(),
        inputTokens: count,
        outputTokens: count,
        costUsd: cost,
        certainty,
      }),
    )
    .check(z.maxLength(REPORT_MAX_ROWS)),
  limits: z
    .array(
      z.object({
        key: z.string(),
        used: z.number().check(z.nonnegative()),
        limit: z.number().check(z.nonnegative()),
        resetsAt: z.nullable(z.iso.datetime({ offset: true })),
      }),
    )
    .check(z.maxLength(REPORT_MAX_ROWS)),
})
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
    const checkRuns = z
      .array(checkSchema)
      .check(z.maxLength(REPORT_MAX_ROWS))
      .parse(scrubSourceValue(read.checkRuns, scrub))
    return {
      data: {
        export: sessionExportSchema.parse(scrubSourceValue(exported.doc, scrub)),
        activity,
        backend: read.source.backend,
        usage: scrubUsage(read.usage, scrub),
        checkRuns: checkRuns.toSorted(
          // Total order: two records sharing every field are identical rows.
          (a, b) =>
            codeUnitCompare(a.at, b.at) ||
            codeUnitCompare(a.check, b.check) ||
            codeUnitCompare(a.outcome, b.outcome) ||
            codeUnitCompare(a.commit, b.commit) ||
            a.durationMs - b.durationMs,
        ),
      },
      observedAt: read.observedAt,
    }
  })
}
export function scrubUsage(
  usage: ReportSourcePayloads['usage'],
  scrub: SourceScrub,
): ReportSourcePayloads['usage'] {
  const parsed = usageSchema.parse(scrubSourceValue(usage, scrub))
  return {
    ...parsed,
    breakdown: parsed.breakdown.toSorted((a, b) => codeUnitCompare(a.key, b.key)),
    limits: parsed.limits.toSorted((a, b) => codeUnitCompare(a.key, b.key)),
  }
}
