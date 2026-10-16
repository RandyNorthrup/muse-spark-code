// THE admission rule for a spending cap the person set (lane LIMITSFIX, F3,
// PLAN.md D113), shared by every consumer: the conversation and its
// sub-agents, compaction, the hook and review helper requests, hosted
// search, the shared daily extras and Tab.
//
//   - Admission: a request is sent while the REAL spend already settled is
//     below the cap. At or over the cap the next request stops, in words
//     naming the spend, the cap and how to raise it. No input estimate and no
//     output worst case is ever compared with a cap.
//   - Settlement: each response's real cost lands in the ledger when its usage
//     arrives.
//   - A response lost before its usage is recorded as UNKNOWN, never as a
//     guessed amount.
//
// The honest overshoot bound: the spend can pass the cap by at most the
// responses in flight when their requests were admitted: one for the
// conversation itself, up to SUBAGENT_CAPACITY more for running sub-agents
// (they share the owner's ledger and cap), and one per helper request.
// What a cap can never do is refuse work while the real spend is below it.

import { Usd, type UsdAmount } from './usd'

export function isBelowCap(capUsd: UsdAmount, settledSpentUsd: UsdAmount): boolean {
  return Usd.from(settledSpentUsd).compare(Usd.from(capUsd)) < 0
}
