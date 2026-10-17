import { vi } from 'vitest'
import { usdInputSchema } from '../../../src/shared/usdSchema'
import type { Account, AccountEvent } from '../../../src/shared/accounts'
import type { AccountsReply } from '../../../src/shared/hostApi/accounts'
import type { AccountsSessionPort } from '../../../src/acp/accounts'

export function sessionAccountsRig() {
  const rows: Account[] = [
    {
      id: 'default',
      label: 'Default',
      order: 0,
      thresholds: { spendUsd: { day: usdInputSchema.parse('1') } },
    },
    { id: 'work', label: 'Work', order: 1, thresholds: { requests: { day: 2 } } },
  ]
  let current = 'default'
  const listeners = new Set<Parameters<AccountsSessionPort['subscribe']>[1]>()
  const state = (): Extract<AccountsReply, { type: 'accounts/state' }> => ({
    type: 'accounts/state',
    provider: 'meta',
    accounts: rows,
    currentAccount: current,
    isSwapOn: true,
    isParallelOn: true,
  })
  const port: AccountsSessionPort = {
    usageUrl: () => 'https://example.test/usage',
    read: vi.fn(() => Promise.resolve(state())),
    use: vi.fn<AccountsSessionPort['use']>((_session, account, canCommit) => {
      if (!canCommit()) return Promise.reject(new Error('stale'))
      current = account
      return Promise.resolve(state())
    }),
    subscribe: vi.fn<AccountsSessionPort['subscribe']>((_session, listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }),
  }
  return {
    rows,
    state,
    port,
    listeners,
    changed: () => {
      for (const listener of listeners) listener(state())
    },
    emit: (event: AccountEvent) => {
      if (event.type === 'swap') current = event.account
      for (const listener of listeners) listener(event)
    },
  }
}
