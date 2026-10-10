// Session and usage report inputs (M113 lane C-M113-2, PLAN.md D93.4).
// Pure mapping from M102's journal onto the reporting UsageFacts contract:
// the totals come from aggregate.ts itself, so they are the same numbers as
// M102's page for the same range. No journal parser is guessed here; the
// host supplies already-validated journal rows.
import { LocalSourceError, codeUnitCompare, sourceReason } from '../reporting/sources/local'
import {
  aggregateUsage,
  usageLocalDay,
  usageRange,
  usdUnits,
  shiftUsageDay,
  type UsageAggregation,
} from './aggregate'
import { Usd } from '../../shared/usd'
import type { UsageLimitSnapshot, UsageRecord } from '../../shared/usageJournal'
import type { UsageQuery, UsageTotals } from '../../shared/usagePage'
import type { ReportOptions } from '../../shared/reportSchema'
import { DAYS_PER_WEEK, EXEC_USD_UNITS, REPORT_MAX_ROWS, UI_TEXT } from '../../shared/constants'
import type { UsageAggregateRow } from './aggregate'
import type { UsageFacts } from '../reporting/sources/types'

export interface UsageReportJournal {
  readonly records: readonly UsageRecord[]
  readonly rollups: readonly UsageAggregateRow[]
  readonly limits: readonly UsageLimitSnapshot[]
}

type BreakdownBy = NonNullable<ReportOptions['by']>

// EXEC_USD_UNITS is the micro-dollar radix; its decimal places price the sum.
const MICRO_DOLLAR_PLACES = String(EXEC_USD_UNITS).length - 1

function fail(): never {
  throw new LocalSourceError('invalid')
}

function parseDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))) fail()
  return value
}

/** The report's period positional becomes the page's own query range. */
/** Session, account and tool group kept records; the rest use the page's own grouping. */
function pageGroupBy(by: ReportOptions['by']): UsageQuery['groupBy'] {
  switch (by) {
    case 'provider':
    case 'kind':
    case 'client': {
      return by
    }
    default: {
      return 'model'
    }
  }
}

