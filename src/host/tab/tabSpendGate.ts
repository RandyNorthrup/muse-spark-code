import { Usd, type UsdAmount } from '../../shared/usd'
// Tab's spend gate over lane L's ledger (M94, PLAN.md D73): the provider's
// `TabSpendGate`. `reserve` admits a request through the cross-window daily
// ledger by the one cap rule (lane LIMITSFIX, F3, D113; src/shared/spendCap.ts):
// while the real spend already settled today is below the budget. Nothing
// of the response is estimated or held; the reservation it returns is what
// `settle` closes with the real reported cost. The status bar reads today's
// total synchronously, so the gate keeps the last total the ledger answered
// and refreshes it after every change. Hitting the budget is never silent
// (A4): the first refusal of each local day calls `onBudgetReached`.

import { tabDayKey, tabSettleUsd } from '../../core/tab/tabSpend'
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
  /** Hitting the budget is never silent: called at most once per local day. */
  readonly onBudgetReached?: (spent: UsdAmount, budget: UsdAmount) => void
  readonly log: Logger
}

export function createTabSpendGate(deps: TabSpendGateDeps): TabSpendGate {
  let totalUsd = Usd.from(0).toAmount()
  let requestsDay = tabDayKey(deps.now())
  let requests = 0
  let notifiedDay: string | undefined

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
      const admission = await deps.ledger.admit(deps.budgetUsd())
      if (!admission.admitted) {
        if (admission.totalUsd !== undefined) {
          totalUsd = admission.totalUsd
        }
        deps.onTotalChanged()
        // Hitting the budget is never silent (A4): one notice per local
        // day, naming the spend, the budget and how to raise it.
        if (admission.reason === 'budgetReached') {
          const day = tabDayKey(deps.now())
          if (notifiedDay !== day) {
            notifiedDay = day
            deps.onBudgetReached?.(totalUsd, deps.budgetUsd())
          }
        }
        return undefined
      }
      totalUsd = admission.totalUsd
      countRequest()
      deps.onTotalChanged()
      return { model: facts.model, date: admission.reservation.date }
    },
    settle: (reservation: TabReservation, usage: TabReportedUsage): void => {
      const actualUsd = tabSettleUsd(usage, reservation.model)
      void deps.ledger
        .settle({ date: reservation.date }, actualUsd)
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
