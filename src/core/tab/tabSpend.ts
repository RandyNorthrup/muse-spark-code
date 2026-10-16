import type { UsdAmount } from '../../shared/usd'
// Tab's spend arithmetic (M94, PLAN.md D73; lane LIMITSFIX F3, D113): the
// settlement that closes a request when its usage reports, and the local day
// the ledger totals by. Admission is the one cap rule (src/shared/spendCap.ts)
// in the ledger: real spend settled today below the budget. Nothing is
// estimated. Pure: no `vscode` import. The day is the local calendar day
// (calendar fields, so a DST transition never moves or doubles it); the
// ledger (lane L) owns the files.

import { estimateCostUsd, type BillableUsage } from '../usage/insights'

/** The real cost of reported usage: what a finished request settles into the ledger. */
export function tabSettleUsd(usage: BillableUsage, model: string): UsdAmount {
  return estimateCostUsd(usage, model)
}

/** The local calendar day as `YYYY-MM-DD`: the ledger's total key. */
export function tabDayKey(atMs: number): string {
  const at = new Date(atMs)
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${String(at.getFullYear())}-${month}-${day}`
}
