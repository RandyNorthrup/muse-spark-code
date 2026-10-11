import { vi } from 'vitest'
import {
  AccountConfirmations,
  type AccountConfirmationStore,
} from '../../../../src/core/accounts/confirmations'
import { AccountPolicyGate } from '../../../../src/core/accounts/policyGate'
import { accountPolicyFor } from '../../../../src/core/providers/accountPolicy'

const key = (providerId: string, productId: string) => `${providerId}/${productId}`

export function policyRig(provider = 'meta', product = 'model-api') {
  let row = accountPolicyFor(provider, product)!
  const data = new Map<string, unknown>()
  const store: AccountConfirmationStore = {
    read: vi.fn((providerId: string, productId: string) =>
      Promise.resolve(data.get(key(providerId, productId))),
    ),
    write: vi.fn<AccountConfirmationStore['write']>((providerId, productId, value) => {
      data.set(key(providerId, productId), value)
      return Promise.resolve()
    }),
    remove: vi.fn((providerId: string, productId: string) => {
      data.delete(key(providerId, productId))
      return Promise.resolve()
    }),
  }
  const ask = vi.fn((): Promise<unknown> => Promise.resolve('confirm'))
  const deps = { machineId: 'machine-a', store, now: () => Date.parse('2026-10-06T12:00:00Z'), ask }
  const confirmations = new AccountConfirmations(deps)
  return {
    deps,
    data,
    ask,
    store,
    confirmations,
    gate: new AccountPolicyGate(confirmations),
    policy: () => row,
    change: (patch: Partial<typeof row>) => {
      row = { ...row, ...patch }
    },
  }
}
