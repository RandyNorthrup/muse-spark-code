// D88.11. M102 supplies validated journal projections; labels stay local.
import * as z from 'zod/mini'
import {
  accountEventSchema,
  accountIdSchema,
  accountPoolSchema,
  accountSchema,
  type AccountEvent,
  type AccountThresholds,
} from '../../shared/accounts'
import { ACCOUNT_DEFAULT_ID, DAYS_PER_WEEK, UI_TEXT } from '../../shared/constants'
import { multiplyUsd, parseUsd, usdDecimal, usdNumber } from '../../shared/accountUsd'
import { Usd as ExactUsd } from '../../shared/usd'
import type { AccountLimitsReader } from '../accounts/thresholds'

type Period = 'day' | 'week' | 'month'
interface Range {
  readonly start: string
  readonly end: string
}
const count = z.int().check(z.nonnegative())
const amount = z.union([z.number().check(z.nonnegative()), z.string().check(z.minLength(1))])
// Local adapter contract, not a vendor frame or a replacement M102 envelope.
const recordSchema = z.strictObject({
  provider: accountIdSchema,
  account: z.optional(accountIdSchema),
  time: z.iso.datetime(),
  settledUsd: amount,
  reservedUsd: amount,
  uncertainUsd: amount,
  inputTokens: count,
  outputTokens: count,
  requests: count,
})
const catalogSchema = z.strictObject({
  provider: accountIdSchema,
  label: accountSchema.shape.label,
  accounts: accountPoolSchema,
})
export interface AccountUsageSource {
  /** Return each current projection once: period history plus every unresolved
   * reservation/uncertainty before end, even when created before start. */
  records(range: Range & { readonly includeOutstanding: true }): unknown
  events(range: Range): unknown
}
export type AccountUsageCatalog = z.infer<typeof catalogSchema>
export interface AccountUsageTotals {
  readonly settledUsd: string
  readonly reservedUsd: string
  readonly uncertainUsd: string
  readonly liabilityUsd: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly requests: number
}
export interface AccountUsageMeter {
  readonly metric:
    'spendUsd' | 'inputTokens' | 'outputTokens' | 'requests' | 'planWindow' | 'rateHeadroom'
  readonly period?: Period
  readonly window?: string
  readonly unit: 'usd' | 'count' | 'percent'
  readonly value: string | null
  readonly threshold: string
  readonly progress: number | null
  readonly isReached: boolean | null
  readonly resetAt: string | null
}
export interface AccountUsageRow {
  readonly provider: string
  readonly providerLabel: string
  readonly account: string
  readonly label: string
  readonly totals: AccountUsageTotals
  readonly meters: readonly AccountUsageMeter[]
}
export interface AccountUsageReport extends Range {
  readonly period: Period
  readonly accounts: readonly AccountUsageRow[]
  readonly events: readonly AccountEvent[]
}

