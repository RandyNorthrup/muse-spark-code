// Budgets and audit per person (M110h lane M, D90.16): each person's
// spend settles onto their own ledger, admitted under the budget the
// owner set for them (no budget, no refusal), and every money movement
// lands in the audit log beside who moved it. Amounts are whole cents.
// The ledgers' store (lane N) is the leg that waits; these records are
// what it will keep.
import * as z from 'zod/mini'

export const teamSpendSchema = z.strictObject({
  person: z.string().check(z.minLength(1)),
  amountCents: z.int().check(z.gte(0)),
  at: z.int().check(z.gte(0)),
  for: z.string().check(z.minLength(1)),
})
export type TeamSpend = z.infer<typeof teamSpendSchema>

export type TeamSpendVerdict =
  | { readonly admitted: true; readonly ledger: readonly TeamSpend[] }
  | { readonly admitted: false; readonly reason: string }

/* Admit the spend under the person's budget, or refuse naming what is left. */
export function admitTeamSpend(
  ledger: readonly TeamSpend[],
  spend: TeamSpend,
  budgetCents: number | undefined,
): TeamSpendVerdict {
  if (budgetCents !== undefined && (!Number.isSafeInteger(budgetCents) || budgetCents < 0))
    throw new Error('a budget is whole cents')
  const parsed = teamSpendSchema.parse(spend)
  if (budgetCents === undefined) return { admitted: true, ledger: [...ledger, parsed] }
  const spent = ledger
    .filter((entry) => entry.person === parsed.person)
    .reduce((sum, entry) => sum + entry.amountCents, 0)
  if (spent + parsed.amountCents > budgetCents) {
    return {
      admitted: false,
      reason: `${parsed.person} has ${String(budgetCents - spent)} of ${String(budgetCents)} cents left`,
    }
  }
  return { admitted: true, ledger: [...ledger, parsed] }
}

export function teamSpentFor(ledger: readonly TeamSpend[], person: string): number {
  return ledger
    .filter((entry) => entry.person === person)
    .reduce((sum, entry) => sum + entry.amountCents, 0)
}

export const teamAuditSchema = z.strictObject({
  at: z.int().check(z.gte(0)),
  person: z.string().check(z.minLength(1)),
  action: z.string().check(z.minLength(1)),
  detail: z.string(),
})
export type TeamAuditEntry = z.infer<typeof teamAuditSchema>

/** Append one audit entry; the log only grows. */
export function appendTeamAudit(
  log: readonly TeamAuditEntry[],
  entry: TeamAuditEntry,
): readonly TeamAuditEntry[] {
  return [...log, teamAuditSchema.parse(entry)]
}
