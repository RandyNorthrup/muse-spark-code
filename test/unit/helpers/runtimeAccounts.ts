import { vi } from 'vitest'
import type { Account, AccountEvent } from '../../../src/shared/accounts'
import type { AccountsReply } from '../../../src/shared/hostApi/accounts'
import type { AccountsSessionPort } from '../../../src/acp/accounts'
import {
  type AccountProvider,
  type AccountsMetadataPort,
} from '../../../src/core/providers/accounts'
import { runtimeAccountStore } from '../../../src/runtime/providers/accountStore'

export function commandAccountsRig() {
  let provider: AccountProvider = {
    id: 'meta',
    policyProvider: 'meta',
    product: 'model-api',
    auth: 'apiKey',
    origin: 'https://api.meta.ai',
  }
  const values = new Map<string, string>()
  const metadata: AccountsMetadataPort = {
    read: (id) => Promise.resolve(id === provider.id ? provider : undefined),
    writeAccounts: (_id, accounts) => {
      provider = { ...provider, accounts }
      return Promise.resolve()
    },
  }
  const revoke = vi.fn(() => Promise.resolve())
  const runtime = runtimeAccountStore({
    metadata,
    openEntry: (_service, name) => ({
      getPassword: () => Promise.resolve(values.get(name)),
      setPassword: (value) => {
        values.set(name, value)
        return Promise.resolve()
      },
      deletePassword: () => Promise.resolve(values.delete(name)),
    }),
    revokeSignIn: revoke,
  })
  const print = vi.fn<(text: string) => void>()
  const printError = vi.fn<(text: string) => void>()
  return {
    ...runtime,
    values,
    metadata,
    print,
    printError,
    revoke,
    configure: (patch: Partial<AccountProvider>) => {
      provider = { ...provider, ...patch }
    },
    deps: { accounts: runtime.accounts, metadata, print, printError },
  }
}

export function sessionAccountsRig() {
  const rows: Account[] = [
    { id: 'default', label: 'Default', order: 0, thresholds: { spendUsd: { day: 1 } } },
    { id: 'work', label: 'Work', order: 1, thresholds: { requests: { day: 2 } } },
  ]
  let current = 'default'
  const listeners = new Set<(event: AccountEvent) => void>()
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
    emit: (event: AccountEvent) => {
      if (event.type === 'swap') current = event.account
      for (const listener of listeners) listener(event)
    },
  }
}

export function accountSwap(): AccountEvent {
  return {
    type: 'swap',
    provider: 'meta',
    account: 'work',
    previousAccount: 'default',
    time: '2026-10-06T12:00:00Z',
    coldCacheUsd: 0.1,
    trigger: {
      kind: 'userCap',
      metric: 'spendUsd',
      period: 'day',
      value: 1,
      threshold: 1,
      resetAt: '2026-10-07T00:00:00Z',
    },
  }
}

// A forged runtime service must never reach output through the public schema.
export function forgedState() {
  return { ...sessionAccountsRig().state(), secret: 'account-secret-canary' }
}
