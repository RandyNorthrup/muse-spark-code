// The pre-D208 spend journal both spend migrations read (removed by the
// spend-simple lane): settled charges lived in
// `budget-journal/<account>/<scope>/seed.json` plus
// `claims/<claimId>/claim.json` beside the spend files. The writer named
// each claim directory for its claim id and stamped every row with the
// journal's identity (scope, session, account), so a migration can tell a
// damaged or misplaced row from a charge before it sums anything.
import * as z from 'zod/mini'
import { Usd, legacyUsdSchema, type UsdAmount } from '../../shared/usd'

const legacyVersionSchema = z.union([z.literal(1), z.literal(2)])
export const legacySeedSchema = z.object({
  version: legacyVersionSchema,
  scopeId: z.string(),
  sessionId: z.string(),
  accountId: z.string(),
  spentUsd: legacyUsdSchema,
})
export const legacyClaimSchema = z.object({
  version: legacyVersionSchema,
  scopeId: z.string(),
  sessionId: z.string(),
  accountId: z.string(),
  claimId: z.string(),
  reservedUsd: legacyUsdSchema,
  settledUsd: z.optional(legacyUsdSchema),
  retainedUsd: z.optional(legacyUsdSchema),
})
export type LegacySeed = z.infer<typeof legacySeedSchema>
export type LegacyClaim = z.infer<typeof legacyClaimSchema>

/** Where a legacy claim row must belong: the writer's own coordinates. */
export interface LegacyClaimIdentity {
  /** The claim directory's name, which the writer set to the claim id. */
  readonly name: string
  readonly scopeId: string
  readonly sessionId: string
  readonly accountId: string
}

/**
Why a legacy claim row cannot be summed, or `undefined` when its
identity matches its journal entry. A damaged or misplaced row is
never spend: the migration keeps the stored total instead of adding
the row and stamping the result migrated.
*/
export function legacyClaimIdentityError(
  claim: LegacyClaim,
  expected: LegacyClaimIdentity,
): string | undefined {
  if (claim.claimId !== expected.name) return 'claim id does not match its directory'
  if (claim.scopeId !== expected.scopeId) return 'claim scope does not match its seed'
  if (claim.sessionId !== expected.sessionId) return 'claim session does not match its journal'
  return claim.accountId === expected.accountId
    ? undefined
    : 'claim account does not match its journal'
}

/**
What a legacy claim contributes to a migrated total (D208: a
reservation is never spend). A settled charge counts; an unsettled
claim whose retained liability was written down counts that liability
instead — fees its run incurred past the reservation, known before
final token settlement — so a resumed capped session cannot spend it
again. A bare reservation, held but never spent, stays out.
*/
export function legacyClaimSpendUsd(claim: LegacyClaim): UsdAmount | undefined {
  const amount = claim.settledUsd ?? claim.retainedUsd
  return amount === undefined ? undefined : Usd.from(amount).toAmount()
}
