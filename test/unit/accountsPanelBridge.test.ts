// M104 binds U's Models & Agents dispatcher to the companion's validated
// panel skin. This suite drives the real AccountsPanelHandler (over a real
// AccountStore and real AccountConfirmations, with in-memory metadata, vault
// and grant stores at the documented seams) through the real binding factory
// and the real skin: snapshots map to `accounts/state`, fixed dispatcher
// errors pass through, and forged, secret-bearing or malformed traffic is
// refused without leaking adapter text.
import { describe, expect, it, vi } from 'vitest'
import { AccountStore, type AccountProvider } from '../../src/core/providers/accounts'
import { AccountConfirmations } from '../../src/core/accounts/confirmations'
import {
  AccountsPanelHandler,
  type AccountsPanelHostPort,
} from '../../src/host/models/accountsHandler'
import { bindAccountsPanelPort, type AccountsPanelPort } from '../../src/acp/accounts'
import type { AccountsReply, AccountsRequest } from '../../src/shared/hostApi/accounts'
import { UI_TEXT } from '../../src/shared/constants'

/** A refused providers file from another bundle: brand travels, constructor does not. */
class ForeignStoreError extends Error {
  public override readonly name = 'AccountStoreError'
  public readonly code = 'invalidProvidersFile'

  public constructor() {
    super('invalidProvidersFile')
  }
}

function harness() {
  let entry: AccountProvider = {
    id: 'openai',
    policyProvider: 'openai',
    product: 'api',
    auth: 'apiKey',
    origin: 'https://provider.invalid',
    accounts: [
      { id: 'personal', label: 'Personal', order: 0, thresholds: {} },
      { id: 'work', label: 'Work', order: 1, thresholds: {} },
    ],
  }
  let current: string | null = 'work'
  const metadata = {
    read: vi.fn((id: string) => Promise.resolve(id === entry.id ? entry : undefined)),
    writeAccounts: vi.fn((_provider: string, accounts: typeof entry.accounts) => {
      entry = { ...entry, accounts }
      return Promise.resolve()
    }),
  }
  const vault = {
    read: vi.fn(() => Promise.resolve(undefined)),
    readForRemoval: vi.fn(() => Promise.resolve(undefined)),
    write: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
  }
  const grants = new Map<string, unknown>()
  const confirmations = new AccountConfirmations({
    machineId: 'local',
    store: {
      read: (key: string) => Promise.resolve(grants.get(key)),
      write: (key: string, value: unknown) => {
        grants.set(key, value)
        return Promise.resolve()
      },
      remove: (key: string) => {
        grants.delete(key)
        return Promise.resolve()
      },
    },
    now: () => Date.parse('2026-10-06T00:00:00Z'),
    ask: () => Promise.resolve('cancel'),
  })
  const use = vi.fn((provider: string, account: string) => {
    if (provider !== entry.id) return Promise.reject(new Error('wrong provider'))
    current = account
    return Promise.resolve()
  })
  const credential = vi.fn(() => Promise.resolve())
  const answer = vi.fn<AccountsPanelHostPort['answer']>(() => false)
  const accounts = new AccountStore(metadata, vault)
  const handler = new AccountsPanelHandler({
    accounts,
    confirmations,
    provider: metadata.read,
    currentAccount: () => current,
    settings: () => ({ isSwapOn: true, isParallelOn: true }),
    capabilities: () => ({
      label: 'OpenAI',
      usageUrl: 'https://provider.invalid/usage',
      planWindows: [],
      hasRateHeadroom: false,
    }),
    credential,
    use,
    answer,
    now: () => Date.parse('2026-10-06T00:00:00Z'),
  })
  const listeners = new Set<(reply: AccountsReply) => void>()
  const panel = bindAccountsPanelPort(handler, (listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  })
  return {
    panel,
    handler,
    use,
    metadata,
    vault,
    emit: (reply: unknown) => {
      // Negative probe: malformed notices bypass the typed port so the
      // skin's runtime mapping to `unavailable` still executes (§8 MSM104).
      for (const listener of listeners) listener(reply as AccountsReply)
    },
  }
}

const silentUnsubscribe = () => undefined

