// M102 / D82: all surfaces consume these same settled sums. Stored local
// dates are authoritative; a later time-zone change never moves a call.
import { createHash } from 'node:crypto'
import {
  DAYS_PER_WEEK,
  HOURS_PER_DAY,
  MILLISECONDS_PER_DAY,
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_MINUTE,
  USAGE_BURN_MIN_MS,
  USAGE_HISTOGRAM_EDGES_MS,
  USAGE_PACE_BAND_POINTS,
  USAGE_STALE_MS,
} from '../../shared/constants'
import type { UsageRecord, UsageKind, UsageLimitSnapshot } from '../../shared/usageJournal'
import type { UsagePageState, UsageQuery, UsageTotals } from '../../shared/usagePage'

const HOUR_MS = MILLISECONDS_PER_DAY / HOURS_PER_DAY
const MINUTE_MS = MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE
const TOKEN_KEYS = [
  'input',
  'cached',
  'cacheWrite',
  'cacheWrite5m',
  'cacheWrite1h',
  'output',
  'reasoning',
] as const
const UNIT_KEYS = ['searches', 'images', 'audioSeconds'] as const

/** Lane J adapts its validated rollup rows to this explicit read interface. */
export interface UsageAggregateRow {
  readonly day: string
  readonly client: string
  readonly backend: UsageRecord['backend']
  readonly provider: string
  readonly model: string
  readonly kind: UsageKind
  readonly totals: UsageTotals
  /** Twelve counts at USAGE_HISTOGRAM_EDGES_MS, including overflow. */
  readonly histogram: readonly number[]
}
export interface UsageAggregation {
  readonly from: string
  readonly to: string
  readonly previousFrom: string
  readonly previousTo: string
  readonly totals: UsageTotals
  readonly previousTotals: UsageTotals
  readonly buckets: UsagePageState['buckets']
  readonly breakdown: UsagePageState['breakdown']
  readonly features: UsagePageState['features']
}

export function usageLocalDay(at: number): string {
  const date = new Date(at)
  return (
    new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
      .toISOString()
      .split('T', 1)[0] ?? ''
  )
}
export function shiftUsageDay(day: string, count: number): string {
  return (
    new Date(Date.parse(day) + count * MILLISECONDS_PER_DAY).toISOString().split('T', 1)[0] ?? ''
  )
}
export function usageRange(
  query: UsageQuery,
  now: number,
): Pick<UsageAggregation, 'from' | 'to' | 'previousFrom' | 'previousTo'> {
  const to = query.range === 'custom' ? query.to : usageLocalDay(now)
  const presetDays = query.range === 'today' ? 1 : Number(query.range.slice(0, -1))
  const from = query.range === 'custom' ? query.from : shiftUsageDay(to ?? '', 1 - presetDays)
  if (from === undefined || to === undefined || from > to) throw new Error('invalid usage range')
  const days = (Date.parse(to) - Date.parse(from)) / MILLISECONDS_PER_DAY + 1
  return { from, to, previousFrom: shiftUsageDay(from, -days), previousTo: shiftUsageDay(from, -1) }
}

