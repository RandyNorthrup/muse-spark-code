// Pure encoders. Only the host save/download/--out port can publish a file.
import * as z from 'zod/mini'
import {
  USAGE_DETAIL_DAYS,
  USAGE_JOURNAL_VERSION,
  USAGE_WINDOW_DAY_MS,
} from '../../shared/constants'
import {
  usageDaySchema,
  usageRecordSchema,
  usageLimitSnapshotSchema,
} from '../../shared/usageJournal'
import { usagePageStateSchema, type UsagePageState } from '../../shared/usagePage'
import { usageRollupRowSchema, type UsageJournalRead } from './journalStore'
import { usageLocalDay } from './journalRecord'

export const usageExportRangeSchema = z
  .strictObject({ from: usageDaySchema, to: usageDaySchema })
  .check(z.refine((range) => range.from <= range.to))
export type UsageExportRange = z.infer<typeof usageExportRangeSchema>
/** Quote every CSV cell and prefix a spreadsheet formula before CSV quoting. */
export function usageCsvCell(value: string | number | boolean | undefined): string {
  const raw = value === undefined ? '' : String(value)
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return `"${safe.replaceAll('"', '""')}"`
}
function csv(rows: readonly (readonly (string | number | boolean | undefined)[])[]): string {
  return `${rows.map((row) => row.map((cell) => usageCsvCell(cell)).join(',')).join('\r\n')}\r\n`
}
function isInRange(day: string, range: UsageExportRange): boolean {
  return day >= range.from && day <= range.to
}
export function exportUsageCallsCsv(
  journal: UsageJournalRead,
  input: UsageExportRange,
  now: number,
): string {
  const range = usageExportRangeSchema.parse(input)
  const today = usageLocalDay(now)
  const earliest =
    new Date(Date.parse(`${today}T00:00:00Z`) - (USAGE_DETAIL_DAYS - 1) * USAGE_WINDOW_DAY_MS)
      .toISOString()
      .split('T', 1)[0] ?? ''
  if (
    range.from < earliest ||
    range.to > today ||
    journal.rollups.some((row) => isInRange(row.day, range))
  )
    throw new Error('exportRange')
  const records = journal.records
    .map((record) => usageRecordSchema.parse(record))
    .filter((record) => isInRange(record.day, range))
  return csv([
    [
      'v',
      'id',
      'at',
      'startedAt',
      'day',
      'timezoneOffsetMins',
      'client',
      'backend',
      'provider',
      'model',
      'served',
      'kind',
      'input',
      'cached',
      'cacheWrite',
      'cacheWrite5m',
      'cacheWrite1h',
      'output',
      'reasoning',
      'estimated',
      'searches',
      'images',
      'audioSeconds',
      'usd',
      'certainty',
      'source',
      'date',
      'apiEquivalentUsd',
      'outcome',
      'durationMs',
      'firstTokenMs',
      'retries',
      'rateLimited',
      'retryDelayMs',
      'session',
      'packedAvoided',
    ],
    ...records.map((record) => [
      record.v,
      record.id,
      record.at,
      record.startedAt,
      record.day,
      record.timezoneOffsetMins,
      record.client,
      record.backend,
      record.provider,
      record.model,
      record.served,
      record.kind,
      record.tokens.input,
      record.tokens.cached,
      record.tokens.cacheWrite,
      record.tokens.cacheWrite5m,
      record.tokens.cacheWrite1h,
      record.tokens.output,
      record.tokens.reasoning,
      record.tokens.estimated,
      record.units?.searches,
      record.units?.images,
      record.units?.audioSeconds,
      record.cost.usd,
      record.cost.certainty,
      record.cost.source,
      record.cost.date,
      record.cost.apiEquivalentUsd,
      record.outcome,
      record.durationMs,
      record.firstTokenMs,
      record.retries,
      record.rateLimited,
      record.retryDelayMs,
      record.session,
      record.packedAvoided,
    ]),
  ])
}
/** Summary exports use the exact same checked aggregates the page displays. */
export function exportUsageSummaryCsv(input: UsagePageState): string {
  const state = usagePageStateSchema.parse(input)
  return csv([
    [
      'groupBy',
      'id',
      'label',
      'provider',
      'model',
      'records',
      'input',
      'cached',
      'cacheWrite',
      'cacheWrite5m',
      'cacheWrite1h',
      'output',
      'reasoning',
      'estimated',
      'searches',
      'images',
      'audioSeconds',
      'certainty',
      'costRecords',
      'usd',
      'apiEquivalentUsd',
      'durationMs',
      'firstTokenMs',
      'p50Ms',
      'p95Ms',
      'retries',
      'rateLimited',
      'packedAvoided',
    ],
    ...state.breakdown.flatMap((row) =>
      (row.totals.costs.length === 0 ? [undefined] : row.totals.costs).map((cost, index) => {
        // Counts/tokens/time occur once per group; certainty amounts have their own rows.
        const totals = index === 0 ? row.totals : undefined
        return [
          state.query.groupBy,
          row.id,
          row.label,
          row.provider,
          row.model,
          totals?.records,
          totals?.tokens.input,
          totals?.tokens.cached,
          totals?.tokens.cacheWrite,
          totals?.tokens.cacheWrite5m,
          totals?.tokens.cacheWrite1h,
          totals?.tokens.output,
          totals?.tokens.reasoning,
          totals?.tokens.estimated,
          totals?.units.searches,
          totals?.units.images,
          totals?.units.audioSeconds,
          cost?.certainty,
          cost?.records,
          cost?.usd,
          cost?.apiEquivalentUsd,
          totals?.durationMs,
          totals?.firstTokenMs,
          totals?.p50Ms,
          totals?.p95Ms,
          totals?.retries,
          totals?.rateLimited,
          totals?.packedAvoided,
        ]
      }),
    ),
  ])
}
export function exportUsageJson(journal: UsageJournalRead, input: UsageExportRange): string {
  const range = usageExportRangeSchema.parse(input)
  return `${JSON.stringify(
    {
      v: USAGE_JOURNAL_VERSION,
      range,
      records: journal.records
        .map((record) => usageRecordSchema.parse(record))
        .filter((record) => isInRange(record.day, range)),
      limits: journal.limits
        .map((limit) => usageLimitSnapshotSchema.parse(limit))
        .filter((limit) => isInRange(limit.day, range)),
      rollups: journal.rollups
        .map((row) => usageRollupRowSchema.parse(row))
        .filter((row) => isInRange(row.day, range)),
      newerVersionRecords: journal.newerVersionRecords,
      newerVersionFiles: journal.newerVersionFiles,
      tornLines: journal.tornLines,
      invalidLines: journal.invalidLines,
    },
    null,
    2,
  )}\n`
}
