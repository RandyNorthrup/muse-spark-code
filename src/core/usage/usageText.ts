// ACP /usage and the terminal render the very same page state. Technical
// provider/model labels are escaped; numbers use the installed display locale.
import { MILLISECONDS_PER_SECOND } from '../../shared/constants'
import {
  fill,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatUnit,
  formatUsd,
  plural,
} from '../../shared/l10n/text'
import { USAGE_TEXT } from '../../shared/l10n/usageTable'
import type { UsageCertainty, UsageLimitSnapshot } from '../../shared/usageJournal'
import type { UsagePageState, UsageTotals } from '../../shared/usagePage'
import { usagePeriodDelta, usageRange, usageSumUsd, usageWindowStatus } from './aggregate'

export type UsageTextFormat = 'markdown' | 'plain'
function certaintyLabel(certainty: UsageCertainty): string {
  const keys = {
    reported: 'certaintyReported',
    computed: 'certaintyComputed',
    uncertain: 'certaintyUncertain',
    plan: 'certaintyPlan',
    local: 'certaintyLocal',
    unpriced: 'certaintyUnpriced',
    estimated: 'certaintyEstimated',
  } as const
  return USAGE_TEXT[keys[certainty]]
}
function certaintyNote(certainty: UsageCertainty): string | undefined {
  if (certainty === 'uncertain') return USAGE_TEXT.uncertainNote
  if (certainty === 'unpriced') return USAGE_TEXT.unpricedNote
  if (certainty === 'plan') return USAGE_TEXT.apiEquivalentNote
  return
}
function amount(value: number | undefined): string {
  return value === undefined ? USAGE_TEXT.unknown : formatUsd(value, 2)
}
function count(value: number | undefined): string {
  return value === undefined ? USAGE_TEXT.unknown : formatNumber(value)
}
/** Liability and API-equivalent plan dollars never become confirmed charges. */
function charge(totals: UsageTotals): number | undefined {
  const costs = totals.costs.filter(
    (cost) => !['plan', 'uncertain', 'unpriced'].includes(cost.certainty) && cost.usd !== undefined,
  )
  return usageSumUsd(costs.map((cost) => cost.usd))
}
export function usageText(
  state: UsagePageState,
  format: UsageTextFormat = 'plain',
  section: 'summary' | 'daily' | 'models' | 'limits' = 'summary',
): string {
  const isMarkdown = format === 'markdown'
  const escape = (value: string): string =>
    isMarkdown
      ? value.replaceAll(/[\\`*_{}[\]()<>|#~]/g, String.raw`\$&`).replaceAll(/\p{Cc}/gu, ' ')
      : value.replaceAll(/\p{Cc}/gu, ' ')
  const lines: string[] = []
  const heading = (label: string): void => {
    lines.push('', isMarkdown ? `## ${escape(label)}` : label)
  }
  const row = (label: string, value: string): void => {
    lines.push(`${isMarkdown ? '- ' : ''}${escape(label)}: ${escape(value)}`)
  }
  lines.push(
    isMarkdown ? `# ${escape(USAGE_TEXT.title)}` : USAGE_TEXT.title,
    escape(USAGE_TEXT.readOnlyActions),
  )
  const range = usageRange(state.query, state.generatedAt)
  row(USAGE_TEXT.fromDate, formatDate(new Date(`${range.from}T12:00:00`).getTime()))
  row(USAGE_TEXT.toDate, formatDate(new Date(`${range.to}T12:00:00`).getTime()))
  lines.push(escape(fill(USAGE_TEXT.journalHost, { host: state.history.host })))
  if (!state.history.enabled) lines.push(escape(USAGE_TEXT.historyOffDetail))
  if (state.history.since !== undefined)
    lines.push(
      escape(
        fill(USAGE_TEXT.historySince, {
          date: formatDate(new Date(`${state.history.since}T12:00:00`).getTime()),
        }),
      ),
    )
  if (state.history.newerVersionRecords > 0)
    lines.push(escape(plural(USAGE_TEXT.newerRecords, state.history.newerVersionRecords)))
  if (state.history.tornLines > 0)
    lines.push(escape(plural(USAGE_TEXT.tornLines, state.history.tornLines)))
  const introEnd = lines.length
  row(USAGE_TEXT.requests, plural(USAGE_TEXT.requestCount, state.totals.records))
  row(USAGE_TEXT.inputTokens, count(state.totals.tokens.input))
  row(USAGE_TEXT.outputTokens, count(state.totals.tokens.output))
  row(USAGE_TEXT.cachedTokens, count(state.totals.tokens.cached))
  row(USAGE_TEXT.cacheWriteTokens, count(state.totals.tokens.cacheWrite))
  row(USAGE_TEXT.reasoningTokens, count(state.totals.tokens.reasoning))
  row(USAGE_TEXT.totalCost, amount(charge(state.totals)))
  const change = usagePeriodDelta(charge(state.totals), charge(state.previousTotals))
  lines.push(
    escape(
      change === undefined
        ? USAGE_TEXT.noPreviousPeriod
        : fill(USAGE_TEXT.periodChange, { change: formatPercent(change) }),
    ),
  )
  row(
    USAGE_TEXT.cacheHit,
    state.totals.cacheHitPercent === undefined
      ? USAGE_TEXT.unknown
      : formatPercent(state.totals.cacheHitPercent),
  )
  row(
    USAGE_TEXT.totalTime,
    state.totals.durationMs === undefined
      ? USAGE_TEXT.unknown
      : formatUnit(state.totals.durationMs / MILLISECONDS_PER_SECOND, 'second'),
  )
  for (const [label, value] of [
    [USAGE_TEXT.latencyP50, state.totals.p50Ms],
    [USAGE_TEXT.latencyP95, state.totals.p95Ms],
  ] as const)
    row(
      label,
      value === undefined
        ? USAGE_TEXT.unknown
        : formatUnit(value / MILLISECONDS_PER_SECOND, 'second'),
    )
  row(USAGE_TEXT.retries, count(state.totals.retries))
  row(USAGE_TEXT.rateLimited, count(state.totals.rateLimited))
  heading(USAGE_TEXT.certainty)
  for (const cost of state.totals.costs) {
    row(
      certaintyLabel(cost.certainty),
      `${amount(cost.usd)} · ${plural(USAGE_TEXT.recordCount, cost.records)}`,
    )
    if (cost.apiEquivalentUsd !== undefined)
      row(USAGE_TEXT.apiEquivalent, amount(cost.apiEquivalentUsd))
    const note = certaintyNote(cost.certainty)
    if (note !== undefined) lines.push(escape(note))
  }
  const breakdownStart = lines.length
  heading(USAGE_TEXT.breakdown)
  for (const group of state.breakdown) {
    row(
      group.provider === undefined ? group.label : `${group.provider} / ${group.label}`,
      `${amount(charge(group.totals))} · ${count(group.totals.tokens.input)} / ${count(group.totals.tokens.output)} · ${plural(USAGE_TEXT.requestCount, group.totals.records)}`,
    )
  }
  const limitsStart = lines.length
  heading(USAGE_TEXT.limits)
  // Select each window independently: partial header/window reports need not
  // replace another window. Account/raw data belong to the latest source
  // snapshot. Keep the original state intact for the history charts.
  const latest = new Map<string, UsageLimitSnapshot>()
  const limitKey = (limit: UsageLimitSnapshot, window?: string): string =>
    JSON.stringify([limit.provider, limit.source, window])
  for (const limit of state.limits) {
    for (const window of [undefined, ...limit.windows.map((entry) => entry.id)]) {
      const key = limitKey(limit, window)
      const previous = latest.get(key)
      if (previous === undefined || limit.observedAt >= previous.observedAt) latest.set(key, limit)
    }
  }
  for (const limit of state.limits) {
    const isLatestSource = latest.get(limitKey(limit)) === limit
    const windows = limit.windows.filter(
      (window) => latest.get(limitKey(limit, window.id)) === limit,
    )
    if (!isLatestSource && windows.length === 0) continue
    row(limit.provider, fill(USAGE_TEXT.asOf, { date: formatDateTime(limit.observedAt) }))
    for (const window of windows) {
      const status = usageWindowStatus(window, limit.observedAt, state.generatedAt)
      const freshness = { fresh: '', stale: USAGE_TEXT.stale, awaiting: USAGE_TEXT.awaitingFresh }[
        status.freshness
      ]
      row(
        window.label ?? window.id,
        `${fill(USAGE_TEXT.usedPercent, { percent: formatPercent(window.usedPercent) })}${freshness === '' ? '' : ` · ${freshness}`}`,
      )
      if (window.resetsAt !== undefined && status.freshness !== 'awaiting')
        row(USAGE_TEXT.toDate, formatDateTime(window.resetsAt))
      if (status.pace === undefined) continue
      {
        const paceLabels = {
          ahead: USAGE_TEXT.paceAhead,
          under: USAGE_TEXT.paceUnder,
          even: USAGE_TEXT.paceEven,
        }
        row(USAGE_TEXT.pace, paceLabels[status.pace])
      }
    }
    if (isLatestSource && limit.account !== undefined) {
      row(
        USAGE_TEXT.accountBudget,
        `${amount(limit.account.usedUsd)} / ${amount(limit.account.limitUsd)}`,
      )
      lines.push(
        escape(fill(USAGE_TEXT.budgetRemaining, { remaining: amount(limit.account.remainingUsd) })),
      )
    }
    if (isLatestSource && limit.raw !== undefined)
      for (const [name, value] of Object.entries(limit.raw))
        row(`${USAGE_TEXT.asReported} (${name})`, value)
  }
  for (const provider of state.unreportedLimits) {
    lines.push(escape(fill(USAGE_TEXT.noLimitReported, { provider: provider.provider })))
    if (provider.consoleUrl !== undefined) row(USAGE_TEXT.providerConsole, provider.consoleUrl)
  }
  const budgetKeys = {
    paidDaily: 'paidDailyBudget',
    tabDaily: 'tabDailyBudget',
    vscodeChatDaily: 'vscodeChatDailyBudget',
    conversation: 'conversationBudget',
    headless: 'headlessBudget',
  } as const
  for (const budget of state.budgets) {
    row(
      USAGE_TEXT[budgetKeys[budget.kind]],
      fill(USAGE_TEXT.budgetSpent, { spent: amount(budget.spentUsd), cap: amount(budget.capUsd) }),
    )
    if (budget.stopped) lines.push(escape(USAGE_TEXT.budgetStopped))
    if (budget.raisedToday === true) lines.push(escape(USAGE_TEXT.budgetRaised))
    if (budget.uncertainUsd !== undefined)
      row(USAGE_TEXT.certaintyUncertain, amount(budget.uncertainUsd))
    if (budget.projectedUsd !== undefined)
      lines.push(escape(fill(USAGE_TEXT.budgetProjection, { amount: amount(budget.projectedUsd) })))
  }
  if (state.budgets.some((budget) => budget.kind === 'paidDaily'))
    lines.push(escape(USAGE_TEXT.paidBudgetNote))
  switch (section) {
    case 'daily': {
      lines.splice(introEnd)
      for (const bucket of state.buckets)
        row(
          formatDate(new Date(`${bucket.day}T12:00:00`).getTime()),
          `${amount(charge(bucket.totals))} · ${count(bucket.totals.tokens.input)} / ${count(bucket.totals.tokens.output)} · ${plural(USAGE_TEXT.requestCount, bucket.totals.records)}`,
        )
      break
    }
    case 'models': {
      lines.splice(limitsStart)
      lines.splice(introEnd, breakdownStart - introEnd)
      break
    }
    case 'limits': {
      lines.splice(introEnd, limitsStart - introEnd)
      break
    }
    case 'summary': {
      break
    }
  }
  return `${lines.join('\n')}\n`
}
