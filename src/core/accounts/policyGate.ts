// D88.6: policy decisions are independent of editor, transport and credentials.
import type { AccountTrigger } from '../../shared/accounts'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { AccountPolicy } from '../providers/accountPolicy'
import type { AccountConfirmations, AccountPolicyGrant } from './confirmations'

export type AccountPolicyDecision =
  | { readonly kind: 'allow'; readonly isCurrent: AccountPolicyGrant['isCurrent'] }
  | {
      readonly kind: 'stop'
      readonly reason: 'notOffered' | 'confirmation' | 'ownCapsOnly' | 'cancel'
    }
  | { readonly kind: 'recovery'; readonly recovery: 'chatgptPlan' | 'museCodeSubscription' }

/** The UI port displays these words plus the original sources, URL and page date. */
export function accountPolicyQuestion(row: AccountPolicy): {
  readonly warning: string
  readonly legitimate: string
  readonly choices: readonly {
    readonly id: 'confirm' | 'ownCapsOnly' | 'cancel'
    readonly label: string
  }[]
  readonly sources: AccountPolicy['sources']
  readonly checkedAt: string
} {
  return {
    warning: fill(UI_TEXT.accounts.confirmWarning, { provider: row.provider }),
    legitimate: UI_TEXT.accounts.legitimate,
    choices: [
      { id: 'confirm', label: UI_TEXT.accounts.confirm },
      { id: 'ownCapsOnly', label: UI_TEXT.accounts.ownCapsOnly },
      { id: 'cancel', label: UI_TEXT.accounts.cancel },
    ],
    sources: row.sources,
    checkedAt: row.checkedAt,
  }
}

export class AccountPolicyGate {
  public constructor(private readonly confirmations: AccountConfirmations) {}

  public async authorize(request: {
    readonly policy: () => AccountPolicy | undefined
    readonly trigger?: AccountTrigger | undefined
    readonly isInteractive: boolean
    /** The recovery UI returns here only after presenting the documented choices. */
    readonly hasOfferedRecovery?: boolean
  }): Promise<AccountPolicyDecision> {
    const row = request.policy()
    if (row === undefined || row.pooling === 'notOffered' || !row.isCredentialHeld)
      return { kind: 'stop', reason: 'notOffered' }
    const isVendorLimit = request.trigger?.kind === 'vendorLimit'
    if (isVendorLimit && row.recovery !== 'none' && request.hasOfferedRecovery !== true)
      return { kind: 'recovery', recovery: row.recovery }
    const requiresConfirmation =
      row.multipleAccounts === 'onePerPerson' || (isVendorLimit && row.pooling === 'confirm')
    if (!requiresConfirmation) {
      const stamp = JSON.stringify(row)
      return {
        kind: 'allow',
        isCurrent: (current) => current !== undefined && JSON.stringify(current) === stamp,
      }
    }
    const grant = await this.confirmations.obtain(row, request.isInteractive)
    if (!grant?.isCurrent(request.policy())) return { kind: 'stop', reason: 'confirmation' }
    if (grant.choice === 'cancel') return { kind: 'stop', reason: 'cancel' }
    // One-per-person needs a full confirmation even at a user cap.
    return grant.choice === 'ownCapsOnly' &&
      (isVendorLimit || row.multipleAccounts === 'onePerPerson')
      ? { kind: 'stop', reason: 'ownCapsOnly' }
      : { kind: 'allow', isCurrent: grant.isCurrent }
  }
}