/** A dispatcher double behind the binding, with no notice publisher. */
function innerPort(handle: (request: AccountsRequest) => Promise<unknown>): AccountsPanelPort {
  return bindAccountsPanelPort(
    // Negative probe: the double returns throwing or malformed payloads no
    // honest dispatcher can produce, so the failure mapping still
    // executes (§8 MSM104).
    { handle: handle as AccountsPanelHandler['handle'] },
    () => silentUnsubscribe,
  )
}

describe('M104 accounts panel bridge', () => {
  it('lists through the dispatcher as accounts/state', async () => {
    const h = harness()
    const reply = await h.panel.dispatch({ type: 'accounts/list', provider: 'openai' })
    expect(reply).toEqual({
      type: 'accounts/state',
      provider: 'openai',
      accounts: [
        { id: 'personal', label: 'Personal', order: 0, thresholds: {} },
        { id: 'work', label: 'Work', order: 1, thresholds: {} },
      ],
      currentAccount: 'work',
      isSwapOn: true,
      isParallelOn: true,
    })
  })

  it('selects through boundary admission and re-reads state', async () => {
    const h = harness()
    const reply = await h.panel.dispatch({
      type: 'accounts/use',
      provider: 'openai',
      account: 'personal',
    })
    expect(h.use).toHaveBeenCalledWith('openai', 'personal')
    expect(reply).toMatchObject({ type: 'accounts/state', currentAccount: 'personal' })
  })

  it('rejects a secret-bearing request before any mutation', async () => {
    const h = harness()
    // A smuggled field arrives on a non-fresh object, as over the wire.
    const forged = {
      type: 'accounts/list' as const,
      provider: 'openai',
      secret: 'account-secret-canary',
    }
    await expect(h.panel.dispatch(forged)).resolves.toEqual({
      type: 'accounts/error',
      code: 'invalidAccount',
    })
    expect(h.metadata.writeAccounts).not.toHaveBeenCalled()
    expect(h.vault.remove).not.toHaveBeenCalled()
  })

  it('passes the dispatcher fixed errors through untouched', async () => {
    const h = harness()
    await expect(
      h.panel.dispatch({ type: 'accounts/remove', provider: 'openai', account: 'missing' }),
    ).resolves.toEqual({ type: 'accounts/error', code: 'invalidAccount' })
    await expect(
      h.panel.dispatch({
        type: 'accounts/confirm',
        provider: 'openai',
        product: 'api',
        questionId: '123e4567-e89b-12d3-a456-426614174000',
        providerGeneration: 1,
        choice: 'confirm',
      }),
    ).resolves.toEqual({ type: 'accounts/error', code: 'consentRequired' })
  })

  it('maps dispatcher failures to fixed codes without adapter text', async () => {
    const refused = innerPort(() => Promise.reject(new ForeignStoreError()))
    await expect(refused.dispatch({ type: 'accounts/list', provider: 'openai' })).resolves.toEqual({
      type: 'accounts/error',
      code: 'providersInvalid',
    })
    const broken = innerPort(() => Promise.reject(new Error('account-secret-canary')))
    const reply = await broken.dispatch({ type: 'accounts/list', provider: 'openai' })
    expect(reply).toEqual({ type: 'accounts/error', code: 'unavailable' })
    expect(JSON.stringify(reply)).not.toContain('account-secret-canary')
    const malformed = innerPort(() => Promise.resolve({ bogus: true }))
    await expect(
      malformed.dispatch({ type: 'accounts/list', provider: 'openai' }),
    ).resolves.toEqual({ type: 'accounts/error', code: 'unavailable' })
  })

  it('forwards validated notices and maps malformed ones', async () => {
    const h = harness()
    const listener = vi.fn()
    const stop = h.panel.subscribe(listener)
    const state = await h.panel.dispatch({ type: 'accounts/list', provider: 'openai' })
    h.emit(state)
    expect(listener).toHaveBeenCalledWith(state)
    h.emit({ bogus: true })
    expect(listener).toHaveBeenLastCalledWith({ type: 'accounts/error', code: 'unavailable' })
    expect(listener).toHaveBeenCalledTimes(2)
    stop()
    h.emit(state)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('throws the fixed sentence when subscribing fails', () => {
    const h = harness()
    const failing = bindAccountsPanelPort(h.handler, () => {
      throw new Error('account-secret-canary')
    })
    expect(() => failing.subscribe(vi.fn())).toThrow(UI_TEXT.accounts.unavailable)
  })
})
