// Sender-local metadata, never a vendor or device frame. Both pool owners use
// this rule so a global limit or a recorded group cannot add account capacity.
import * as z from 'zod/mini'
import { accountIdSchema, type Account } from '../../shared/accounts'
import type { AccountPolicy } from '../providers/accountPolicy'

export const accountLimitBlockSchema = z
  .strictObject({
    account: accountIdSchema,
    limitGroup: z.optional(accountIdSchema),
    scope: z.enum(['account', 'group', 'global']),
    // One record cannot discard an earlier, still-live group to hold a second.
    isOverlapping: z.optional(z.boolean()),
    expiresAt: z.int().check(z.positive()),
  })
  .check(z.refine((block) => block.scope !== 'group' || block.limitGroup !== undefined))
export type AccountLimitBlock = z.infer<typeof accountLimitBlockSchema>
type LimitIdentity = Omit<AccountLimitBlock, 'expiresAt'>

export function accountLimitIdentity(
  account: Pick<Account, 'id' | 'limitGroup'>,
  policy: AccountPolicy | undefined,
): LimitIdentity {
  const scope = account.limitGroup === undefined ? 'account' : 'group'
  return {
    account: account.id,
    ...(account.limitGroup !== undefined && { limitGroup: account.limitGroup }),
    scope: policy?.limitScopes.includes('global') === true ? 'global' : scope,
  }
}

/** Expiry belongs to the caller's live limit source; this rule owns scope. */
export function isAccountLimitEligible(
  account: Pick<Account, 'id' | 'limitGroup'>,
  block: LimitIdentity | undefined,
): boolean {
  return (
    block === undefined ||
    (block.isOverlapping !== true &&
      block.scope !== 'global' &&
      account.id !== block.account &&
      (block.scope !== 'group' || account.limitGroup !== block.limitGroup))
  )
}
