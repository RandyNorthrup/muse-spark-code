import { Usd, type UsdAmount } from '../../shared/usd'
// Tab's spend gate over lane L's ledger (M94, PLAN.md D73): the provider's
// `TabSpendGate`. `reserve` prices the request's worst case (lane C's
// arithmetic: one token per UTF-8 byte at the input price plus the mode's
// output cap) and admits it through the cross-window daily ledger; the
// reservation it returns is what `settle` replaces with the reported cost.
// The status bar reads today's total synchronously, so the gate keeps the
// last total the ledger answered and refreshes it after every change.

import { failureForLog } from '../../core/backends/musecode/logText'
import { tabDayKey, tabSettleUsd } from '../../core/tab/tabSpend'
import { estimateCostUsd } from '../../core/usage/insights'
import type { Logger } from '../logger'
import type { TabLedger } from './tabLedger'
import type { TabReportedUsage, TabReservation, TabSpendFacts, TabSpendGate } from './tabContract'

export interface TabSpendGateDeps {
  readonly ledger: TabLedger
  /** `museSpark.tabDailyBudgetUsd`, read at each request; 0 is no budget. */
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
      const usage = {
        inputTokens: facts.inputBytes,
        outputTokens: facts.maxOutputTokens,
        cachedTokens: 0,
      }
      // A bring-your-own model prices at its provider's card (M95c part 7);
      // a card that prices nothing reserves nothing, so nothing is sent.
      const worstCaseUsd =
        facts.price === undefined ? estimateCostUsd(usage, facts.model) : facts.price.reserve(usage)
      if (worstCaseUsd === undefined) return undefined
      const admission = await deps.ledger.admit(worstCaseUsd, deps.budgetUsd())
      if (!admission.admitted) {
        if (admission.totalUsd !== undefined) {
          totalUsd = admission.totalUsd
        }
        deps.onTotalChanged()
        // Hitting the budget is never silent: one notice per local day,
        // naming the spend, the budget and how to raise it.
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
      return {
        model: facts.model,
        worstCaseUsd,
        date: admission.reservation.date,
        ...(facts.price !== undefined && { price: facts.price }),
      }
    },
    settle: (reservation: TabReservation, usage: TabReportedUsage): void => {
      // A bring-your-own request settles at the card it reserved with; a
      // card that cannot price the reported usage keeps the reservation.
      const actualUsd =
        reservation.price === undefined
          ? tabSettleUsd(usage, reservation.model)
          : (reservation.price.settle(usage) ?? reservation.worstCaseUsd)
      void deps.ledger
        .settle({ date: reservation.date, worstCaseUsd: reservation.worstCaseUsd }, actualUsd)
        .then(refreshTotal)
        .catch((error: unknown) => {
          deps.log.warn(`Tab ledger settlement failed: ${failureForLog(error)}`)
        })
    },
    todayTotalUsd: () => totalUsd,
    todayRequests: () => (tabDayKey(deps.now()) === requestsDay ? requests : 0),
  }
}