export function usageReportQuery(scope: string, by: ReportOptions['by'], now: number): UsageQuery {
  const today = usageLocalDay(now)
  if (today === '') fail()
  const groupBy = pageGroupBy(by)
  const base = { groupBy, metric: 'cost' } as const
  if (['', 'today'].includes(scope)) return { range: 'today', ...base }
  switch (scope) {
    case '7d':
    case '30d':
    case '90d': {
      return { range: scope, ...base }
    }
  }
  if (scope === 'week') {
    // Monday-start weeks, the same calendar arithmetic aggregate.ts buckets by.
    const weekday = (new Date(today).getUTCDay() + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK
    return { range: 'custom', from: shiftUsageDay(today, -weekday), to: today, ...base }
  }
  if (scope === 'month')
    return {
      range: 'custom',
      from: `${today.split('-').slice(0, 2).join('-')}-01`,
      to: today,
      ...base,
    }
  const month = /^(\d{4})-(\d{2})$/.exec(scope)
  if (month !== null) {
    const yearText = month[1] ?? ''
    const monthText = month[2] ?? ''
    const year = Number(yearText)
    const index = Number(monthText) - 1
    const first = new Date(Date.UTC(year, index, 1))
    if (
      yearText === '' ||
      monthText === '' ||
      !Number.isSafeInteger(year) ||
      !Number.isSafeInteger(index) ||
      first.getUTCFullYear() !== year ||
      first.getUTCMonth() !== index
    )
      fail()
    const from = `${yearText}-${monthText}-01`
    const next = new Date(Date.UTC(year, index + 1, 1)).toISOString().split('T', 1)[0]
    if (next === undefined) fail()
    return { range: 'custom', from, to: shiftUsageDay(next, -1), ...base }
  }
  const range = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(scope)
  if (range === null) fail()
  const from = parseDay(range[1] ?? '')
  const to = parseDay(range[2] ?? '')
  if (from > to) fail()
  return { range: 'custom', from, to, ...base }
}

type Certainty = UsageFacts['certainty']

function factsCertainty(certainties: readonly string[], hasEstimatedTokens: boolean): Certainty {
  if (hasEstimatedTokens) return 'estimated'
  if (certainties.length === 0) return 'unknown'
  if (certainties.every((certainty) => certainty === 'reported')) return 'reported'
  return certainties.every((certainty) => certainty === 'reported' || certainty === 'estimated')
    ? 'estimated'
    : 'unknown'
}

interface TokenCostSums {
  input: number
  output: number
  cached: number
  hasCached: boolean
  usd: (number | undefined)[]
  certainties: string[]
  hasEstimatedTokens: boolean
}

function emptySums(): TokenCostSums {
  return {
    input: 0,
    output: 0,
    cached: 0,
    hasCached: false,
    usd: [],
    certainties: [],
    hasEstimatedTokens: false,
  }
}

function addTotals(sums: TokenCostSums, totals: UsageTotals): void {
  sums.input += totals.tokens.input ?? 0
  sums.output += totals.tokens.output ?? 0
  if (totals.tokens.cached !== undefined) {
    sums.cached += totals.tokens.cached
    sums.hasCached = true
  }
  if (totals.tokens.estimated === true) sums.hasEstimatedTokens = true
  for (const cost of totals.costs) {
    sums.certainties.push(cost.certainty)
    sums.usd.push(cost.usd)
  }
}

function addRecord(sums: TokenCostSums, record: UsageRecord): void {
  sums.input += record.tokens.input ?? 0
  sums.output += record.tokens.output ?? 0
  if (record.tokens.cached !== undefined) {
    sums.cached += record.tokens.cached
    sums.hasCached = true
  }
  if (record.tokens.estimated === true) sums.hasEstimatedTokens = true
  sums.certainties.push(record.cost.certainty)
  sums.usd.push(record.cost.usd)
}

function finishSums(sums: TokenCostSums, period: string): UsageFacts {
  // Integer micro-dollars end to end: the float quotient never carries money.
  let units = 0
  let priced = 0
  for (const value of sums.usd) {
    if (value === undefined) continue
    units += usdUnits(value)
    if (!Number.isSafeInteger(units)) throw new Error('unsafe usage sum')
    priced += 1
  }
  return {
    period,
    inputTokens: sums.input,
    outputTokens: sums.output,
    cachedTokens: sums.hasCached ? sums.cached : null,
    costUsd: priced === 0 ? null : Usd.fromUnits(BigInt(units), MICRO_DOLLAR_PLACES).toAmount(),
    certainty: factsCertainty(sums.certainties, sums.hasEstimatedTokens),
    breakdown: [],
    limits: [],
  }
}

/** One breakdown row per aggregate group; model keys carry their provider. */
function pageBreakdown(aggregation: UsageAggregation, by: BreakdownBy): UsageFacts['breakdown'] {
  return aggregation.breakdown.map((row) => {
    const sums = emptySums()
    addTotals(sums, row.totals)
    const facts = finishSums(sums, aggregation.from)
    return {
      key: by === 'model' ? `${row.provider ?? 'unknown'}/${row.model ?? row.label}` : row.label,
      inputTokens: facts.inputTokens,
      outputTokens: facts.outputTokens,
      costUsd: facts.costUsd,
      certainty: facts.certainty,
    }
  })
}

/** Records the rollups cannot attribute keep their totals; the rows name kept records. */
function journalBreakdown(
  records: readonly UsageRecord[],
  from: string,
  to: string,
  by: 'session' | 'account',
): UsageFacts['breakdown'] {
  const groups = new Map<string, TokenCostSums>()
  for (const record of records) {
    if (record.day < from || record.day > to) continue
    const key = by === 'session' ? (record.session ?? 'unknown') : (record.account ?? 'default')
    let sums = groups.get(key)
    if (sums === undefined) {
      sums = emptySums()
      groups.set(key, sums)
    }
    addRecord(sums, record)
  }
  return [...groups]
    .toSorted(([left], [right]) => codeUnitCompare(left, right))
    .map(([key, sums]) => {
      const facts = finishSums(sums, from)
      return {
        key,
        inputTokens: facts.inputTokens,
        outputTokens: facts.outputTokens,
        costUsd: facts.costUsd,
        certainty: facts.certainty,
      }
    })
}

function journalLimits(limits: readonly UsageLimitSnapshot[]): UsageFacts['limits'] {
  const latest = new Map<string, { used: number; resetsAt: string | null; observedAt: number }>()
  for (const snapshot of limits) {
    for (const window of snapshot.windows) {
      const key = `${snapshot.provider}/${window.label ?? window.id}`
      const previous = latest.get(key)
      if (previous !== undefined && previous.observedAt > snapshot.observedAt) continue
      latest.set(key, {
        used: window.usedPercent,
        resetsAt: window.resetsAt === undefined ? null : new Date(window.resetsAt).toISOString(),
        observedAt: snapshot.observedAt,
      })
    }
  }
  return [...latest]
    .toSorted(([left], [right]) => codeUnitCompare(left, right))
    .map(([key, entry]) => ({ key, used: entry.used, limit: 100, resetsAt: entry.resetsAt }))
}

function capRows<T>(rows: readonly T[]): { rows: T[]; capped: boolean } {
  return rows.length <= REPORT_MAX_ROWS
    ? { rows: [...rows], capped: false }
    : { rows: rows.slice(0, REPORT_MAX_ROWS), capped: true }
}

export interface UsageReportFacts {
  readonly usage: UsageFacts
  readonly observedAt: string
  readonly partial?: string
}

/**
 * The usage kind from the durable journal: totals and the page-supported
 * breakdowns are aggregate.ts's own numbers; session/account breakdowns group
 * the kept records (rolled-up days are totals-only); per-tool use is not
 * recorded, so --by tool stays partial instead of inventing rows.
 */
export function usageReportFacts(input: {
  readonly journal: UsageReportJournal
  readonly scope: string
  readonly by: ReportOptions['by']
  readonly now: number
  readonly asOf: string
}): UsageReportFacts {
  const query = usageReportQuery(input.scope, input.by, input.now)
  const aggregation = aggregateUsage(input.journal.records, input.journal.rollups, query, input.now)
  const range = usageRange(query, input.now)
  const by: BreakdownBy = input.by ?? 'model'
  const partials: string[] = []
  let breakdown: UsageFacts['breakdown']
  if (by === 'tool') {
    breakdown = []
    partials.push(UI_TEXT.reportDetailReasons.toolBreakdownUnavailable)
  } else if (by === 'session' || by === 'account') {
    breakdown = journalBreakdown(input.journal.records, range.from, range.to, by)
    if (input.journal.rollups.some((row) => row.day >= range.from && row.day <= range.to))
      partials.push(UI_TEXT.reportDetailReasons.rolledUpBreakdownExcluded)
  } else {
    breakdown = pageBreakdown(aggregation, by)
  }
  const totals = emptySums()
  addTotals(totals, aggregation.totals)
  const period = input.scope === '' ? 'today' : input.scope
  const facts = finishSums(totals, period)
  const cappedBreakdown = capRows(breakdown)
  if (cappedBreakdown.capped) partials.push(sourceReason('limit'))
  const cappedLimits = capRows(journalLimits(input.journal.limits))
  if (cappedLimits.capped && !partials.includes(sourceReason('limit')))
    partials.push(sourceReason('limit'))
  return {
    usage: { ...facts, breakdown: cappedBreakdown.rows, limits: cappedLimits.rows },
    observedAt: input.asOf,
    ...(partials.length > 0 && { partial: partials.join(' ') }),
  }
}

/**
 * The session kind's usage: the kept records for one session, grouped by
 * model. The journal never attributes rolled-up days to a session, so a
 * session older than its rollup reads zeros with unknown certainty rather
 * than a guess.
 */
export function sessionUsageFacts(records: readonly UsageRecord[], sessionId: string): UsageFacts {
  const groups = new Map<string, TokenCostSums>()
  for (const record of records) {
    if (record.session !== sessionId) continue
    const key = `${record.provider}/${record.model}`
    let sums = groups.get(key)
    if (sums === undefined) {
      sums = emptySums()
      groups.set(key, sums)
    }
    addRecord(sums, record)
  }
  const totals = emptySums()
  const breakdown: UsageFacts['breakdown'] = [...groups]
    .toSorted(([left], [right]) => codeUnitCompare(left, right))
    .map(([key, sums]) => {
      totals.input += sums.input
      totals.output += sums.output
      if (sums.hasCached) {
        totals.cached += sums.cached
        totals.hasCached = true
      }
      if (sums.hasEstimatedTokens) totals.hasEstimatedTokens = true
      totals.certainties.push(...sums.certainties)
      totals.usd.push(...sums.usd)
      const facts = finishSums(sums, 'session')
      return {
        key,
        inputTokens: facts.inputTokens,
        outputTokens: facts.outputTokens,
        costUsd: facts.costUsd,
        certainty: facts.certainty,
      }
    })
  const capped = capRows(breakdown)
  return { ...finishSums(totals, 'session'), breakdown: capped.rows, limits: [] }
}

/** Distinct turn ids kept before M84's portable projection drops them. */
export function sessionTurnCount(
  items: readonly { readonly turnId?: string | undefined }[],
): number | null {
  const turns = new Set<string>()
  for (const item of items) {
    if (item.turnId !== undefined) turns.add(item.turnId)
  }
  if (turns.size > 0) return turns.size
  return items.length === 0 ? 0 : null
}
