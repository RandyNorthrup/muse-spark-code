/**
The OpenRouter key-usage report (PROVSPEND): the existing key read as the
first shared-shape spend report. This module stays small on purpose: the
Models panel imports only this (never the admin/balance parsers), so its
bundle does not carry them. No model call, no network request here.
*/
import { Usd } from '../../shared/usd'
import type { ProviderSpendReport } from './providerSpend'

/** Why a spend report is shown as a fixed sentence instead of figures. */
export type SpendFailureKind =
  'wrong-key-kind' | 'plan-unavailable' | 'refused' | 'unreadable' | 'unreachable'

export interface SpendFailure {
  readonly kind: SpendFailureKind
}

/** An unreadable provider body is a failure, never a zero. */
export function unreadable(): SpendFailure {
  return { kind: 'unreadable' }
}

/** True for a failure value; no report or page result carries `kind`. */
export function isSpendFailure(value: unknown): value is SpendFailure {
  return typeof value === 'object' && value !== null && 'kind' in value
}

/** The validated key-usage numbers, and nothing else, that a report converts. */
export interface KeyUsageNumbers {
  readonly usedToday: number
  readonly usedThisWeek: number
  readonly usedThisMonth: number
  readonly limit?: number | undefined
  readonly remaining?: number | undefined
}

function isKeyUsageNumbers(snapshot: KeyUsageNumbers): boolean {
  return (
    Number.isFinite(snapshot.usedToday) &&
    snapshot.usedToday >= 0 &&
    Number.isFinite(snapshot.usedThisWeek) &&
    snapshot.usedThisWeek >= 0 &&
    Number.isFinite(snapshot.usedThisMonth) &&
    snapshot.usedThisMonth >= 0 &&
    (snapshot.limit === undefined || (Number.isFinite(snapshot.limit) && snapshot.limit >= 0)) &&
    (snapshot.remaining === undefined ||
      (Number.isFinite(snapshot.remaining) && snapshot.remaining >= 0))
  )
}

/**
The existing OpenRouter read as the first shared-shape report: the
validated key-usage snapshot becomes exact dollars. A non-finite or
negative amount is unreadable, never a zero.
*/
export function openRouterSpendReport(
  snapshot: KeyUsageNumbers,
  asOf: string,
): SpendFailure | ProviderSpendReport {
  if (!isKeyUsageNumbers(snapshot)) return unreadable()
  const today = snapshotDollars(snapshot.usedToday)
  const week = snapshotDollars(snapshot.usedThisWeek)
  const month = snapshotDollars(snapshot.usedThisMonth)
  const limit = snapshot.limit === undefined ? undefined : snapshotDollars(snapshot.limit)
  const remaining =
    snapshot.remaining === undefined ? undefined : snapshotDollars(snapshot.remaining)
  return {
    capability: 'key-usage',
    provider: 'openrouter',
    asOf,
    usedTodayUsd: today,
    usedThisWeekUsd: week,
    usedThisMonthUsd: month,
    ...(limit !== undefined && { limitUsd: limit }),
    ...(remaining !== undefined && { remainingUsd: remaining }),
  }
}

function snapshotDollars(value: number): string {
  // isKeyUsageNumbers admitted only finite amounts at or above zero, and
  // String() of such a number always matches Usd.from's decimal shape
  // (plain, dotted or e-notation within double range), so this cannot throw.
  return Usd.from(value).toString()
}
