import { Usd, type UsdAmount } from '../../shared/usd'
// Tab's spend gate over lane L's ledger (M94, PLAN.md D73): the provider's
// `TabSpendGate`. `reserve` prices the request's worst case (lane C's
// arithmetic: one token per UTF-8 byte at the input price plus the mode's
// output cap) and admits it through the cross-window daily ledger; the
// reservation it returns is what `settle` replaces with the reported cost.
// The status bar reads today's total synchronously, so the gate keeps the
// last total the ledger answered and refreshes it after every change.

import { tabDayKey, tabSettleUsd } from '../../core/tab/tabSpend'
import { estimateCostUsd } from '../../core/usage/insights'
import type { Logger } from '../logger'
import type { TabLedger } from './tabLedger'
import type { TabReportedUsage, TabReservation, TabSpendFacts, TabSpendGate } from './tabBundle'

export interface TabSpendGateDeps {
  readonly ledger: TabLedger
  /** `museSpark.tabDailyBudgetUsd`, read at each request. */
  readonly budgetUsd: () => UsdAmount
  readonly now: () => number
  /** The status bar redraws after the total moves. */
  readonly onTotalChanged: () => void
  readonly log: Logger
}

export function createTabSpendGate(deps: TabSpendGateDeps): TabSpendGate {
  let totalUsd = Usd.from(0).toAmount()
  let requestsDay = tabDayKey(deps.now())
  let requests = 0

  const refreshTotal = async (): Promise<void> => {
    const total = await deps.ledger.todayTotal()
    if (!total.ok || total.totalUsd === totalUsd) {
      return
    }
    totalUsd = total.totalUsd
    deps.onTotalChanged()
  }
  const countRequest = (): void => {
    const day = tabDayKey(deps.now())
    if (day !== requestsDay) {
      requestsDay = day
      requests = 0
    }
    requests += 1
  }
  void refreshTotal()

  return {
    reserve: async (facts: TabSpendFacts): Promise<TabReservation | undefined> => {
      const worstCaseUsd = estimateCostUsd(
        { inputTokens: facts.inputBytes, outputTokens: facts.maxOutputTokens, cachedTokens: 0 },
        facts.model,
      )
      const admission = await deps.ledger.admit(worstCaseUsd, deps.budgetUsd())
      if (!admission.admitted) {
        if (admission.totalUsd !== undefined) {
          totalUsd = admission.totalUsd
        }
        deps.onTotalChanged()
        return undefined
      }
      totalUsd = admission.totalUsd
      countRequest()
      deps.onTotalChanged()
      return { model: facts.model, worstCaseUsd, date: admission.reservation.date }
    },
    settle: (reservation: TabReservation, usage: TabReportedUsage): void => {
      const actualUsd = tabSettleUsd(usage, reservation.model)
      void deps.ledger
        .settle({ date: reservation.date, worstCaseUsd: reservation.worstCaseUsd }, actualUsd)
        .then(refreshTotal)
        .catch((error: unknown) => {
          deps.log.warn(
            `Tab ledger settlement failed: ${error instanceof Error ? error.name : 'unknown'}`,
          )
        })
    },
    todayTotalUsd: () => totalUsd,
    todayRequests: () => (tabDayKey(deps.now()) === requestsDay ? requests : 0),
  }
}