function rangeFor(period: Period, now: Date): Range {
  const day = now.getDate()
  const date =
    period === 'month'
      ? 1
      : day - (period === 'week' ? (now.getDay() + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK : 0)
  const start = new Date(now.getFullYear(), now.getMonth(), date)
  const end = new Date(
    now.getFullYear(),
    now.getMonth() + (period === 'month' ? 1 : 0),
    date + { day: 1, week: DAYS_PER_WEEK, month: 0 }[period],
  )
  return { start: start.toISOString(), end: end.toISOString() }
}

function safeSum(left: number, right: number): number {
  const result = BigInt(left) + BigInt(right)
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
  return Number(result)
}

function totalsFor(
  records: readonly z.infer<typeof recordSchema>[],
  range: Range,
): AccountUsageTotals {
  // Exact decimal accumulation, the same contract as admission: rounding spend
  // up through nano-USD here would report a cap reached that admission has
  // not (cap '0.1000000005' with '0.1000000001' spent is not reached).
  const money = {
    settledUsd: ExactUsd.from(0),
    reservedUsd: ExactUsd.from(0),
    uncertainUsd: ExactUsd.from(0),
  }
  const counts = { inputTokens: 0, outputTokens: 0, requests: 0 }
  for (const row of records) {
    if (Date.parse(row.time) >= Date.parse(range.end)) continue
    // Outstanding claims survive calendar resets; only settled history is bounded.
    for (const metric of ['reservedUsd', 'uncertainUsd'] as const)
      money[metric] = money[metric].add(ExactUsd.from(row[metric]))
    if (Date.parse(row.time) < Date.parse(range.start)) continue
    money.settledUsd = money.settledUsd.add(ExactUsd.from(row.settledUsd))
    for (const metric of ['inputTokens', 'outputTokens', 'requests'] as const)
      counts[metric] = safeSum(counts[metric], row[metric])
  }
  const liability = money.settledUsd.add(money.reservedUsd).add(money.uncertainUsd)
  return {
    ...counts,
    settledUsd: money.settledUsd.toString(),
    reservedUsd: money.reservedUsd.toString(),
    uncertainUsd: money.uncertainUsd.toString(),
    liabilityUsd: liability.toString(),
  }
}

function progress(value: bigint, cap: bigint): number {
  if (cap === parseUsd(0)) return 100
  const fullPercent = 100n
  return Number(value >= cap ? 100 : (value * fullPercent) / cap)
}

function percentProgress(value: number, threshold: number): number {
  return threshold === 0 || value >= threshold
    ? 100
    : Math.min(100 - 1, Math.floor((value / threshold) * 100))
}

function metersFor(
  thresholds: AccountThresholds,
  records: readonly z.infer<typeof recordSchema>[],
  ranges: Readonly<Record<Period, Range>>,
  snapshot: ReturnType<AccountLimitsReader['read']> | undefined,
  now: number,
): AccountUsageMeter[] {
  const meters: AccountUsageMeter[] = []
  for (const period of ['day', 'week', 'month'] as const) {
    const totals = totalsFor(records, ranges[period])
    for (const metric of ['spendUsd', 'inputTokens', 'outputTokens', 'requests'] as const) {
      if (metric === 'spendUsd') {
        // Exact decimal comparison, the same contract as admission: a cap of
        // '0.1000000000000000001' with '0.1' spent is not reached. The
        // threshold string is already canonical, so it is carried through
        // without a nano-USD round trip.
        const capText = thresholds.spendUsd?.[period]
        if (capText === undefined) continue
        const cap = ExactUsd.from(capText)
        const used = ExactUsd.from(totals.liabilityUsd)
        const isReached = used.compare(cap) >= 0
        meters.push({
          metric,
          period,
          unit: 'usd',
          value: totals.liabilityUsd,
          threshold: capText,
          progress: isReached ? 100 : Number(used.times(100).floorDivide(cap)),
          isReached,
          resetAt: ranges[period].end,
        })
        continue
      }
      const threshold = thresholds[metric]?.[period]
      if (threshold === undefined) continue
      const cap = BigInt(threshold)
      const used = BigInt(String(totals[metric]))
      meters.push({
        metric,
        period,
        unit: 'count',
        value: String(totals[metric]),
        threshold: String(threshold),
        progress: progress(used, cap),
        isReached: used >= cap,
        resetAt: ranges[period].end,
      })
    }
  }
  const isActive = (reset: string | null) => reset === null || Date.parse(reset) > now
  const percentage = z.number().check(z.minimum(0), z.maximum(100))
  const resetSchema = z.nullable(z.iso.datetime())
  const windows = Object.entries(thresholds.planWindowPercent ?? {})
  for (const [window, threshold] of windows) {
    const live = snapshot?.planWindows?.[window]
    const resetAt = live === undefined ? null : resetSchema.parse(live.resetAt)
    const used = live === undefined ? null : percentage.parse(live.usedPercent)
    const isAvailable = used !== null && isActive(resetAt)
    meters.push({
      metric: 'planWindow',
      window,
      unit: 'percent',
      threshold: String(threshold),
      resetAt,
      value: isAvailable ? String(used) : null,
      progress: isAvailable ? percentProgress(used, threshold) : null,
      isReached: isAvailable ? used >= threshold : null,
    })
  }
  for (const window of ['requests', 'tokens'] as const) {
    const threshold = thresholds.rateLimitHeadroomPercent?.[window]
    if (threshold === undefined) continue
    const live = snapshot?.rateLimits?.[window]
    const cap = parseUsd(threshold)
    if (usdNumber(cap) !== threshold) throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    let remaining: bigint | null = null,
      limit = parseUsd(0),
      resetAt: string | null = null
    if (live !== undefined) {
      const parsed = z
        .strictObject({
          limit: count.check(z.positive()),
          remaining: count,
          resetAt: z.iso.datetime(),
        })
        .parse(live)
      if (parsed.remaining > parsed.limit) throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
      resetAt = parsed.resetAt
      limit = BigInt(parsed.limit)
      if (isActive(resetAt)) remaining = BigInt(parsed.remaining)
    }
    const value = remaining === null ? null : multiplyUsd(parseUsd(100), remaining, limit, 'floor')
    meters.push({
      metric: 'rateHeadroom',
      window,
      unit: 'percent',
      threshold: usdDecimal(cap),
      resetAt,
      value: value === null ? null : usdDecimal(value),
      progress: remaining === null ? null : progress(remaining, limit),
      isReached:
        remaining === null
          ? null
          : multiplyUsd(parseUsd(100), remaining) <= multiplyUsd(cap, limit),
    })
  }
  return meters
}

/** Read-only snapshot. Its output is JSON-safe; no credential or label is persisted. */
export function readAccountUsage(deps: {
  readonly source: AccountUsageSource
  readonly catalog: readonly AccountUsageCatalog[]
  readonly limits?: AccountLimitsReader
  readonly period: Period
  readonly now: number
}): AccountUsageReport {
  const now = new Date(deps.now)
  if (!Number.isFinite(now.getTime())) throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
  const period = z.enum(['day', 'week', 'month']).parse(deps.period)
  const ranges = {
    day: rangeFor('day', now),
    week: rangeFor('week', now),
    month: rangeFor('month', now),
  }
  const range = ranges[period]
  const history = {
    start:
      Object.values(ranges)
        .map((entry) => entry.start)
        .toSorted((a, b) => Date.parse(a) - Date.parse(b))[0] ?? range.start,
    // Include commits observed in this millisecond; the source range stays half-open.
    end: new Date(now.getTime() + 1).toISOString(),
  }
  const catalog = z.array(catalogSchema).parse(deps.catalog)
  if (new Set(catalog.map((entry) => entry.provider)).size !== catalog.length)
    throw new Error(UI_TEXT.accounts.invalidAccount)
  const records = z
    .array(recordSchema)
    .parse(deps.source.records({ ...history, includeOutstanding: true }))
  // Validate money even on ignored rows; malformed source data cannot look like no use.
  for (const row of records)
    for (const metric of ['settledUsd', 'reservedUsd', 'uncertainUsd'] as const)
      parseUsd(row[metric])
  const events = z
    .array(accountEventSchema)
    .parse(deps.source.events({ start: range.start, end: history.end }))
    .filter(
      (event) =>
        Date.parse(event.time) >= Date.parse(range.start) && Date.parse(event.time) <= deps.now,
    )
    .toSorted((a, b) => Date.parse(a.time) - Date.parse(b.time))
  const groups = new Map<
    string,
    { provider: string; account: string; records: z.infer<typeof recordSchema>[] }
  >()
  const group = (provider: string, account: string) => {
    const key = JSON.stringify([provider, account])
    let row = groups.get(key)
    if (row === undefined) {
      row = { provider, account, records: [] }
      groups.set(key, row)
    }
    return row
  }
  for (const provider of catalog) {
    const ordered = provider.accounts.toSorted((a, b) => a.order - b.order)
    for (const account of ordered) group(provider.provider, account.id)
  }
  for (const record of records)
    if (
      Date.parse(record.time) <= deps.now &&
      (Date.parse(record.time) >= Date.parse(history.start) ||
        parseUsd(record.reservedUsd) > 0 ||
        parseUsd(record.uncertainUsd) > 0)
    )
      group(record.provider, record.account ?? ACCOUNT_DEFAULT_ID).records.push(record)
  for (const event of events) {
    group(event.provider, event.account)
    if (event.type === 'swap') group(event.provider, event.previousAccount)
  }
  return {
    ...range,
    period,
    events,
    accounts: Array.from(groups.values(), (entry) => {
      const provider = catalog.find((row) => row.provider === entry.provider)
      const account = provider?.accounts.find((row) => row.id === entry.account)
      const thresholds = account?.thresholds ?? {}
      const isNeedsLimits =
        Object.keys(thresholds.planWindowPercent ?? {}).length > 0 ||
        Object.keys(thresholds.rateLimitHeadroomPercent ?? {}).length > 0
      return {
        provider: entry.provider,
        providerLabel: provider?.label ?? entry.provider,
        account: entry.account,
        label:
          account?.label ??
          (entry.account === ACCOUNT_DEFAULT_ID ? UI_TEXT.accounts.defaultLabel : entry.account),
        totals: totalsFor(entry.records, { start: range.start, end: history.end }),
        meters: metersFor(
          thresholds,
          entry.records,
          ranges,
          isNeedsLimits ? deps.limits?.read(entry.provider, entry.account) : undefined,
          deps.now,
        ),
      }
    }),
  }
}
