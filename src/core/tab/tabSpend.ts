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
The reservation: input at one token per UTF-8 byte at the input price
(M82's estimate, which errs high), plus `max_output_tokens` at the output
price, through the same estimate reported usage settles at.
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

// M94 portable Tab ports shared by VS Code and the runtime (M104L).
import type { TabEngineUsage } from './tabEngine'

/** A request the completion engine (lane C) may bill: facts only, no prices. */
export interface TabSpendFacts {
  /** The request's model, for the tier's rates. */
  readonly model: string
  /** The redacted window's UTF-8 bytes. */
  readonly inputBytes: number
  /** The mode's output cap, reasoning included. */
  readonly maxOutputTokens: number
}

/** Usage a finished request reported (the engine reads the stream's usage). */
export type TabReportedUsage = TabEngineUsage

/**
One admitted request's reservation, settled with its own worst case into
its own local day's ledger file, also after midnight (RVM94LC finding 1).
*/
export interface TabReservation {
  readonly model: string
  readonly worstCaseUsd: UsdAmount
  /** The admission's local day (`YYYY-MM-DD`), as the ledger named it. */
  readonly date: string
}

/**
Lane L's spend side (src/host/tab/tabLedger.ts through tabSpendGate.ts,
M94): the hard daily budget across windows. `reserve` writes this
request's worst case first and returns its reservation only when it fits
(undefined: at the budget, or a missing, corrupt or unreadable ledger);
`settle` replaces that reservation with the reported usage (zero for a
request never sent; a request that never reports keeps it);
`todayTotalUsd` is what the status bar shows.
*/
export interface TabSpendGate {
  reserve(facts: TabSpendFacts): Promise<TabReservation | undefined>
  settle(reservation: TabReservation, usage: TabReportedUsage): void
  todayTotalUsd(): UsdAmount
  todayRequests(): number
}