interface Accumulator {
  totals: UsageTotals
  histogram: number[]
}
function accumulator(): Accumulator {
  return {
    totals: { records: 0, tokens: {}, units: {}, costs: [], retries: 0, rateLimited: 0 },
    histogram: Array.from({ length: USAGE_HISTOGRAM_EDGES_MS.length + 1 }, () => 0),
  }
}
function add(target: Accumulator, value: UsageTotals, histogram: readonly number[]): void {
  const total = target.totals
  total.records += value.records
  for (const key of TOKEN_KEYS)
    if (value.tokens[key] !== undefined)
      total.tokens[key] = (total.tokens[key] ?? 0) + value.tokens[key]
  if (value.tokens.estimated === true) total.tokens.estimated = true
  for (const key of UNIT_KEYS)
    if (value.units[key] !== undefined)
      total.units[key] = (total.units[key] ?? 0) + value.units[key]
  for (const key of ['durationMs', 'firstTokenMs', 'packedAvoided'] as const)
    if (value[key] !== undefined) total[key] = (total[key] ?? 0) + value[key]
  total.retries += value.retries
  total.rateLimited += value.rateLimited
  for (const cost of value.costs) {
    let existing = total.costs.find((entry) => entry.certainty === cost.certainty)
    if (existing === undefined) {
      existing = { certainty: cost.certainty, records: 0 }
      total.costs.push(existing)
    }
    existing.records += cost.records
    for (const key of ['usd', 'apiEquivalentUsd'] as const)
      if (cost[key] !== undefined) existing[key] = (existing[key] ?? 0) + cost[key]
  }
  for (const [index, count] of histogram.entries())
    target.histogram[index] = (target.histogram[index] ?? 0) + count
}
/** Upper edge of the containing bucket; overflow uses the last finite edge. */
function percentile(histogram: readonly number[], share: number): number | undefined {
  const count = histogram.reduce((sum, value) => sum + value, 0)
  if (count === 0) return
  const rank = Math.ceil(count * share)
  let seen = 0
  for (const [index, value] of histogram.entries()) {
    seen += value
    if (seen >= rank)
      return USAGE_HISTOGRAM_EDGES_MS[Math.min(index, USAGE_HISTOGRAM_EDGES_MS.length - 1)]
  }
  return
}
function finish(value: Accumulator): UsageTotals {
  const total = value.totals
  const { input, cached, output } = total.tokens
  if (cached !== undefined && input !== undefined && input > 0)
    total.cacheHitPercent = (cached / input) * 100
  if (output !== undefined && total.durationMs !== undefined && total.durationMs > 0)
    total.tokensPerSecond = (output / total.durationMs) * MILLISECONDS_PER_SECOND
  for (const key of ['p50Ms', 'p95Ms'] as const) {
    const latency = percentile(
      value.histogram,
      Number(key.replace('p', '').replace('Ms', '')) / 100,
    )
    if (latency !== undefined) total[key] = latency
  }
  return total
}
function recordRow(record: UsageRecord): UsageAggregateRow {
  const histogram = Array.from({ length: USAGE_HISTOGRAM_EDGES_MS.length + 1 }, () => 0)
  if (record.durationMs !== undefined) {
    const found = USAGE_HISTOGRAM_EDGES_MS.findIndex(
      (edge) => record.durationMs !== undefined && record.durationMs <= edge,
    )
    histogram[found === -1 ? USAGE_HISTOGRAM_EDGES_MS.length : found] = 1
  }
  return {
    ...record,
    histogram,
    totals: {
      records: 1,
      tokens: record.tokens,
      units: record.units ?? {},
      costs: [
        {
          certainty: record.cost.certainty,
          records: 1,
          ...(record.cost.usd !== undefined && { usd: record.cost.usd }),
          ...(record.cost.apiEquivalentUsd !== undefined && {
            apiEquivalentUsd: record.cost.apiEquivalentUsd,
          }),
        },
      ],
      ...(record.durationMs !== undefined && { durationMs: record.durationMs }),
      ...(record.firstTokenMs !== undefined && { firstTokenMs: record.firstTokenMs }),
      ...(record.packedAvoided !== undefined && { packedAvoided: record.packedAvoided }),
      retries: record.retries ?? 0,
      rateLimited: record.rateLimited === true ? 1 : 0,
    },
  }
}
function groupKey(row: UsageAggregateRow, by: UsageQuery['groupBy']): string {
  return by === 'model' ? JSON.stringify([row.provider, row.model]) : row[by]
}
interface Group {
  row: UsageAggregateRow
  sum: Accumulator
}
function addGroup(
  groups: Map<string, Group>,
  row: UsageAggregateRow,
  by: UsageQuery['groupBy'],
): void {
  const key = groupKey(row, by)
  let group = groups.get(key)
  if (group === undefined) {
    group = { row, sum: accumulator() }
    groups.set(key, group)
  }
  add(group.sum, row.totals, row.histogram)
}
function groupRows(
  groups: Map<string, Group>,
  by: UsageQuery['groupBy'],
): UsagePageState['breakdown'] {
  return [...groups]
    .map(([id, { row, sum }]) => ({
      id: by === 'model' ? createHash('sha256').update(id).digest('hex') : id,
      label: row[by],
      ...(by === 'model' && { provider: row.provider, model: row.model }),
      totals: finish(sum),
    }))
    .toSorted((a, b) => a.id.localeCompare(b.id))
}

