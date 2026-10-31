import type { AccountConfirmations } from '../../../src/core/accounts/confirmations'
import { AccountPolicyGate } from '../../../src/core/accounts/policyGate'
import type { AccountPoolDeps } from '../../../src/core/accounts/pool'
import { accountPolicyFor } from '../../../src/core/providers/accountPolicy'
import type { AccountRequestJournal } from '../../../src/runtime/providers/accountRequestJournal'

/** The wiring every pool drill shares: selection, policy, limits and the gate over one real journal. */
export function accountPoolBase(input: {
  readonly provider: string
  readonly journal: AccountRequestJournal
  readonly rows: ReturnType<AccountPoolDeps['accounts']>
  readonly confirmations: AccountConfirmations
  readonly now: () => number
}): Pick<
  AccountPoolDeps,
  | 'provider'
  | 'readSelection'
  | 'writeSelection'
  | 'accounts'
  | 'policy'
  | 'journal'
  | 'limits'
  | 'gate'
  | 'now'
  | 'usageUrl'
> {
  const { provider, journal, rows } = input
  return {
    provider,
    readSelection: (owner) => journal.selection(provider, owner),
    writeSelection: (owner, selected) => {
      journal.select(provider, owner, selected)
    },
    accounts: () => rows,
    policy: () => accountPolicyFor(provider, 'model-api'),
    journal,
    limits: () => ({
      read: (limitProvider, id) =>
        journal.limits(
          limitProvider,
          id,
          rows.find((row) => row.id === id),
        ),
    }),
    gate: new AccountPolicyGate(input.confirmations),
    now: input.now,
    usageUrl: 'https://example.test/usage',
  }
}
