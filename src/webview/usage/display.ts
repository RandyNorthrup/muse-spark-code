import { MILLISECONDS_PER_SECOND, TOKENS_PER_MILLION } from '../../shared/constants'
import { USAGE_TEXT } from '../../shared/l10n/usageTable'
import {
  fill,
  formatDate,
  formatList,
  formatNumber,
  formatPercent,
  formatUnit,
} from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'
import { Usd, type UsdAmount } from '../../shared/usd'
import { USD_LIABILITY_DECIMALS } from '../../shared/usdConstants'
import type { UsageCertainty, UsageKind } from '../../shared/usageJournal'
import type {
  UsagePageState,
  UsagePageToServiceMessage,
  UsageQuery,
  UsageTotals,
} from '../../shared/usagePage'

export type BreakdownRow = UsagePageState['breakdown'][number]
export type PostUsage = (message: UsagePageToServiceMessage) => void

export function groupLabel(group: UsageQuery['groupBy']): string {
  return {
    provider: USAGE_TEXT.provider,
    model: USAGE_TEXT.model,
    kind: USAGE_TEXT.feature,
    client: USAGE_TEXT.editor,
  }[group]
}
export function metricLabel(metric: UsageQuery['metric']): string {
  return {
    cost: USAGE_TEXT.cost,
    tokens: USAGE_TEXT.tokens,
    requests: USAGE_TEXT.requests,
    time: USAGE_TEXT.time,
  }[metric]
}
export function kindLabel(kind: UsageKind): string {
  return {
    turn: USAGE_TEXT.kindTurn,
    compaction: USAGE_TEXT.kindCompaction,
    sideChat: USAGE_TEXT.kindSideChat,
    subagent: USAGE_TEXT.kindSubagent,
    worker: USAGE_TEXT.kindWorker,
    reviewer: USAGE_TEXT.kindReviewer,
    bestOfN: USAGE_TEXT.kindBestOfN,
    tab: USAGE_TEXT.kindTab,
    schedule: USAGE_TEXT.kindSchedule,
    vscodeChat: USAGE_TEXT.kindVscodeChat,
    hook: USAGE_TEXT.kindHook,
    search: USAGE_TEXT.kindSearch,
    image: USAGE_TEXT.kindImage,
    voice: USAGE_TEXT.kindVoice,
    count: USAGE_TEXT.kindCount,
  }[kind]
}
export function certaintyLabel(certainty: UsageCertainty): string {
  return {
    reported: USAGE_TEXT.certaintyReported,
    computed: USAGE_TEXT.certaintyComputed,
    uncertain: USAGE_TEXT.certaintyUncertain,
    plan: USAGE_TEXT.certaintyPlan,
    local: USAGE_TEXT.certaintyLocal,
    unpriced: USAGE_TEXT.certaintyUnpriced,
    estimated: USAGE_TEXT.certaintyEstimated,
  }[certainty]
}
export function money(value: UsdAmount | undefined): string {
  return value === undefined ? USAGE_TEXT.unknown : formatUsd(value, 2)
}
/**
 * Exact cost label: the original amount, never a value rebuilt from plotted
 * geometry (geometry ceils sub-nano-dollars, so a label made from it would
 * overstate small charges; M121 P2-2).
 */
export function costLabel(totals: UsageTotals): string {
  return money(billedCost(totals))
}
/** Exact sum of the known amounts (M121); undefined when none is known. */
export function usdSum(values: readonly (UsdAmount | undefined)[]): UsdAmount | undefined {
  let sum: Usd | undefined
  for (const value of values)
    if (value !== undefined) sum = (sum ?? Usd.from(0)).add(Usd.from(value))
  return sum?.toAmount()
}
/** Whole percent of a cap, floored, so a threshold is crossed exactly when the amount is. */
export function percentOf(part: UsdAmount, whole: UsdAmount): number {
  const cap = Usd.from(whole)
  return cap.compare(Usd.from(0)) <= 0 ? 100 : Number(Usd.from(part).times(100).floorDivide(cap))
}
/** What is left under a cap, never below zero. */
export function remainingUsd(spent: UsdAmount, cap: UsdAmount): UsdAmount {
  const left = Usd.from(cap).subtract(Usd.from(spent))
  return left.compare(Usd.from(0)) < 0 ? Usd.from(0).toAmount() : left.toAmount()
}
/**
 * Chart geometry for dollars: whole nano-dollars, rounded up. Labels, sorting
 * and period comparisons use the original amounts, never this projection.
 */