/** Week buckets start on Monday, using calendar arithmetic, never elapsed DST days. */
export function aggregateUsage(
  records: readonly UsageRecord[],
  rollups: readonly UsageAggregateRow[],
  query: UsageQuery,
  now: number,
  interval: 'hour' | 'day' | 'week' = query.range === 'today' ? 'hour' : 'day',
): UsageAggregation {
  const range = usageRange(query, now)
  const current = accumulator()
  const previous = accumulator()
  const groups = new Map<string, Group>()
  const features = new Map<UsageKind, Accumulator>()
  const buckets = new Map<
    string,
    { at: number; day: string; sum: Accumulator; groups: Map<string, Group> }
  >()
  function visit(row: UsageAggregateRow, at?: number): void {
    if (row.day >= range.previousFrom && row.day <= range.previousTo)
      add(previous, row.totals, row.histogram)
    if (row.day < range.from || row.day > range.to) return
    add(current, row.totals, row.histogram)
    addGroup(groups, row, query.groupBy)
    const feature = features.get(row.kind) ?? accumulator()
    add(feature, row.totals, row.histogram)
    features.set(row.kind, feature)
    const weekday = (new Date(row.day).getUTCDay() + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK
    const day = interval === 'week' ? shiftUsageDay(row.day, -weekday) : row.day
    const bucketAt = interval === 'hour' && at !== undefined ? at : Date.parse(day)
    const key = JSON.stringify([day, bucketAt])
    let bucket = buckets.get(key)
    if (bucket === undefined) {
      bucket = { at: bucketAt, day, sum: accumulator(), groups: new Map() }
      buckets.set(key, bucket)
    }
    add(bucket.sum, row.totals, row.histogram)
    addGroup(bucket.groups, row, query.groupBy)
  }
  for (const record of records) {
    const offset = record.timezoneOffsetMins * MINUTE_MS
    visit(recordRow(record), Math.floor((record.at - offset) / HOUR_MS) * HOUR_MS + offset)
  }
  for (const row of rollups) visit(row)
  return {
    ...range,
    totals: finish(current),
    previousTotals: finish(previous),
    buckets: Array.from(buckets, (entry) => entry[1])
      .toSorted((a, b) => a.at - b.at)
      .map((bucket) => ({
        at: bucket.at,
        day: bucket.day,
        totals: finish(bucket.sum),
        groups: groupRows(bucket.groups, query.groupBy),
      })),
    breakdown: groupRows(groups, query.groupBy),
    features: [...features].map(([kind, sum]) => ({ kind, totals: finish(sum) })),
  }
}

/** Missing durations, stale reports and expired windows have no pace. */
export function usageWindowStatus(
  window: UsageLimitSnapshot['windows'][number],
  observedAt: number,
  now: number,
): { freshness: 'fresh' | 'stale' | 'awaiting'; pace?: 'ahead' | 'even' | 'under' } {
  if (window.resetsAt !== undefined && now >= window.resetsAt) return { freshness: 'awaiting' }
  if (now - observedAt >= USAGE_STALE_MS) return { freshness: 'stale' }
  if (window.windowMins === undefined || window.windowMins <= 0 || window.resetsAt === undefined)
    return { freshness: 'fresh' }
  const elapsed =
    Math.max(0, Math.min(1, 1 - (window.resetsAt - now) / (window.windowMins * MINUTE_MS))) * 100
  const delta = window.usedPercent - elapsed
  let pace: 'ahead' | 'even' | 'under' = 'even'
  if (delta > USAGE_PACE_BAND_POINTS) pace = 'ahead'
  else if (delta < -USAGE_PACE_BAND_POINTS) pace = 'under'
  return { freshness: 'fresh', pace }
}
export function usagePeriodDelta(
  current: number | undefined,
  previous: number | undefined,
): number | undefined {
  return current === undefined || previous === undefined || previous === 0
    ? undefined
    : ((current - previous) / previous) * 100
}
/** Budget readers supply their own admission total, including retained liability. */
export function usageBurnProjection(
  spentUsd: number,
  firstSpendAt: number | undefined,
  now: number,
  resetsAt: number,
): number | undefined {
  if (
    firstSpendAt === undefined ||
    now - firstSpendAt < USAGE_BURN_MIN_MS ||
    resetsAt <= now ||
    spentUsd <= 0
  )
    return
  return spentUsd + (spentUsd / (now - firstSpendAt)) * (resetsAt - now)
}
