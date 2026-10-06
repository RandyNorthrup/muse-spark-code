// Shared account summary for M102's page and terminal/ACP text ports.
import type { AccountEvent } from '../../shared/accounts'
import { UI_TEXT } from '../../shared/constants'
import { fill, formatDateTime, formatNumber, plural, uiLocale } from '../../shared/l10n/text'
import { formatUsd, parseUsd } from '../../shared/usd'
import type { AccountUsageMeter, AccountUsageReport, AccountUsageRow } from './accountUsage'

function periodLabel(period: AccountUsageReport['period']): string {
  return { day: UI_TEXT.usageDay, week: UI_TEXT.usageWeek, month: UI_TEXT.accounts.month }[period]
}

function metricLabel(metric: AccountUsageMeter['metric']): string {
  switch (metric) {
    case 'spendUsd': {
      return UI_TEXT.accounts.spend
    }
    case 'inputTokens': {
      return UI_TEXT.accounts.inputTokens
    }
    case 'outputTokens': {
      return UI_TEXT.accounts.outputTokens
    }
    case 'requests': {
      return UI_TEXT.accounts.requests
    }
    case 'planWindow': {
      return UI_TEXT.accounts.planWindow
    }
    case 'rateHeadroom': {
      return UI_TEXT.accounts.rateHeadroom
    }
  }
}

function percent(value: string): string {
  return new Intl.NumberFormat(uiLocale(), {
    style: 'percent',
    maximumFractionDigits: (value.split('.', 2)[1] ?? '').length,
  }).format(Number(value) / 100)
}

function meterValue(meter: AccountUsageMeter, value: string): string {
  if (meter.unit === 'usd') return formatUsd(parseUsd(value))
  return meter.unit === 'percent' ? percent(value) : formatNumber(Number(value))
}

export function accountUsageMeterText(meter: AccountUsageMeter): {
  readonly label: string
  readonly value: string
  readonly detail: string
} {
  let scope = meter.window ?? ''
  if (meter.period !== undefined) scope = periodLabel(meter.period)
  else if (meter.window === 'requests') scope = UI_TEXT.accounts.requests
  else if (meter.window === 'tokens') scope = UI_TEXT.accounts.usageRateTokens
  const label = `${metricLabel(meter.metric)} (${scope})`
  const value =
    meter.value === null
      ? UI_TEXT.accounts.usageUnavailable
      : `${meterValue(meter, meter.value)} / ${meterValue(meter, meter.threshold)}`
  const reset =
    meter.resetAt === null
      ? UI_TEXT.accounts.usageResetUnknown
      : fill(UI_TEXT.accounts.usageReset, { reset: formatDateTime(Date.parse(meter.resetAt)) })
  return {
    label,
    value,
    detail: [meter.isReached === true ? UI_TEXT.accounts.usageReached : undefined, reset]
      .filter((entry) => entry !== undefined)
      .join(' · '),
  }
}

export function accountUsageRowText(row: AccountUsageRow): readonly string[] {
  return [
    fill(UI_TEXT.accounts.summary, {
      provider: row.providerLabel,
      account: row.label,
      requests: plural(UI_TEXT.accounts.requestCount, row.totals.requests),
      cost: formatUsd(parseUsd(row.totals.settledUsd)),
    }),
    fill(UI_TEXT.accounts.usageLiability, {
      reserved: formatUsd(parseUsd(row.totals.reservedUsd)),
      uncertain: formatUsd(parseUsd(row.totals.uncertainUsd)),
    }),
    `${UI_TEXT.accounts.inputTokens}: ${formatNumber(row.totals.inputTokens)}`,
    `${UI_TEXT.accounts.outputTokens}: ${formatNumber(row.totals.outputTokens)}`,
  ]
}

function identity(report: AccountUsageReport, provider: string, account: string) {
  const row = report.accounts.find(
    (entry) => entry.provider === provider && entry.account === account,
  )
  return { provider: row?.providerLabel ?? provider, account: row?.label ?? account }
}

export function accountUsageEventText(event: AccountEvent, report: AccountUsageReport): string {
  const target = identity(report, event.provider, event.account)
  if (event.type === 'spread')
    return fill(UI_TEXT.accounts.usageSpread, { ...target, worker: event.workerId })
  const trigger = event.trigger
  const threshold =
    trigger.kind === 'vendorLimit'
      ? `${UI_TEXT.accounts.vendorLimit} (${trigger.reason})`
      : fill(UI_TEXT.accounts.usageThreshold, {
          metric: metricLabel(trigger.metric),
          period: periodLabel(trigger.period),
          threshold:
            trigger.metric === 'spendUsd'
              ? formatUsd(parseUsd(trigger.threshold, 'floor'))
              : formatNumber(trigger.threshold),
        })
  if (event.type === 'swap')
    return [
      fill(UI_TEXT.accounts.swapNotice, {
        ...target,
        previous: identity(report, event.provider, event.previousAccount).account,
        threshold,
      }),
      fill(UI_TEXT.accounts.coldCache, { cost: formatUsd(parseUsd(event.coldCacheUsd)) }),
    ].join(' ')
  return [
    fill(UI_TEXT.accounts.usageStop, { ...target, threshold }),
    trigger.resetAt === null
      ? UI_TEXT.accounts.usageResetUnknown
      : fill(UI_TEXT.accounts.usageReset, { reset: formatDateTime(Date.parse(trigger.resetAt)) }),
  ].join(' ')
}

/** Exactly the same facts and event explanations as the shared React section. */
export function accountUsageText(report: AccountUsageReport): string {
  return [
    UI_TEXT.accounts.title,
    ...report.accounts.flatMap((row) => [
      ...accountUsageRowText(row),
      ...row.meters.map((meter) => {
        const text = accountUsageMeterText(meter)
        return `${text.label}: ${text.value} · ${text.detail}`
      }),
    ]),
    ...(report.events.length === 0 ? [] : [UI_TEXT.accounts.usageEvents]),
    ...report.events.map(
      (event) =>
        `${formatDateTime(Date.parse(event.time))}: ${accountUsageEventText(event, report)}`,
    ),
  ].join('\n')
}