export function costPlot(amount: UsdAmount | undefined): number | undefined {
  return amount === undefined
    ? undefined
    : Number(Usd.from(amount).ceiling(USD_LIABILITY_DECIMALS).units(USD_LIABILITY_DECIMALS))
}
export function count(value: number | undefined): string {
  return value === undefined ? USAGE_TEXT.unknown : formatNumber(value)
}
export function duration(value: number | undefined): string {
  return value === undefined
    ? USAGE_TEXT.unknown
    : formatUnit(value / MILLISECONDS_PER_SECOND, 'second')
}
export function dayLabel(day: string): string {
  // Parse a local calendar date, rather than moving midnight UTC into yesterday.
  const [year, month, date] = day.split('-').map(Number)
  return formatDate(new Date(year ?? 0, (month ?? 1) - 1, date ?? 1).getTime())
}
export function knownSum(values: readonly (number | undefined)[]): number | undefined {
  const known = values.filter((value) => value !== undefined)
  return known.length === 0 ? undefined : known.reduce((total, value) => total + value, 0)
}
export function billedCost(totals: UsageTotals): UsdAmount | undefined {
  return usdSum(
    totals.costs
      .filter(
        (row) =>
          row.certainty !== 'plan' && row.certainty !== 'uncertain' && row.certainty !== 'unpriced',
      )
      .map((row) => row.usd),
  )
}
export function equivalentCost(totals: UsageTotals): UsdAmount | undefined {
  return usdSum(totals.costs.map((row) => row.apiEquivalentUsd))
}
/** A chart's value: counts as they are, dollars as whole nano-dollars (`costPlot`). */
export function metricValue(totals: UsageTotals, metric: UsageQuery['metric']): number | undefined {
  switch (metric) {
    case 'cost': {
      return costPlot(billedCost(totals))
    }
    case 'tokens': {
      return totals.tokens.input === undefined || totals.tokens.output === undefined
        ? undefined
        : totals.tokens.input + totals.tokens.output
    }
    case 'requests': {
      return totals.records
    }
    case 'time': {
      return totals.durationMs
    }
  }
}
export function metricText(value: number | undefined, metric: UsageQuery['metric']): string {
  if (metric === 'cost')
    return money(
      value === undefined
        ? undefined
        : Usd.fromUnits(BigInt(value), USD_LIABILITY_DECIMALS).toAmount(),
    )
  return metric === 'time' ? duration(value) : count(value)
}
export function costText(totals: UsageTotals): string {
  if (totals.costs.length === 0) return USAGE_TEXT.unknown
  return formatList(
    totals.costs.map((row) => {
      const equivalent =
        row.apiEquivalentUsd === undefined
          ? ''
          : ` (${USAGE_TEXT.apiEquivalent}: ${money(row.apiEquivalentUsd)})`
      return `${certaintyLabel(row.certainty)}: ${money(row.usd)}${equivalent}`
    }),
  )
}
export function totalsFacts(
  totals: UsageTotals,
): readonly { readonly label: string; readonly value: string }[] {
  const input = totals.tokens.input
  const output = totals.tokens.output
  const billed = billedCost(totals)
  const totalTokens = input === undefined || output === undefined ? undefined : input + output
  return [
    { label: USAGE_TEXT.totalCost, value: money(billed) },
    { label: USAGE_TEXT.apiEquivalent, value: money(equivalentCost(totals)) },
    { label: USAGE_TEXT.inputTokens, value: count(input) },
    { label: USAGE_TEXT.outputTokens, value: count(output) },
    { label: USAGE_TEXT.cachedTokens, value: count(totals.tokens.cached) },
    { label: USAGE_TEXT.cacheWriteTokens, value: count(totals.tokens.cacheWrite) },
    {
      label: fill(USAGE_TEXT.cacheWrite1hTokens, { duration: formatUnit(1, 'hour') }),
      value: count(totals.tokens.cacheWrite1h),
    },
    { label: USAGE_TEXT.reasoningTokens, value: count(totals.tokens.reasoning) },
    { label: USAGE_TEXT.requests, value: count(totals.records) },
    { label: USAGE_TEXT.totalTime, value: duration(totals.durationMs) },
    { label: USAGE_TEXT.firstToken, value: duration(totals.firstTokenMs) },
    { label: USAGE_TEXT.latencyP50, value: duration(totals.p50Ms) },
    { label: USAGE_TEXT.latencyP95, value: duration(totals.p95Ms) },
    {
      label: USAGE_TEXT.cacheHit,
      value:
        totals.cacheHitPercent === undefined
          ? USAGE_TEXT.unknown
          : formatPercent(totals.cacheHitPercent),
    },
    { label: USAGE_TEXT.tokensPerSecond, value: count(totals.tokensPerSecond) },
    {
      label: USAGE_TEXT.blendedPrice,
      value:
        billed === undefined || totalTokens === undefined || totalTokens === 0
          ? USAGE_TEXT.unknown
          : money(
              Usd.from(billed)
                .times(TOKENS_PER_MILLION)
                .divideIntegerCeiling(totalTokens)
                .toAmount(),
            ),
    },
    { label: USAGE_TEXT.retries, value: count(totals.retries) },
    { label: USAGE_TEXT.rateLimited, value: count(totals.rateLimited) },
  ]
}
