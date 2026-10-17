import { Usd, type UsdAmount } from '../../shared/usd'
// Tab's spend arithmetic (M94, PLAN.md D73): the worst case reserved before
// every request, the settlement replacing it when usage reports, the budget
// check, and the local day the ledger totals by. Pure: no `vscode` import.
// The day is the local calendar day (calendar fields, so a DST transition
// never moves or doubles it); the ledger (lane L) owns the files.

import { estimateCostUsd, type BillableUsage } from '../usage/insights'

export interface TabWorstCase {
  readonly model: string
  /** The prompt text actually sent: instructions plus the user message. */
  readonly inputText: string
  readonly maxOutputTokens: number
}

/**
 * The reservation: input at one token per UTF-8 byte at the input price
 * (M82's estimate, which errs high), plus `max_output_tokens` at the output
 * price, through the same estimate reported usage settles at.
 */
export function tabWorstCaseUsd(request: TabWorstCase): UsdAmount {
  const inputTokens = new TextEncoder().encode(request.inputText).length
  return estimateCostUsd(
    { inputTokens, outputTokens: request.maxOutputTokens, cachedTokens: 0 },
    request.model,
  )
}

/** Reported usage replaces the reservation (a request that reports none keeps it). */
export function tabSettleUsd(usage: BillableUsage, model: string): UsdAmount {
  return estimateCostUsd(usage, model)
}

export interface TabBudgetCheck {
  readonly spentTodayUsd: UsdAmount
  readonly worstCaseUsd: UsdAmount
  readonly budgetUsd: UsdAmount
}

/** The request is sent only when today's total plus its worst case fits. */
export function isWithinTabBudget(check: TabBudgetCheck): boolean {
  return (
    Usd.from(check.spentTodayUsd)
      .add(Usd.from(check.worstCaseUsd))
      .compare(Usd.from(check.budgetUsd)) <= 0
  )
}

/** The local calendar day as `YYYY-MM-DD`: the ledger's total key. */
export function tabDayKey(atMs: number): string {
  const at = new Date(atMs)
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${String(at.getFullYear())}-${month}-${day}`
}
