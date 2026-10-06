import { describe, expect, it, vi } from 'vitest'
import { AccountStore, type AccountProvider } from '../../src/core/providers/accounts'
import { AccountConfirmations } from '../../src/core/accounts/confirmations'
import { AccountsPanelHandler } from '../../src/host/models/accountsHandler'
import { AccountPolicyPrompt } from '../../src/host/models/accountPolicyPrompt'
import { modelsAccountsSliceSchema } from '../../src/shared/modelsPanel'
import { panelPolicy, panelSlice } from './helpers/accounts/panel'

function harness() {
  let entry: AccountProvider = {
    id: 'openai',
    policyProvider: 'openai',
    product: 'api',
    auth: 'apiKey',
    origin: 'https://provider.invalid',
    accounts: panelSlice().accounts,
  }
  let current: string | null = 'work'
  const metadata = {
    read: (id: string) => Promise.resolve(id === entry.id ? entry : undefined),
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
  const store = {
    read: vi.fn(() => Promise.resolve(undefined)),
    write: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
  }
  const confirmations = new AccountConfirmations({
    machineId: 'local',
    store,
    now: () => Date.parse('2026-10-06T00:00:00Z'),
    ask: () => Promise.resolve('cancel'),
  })
  const use = vi.fn((_provider: string, account: string) => {
    current = account
    return Promise.resolve()
  })
  const credential = vi.fn(() => Promise.resolve())
  const handler = new AccountsPanelHandler({
    accounts: new AccountStore(metadata, vault),
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
    answer: () => false,
    now: () => Date.parse('2026-10-06T00:00:00Z'),
  })
  return {
    handler,
    vault,
    store,
    use,
    credential,
    metadata,
    configure: (value: Partial<AccountProvider>) => {
      entry = { ...entry, ...value }
    },
  }
}

describe('M108 panel host', () => {
  it('adds, labels, groups, orders, edits thresholds and removes through the real account store', async () => {
    const h = harness()
    const account = { id: 'team', label: 'Team', order: 2, thresholds: {} }
    await h.handler.handle({ type: 'accounts/add', provider: 'openai', account })
    expect(h.credential).toHaveBeenCalledWith('openai', 'team')
    expect(h.vault.read).not.toHaveBeenCalled()
    await h.handler.handle({
      type: 'accounts/update',
      provider: 'openai',
      account: { ...account, label: 'Org', limitGroup: 'project' },
    })
    await h.handler.handle({
      type: 'accounts/order',
      provider: 'openai',
      accounts: ['team', 'work', 'personal'],
    })
    await h.handler.handle({
      type: 'accounts/thresholds',
      provider: 'openai',
      account: 'team',
      thresholds: { spendUsd: { week: 0.3 } },
    })
    const added = await h.handler.snapshot('openai')
    expect(added.accounts[0]).toEqual({
      ...account,
      label: 'Org',
      limitGroup: 'project',
      order: 0,
      thresholds: { spendUsd: { week: 0.3 } },
    })
    await h.handler.handle({ type: 'accounts/remove', provider: 'openai', account: 'work' })
    expect(h.vault.remove).toHaveBeenCalledWith({
      provider: 'openai',
      account: 'work',
      origin: 'https://provider.invalid',
    })
    const removed = await h.handler.snapshot('openai')
    expect(removed.currentAccount).toBeNull()
  })
  it('selects only a member through the boundary admission port', async () => {
    const h = harness()
    expect(
      await h.handler.handle({ type: 'accounts/use', provider: 'openai', account: 'missing' }),
    ).toEqual({ type: 'accounts/error', code: 'invalidAccount' })
    expect(h.use).not.toHaveBeenCalled()
    await h.handler.handle({ type: 'accounts/use', provider: 'openai', account: 'personal' })
    expect(h.use).toHaveBeenCalledWith('openai', 'personal')
    const selected = await h.handler.snapshot('openai')
    expect(selected.currentAccount).toBe('personal')
  })
  it.each([
    { policyProvider: 'anthropic', product: 'claude-plan', code: 'notOffered' },
    { policyProvider: 'github', product: 'copilot', code: 'notOffered' },
    { policyProvider: 'meta', product: 'muse-code', code: 'unavailable' },
  ])('refuses unavailable credential selection for $product', async ({ code, ...entry }) => {
    const h = harness()
    h.configure(entry)
    expect(
      await h.handler.handle({ type: 'accounts/use', provider: 'openai', account: 'personal' }),
    ).toEqual({ type: 'accounts/error', code })
    expect(h.use).not.toHaveBeenCalled()
  })
  it('rejects secret-bearing or forged bridge requests before any mutation', async () => {
    const h = harness()
    expect(
      await h.handler.handle({
        type: 'accounts/remove',
        provider: 'openai',
        account: 'work',
        key: 'planted-canary',
      }),
    ).toEqual({ type: 'accounts/error', code: 'invalidAccount' })
    expect(h.vault.remove).not.toHaveBeenCalled()
    expect(
      await h.handler.handle({
        type: 'accounts/confirm',
        provider: 'openai',
        product: 'api',
        choice: 'confirm',
      }),
    ).toEqual({ type: 'accounts/error', code: 'consentRequired' })
    expect(
      await h.handler.handle({
        type: 'accounts/revoke',
        provider: 'openai',
        product: 'chatgpt-plan',
      }),
    ).toEqual({ type: 'accounts/error', code: 'invalidAccount' })
    expect(h.store.remove).not.toHaveBeenCalled()
    await h.handler.handle({ type: 'accounts/revoke', provider: 'openai', product: 'api' })
    expect(h.store.remove).toHaveBeenCalledWith('openai', 'api')
  })
  it('returns fixed errors without leaking adapter text', async () => {
    const h = harness()
    h.credential.mockRejectedValueOnce(new Error('planted-private-text'))
    expect(
      await h.handler.handle({
        type: 'accounts/add',
        provider: 'openai',
        account: { id: 'team', label: 'Team', order: 2, thresholds: {} },
      }),
    ).toEqual({ type: 'accounts/error', code: 'unavailable' })
  })
  it('validates every display boundary including URLs and current account', () => {
    const value = panelSlice()
    expect(modelsAccountsSliceSchema.safeParse(value).success).toBe(true)
    for (const change of [
      { secret: 'planted' },
      { currentAccount: 'absent' },
      { usageUrl: 'javascript:alert(1)' },
      { usageUrl: 'https://user:pass@provider.invalid' },
      { usageUrl: '' },
    ]) {
      expect(modelsAccountsSliceSchema.safeParse({ ...value, ...change }).success).toBe(false)
    }
  })
})

describe('M108 host-issued policy dialog', () => {
  it('quotes the actual row and only accepts the matching pending provider and product', async () => {
    const row = panelPolicy()
    const show = vi.fn()
    const prompt = new AccountPolicyPrompt({
      show,
      policy: () => row,
      now: () => Date.parse('2026-10-06T00:00:00Z'),
    })
    const request = {
      type: 'accounts/confirm',
      provider: 'openai',
      product: 'api',
      choice: 'confirm',
    } as const
    expect(prompt.answer(request)).toBe(false)
    const pending = prompt.ask('openai', row)
    expect(show).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({ sources: row.sources, checkedAt: row.checkedAt }),
    )
    expect(prompt.answer({ ...request, provider: 'other' })).toBe(false)
    expect(prompt.answer({ ...request, product: 'other' })).toBe(false)
    expect(prompt.answer({ ...request, secret: 'planted' })).toBe(false)
    expect(prompt.answer(request)).toBe(true)
    expect(await pending).toBe('confirm')
    expect(prompt.answer(request)).toBe(false)
  })
  it('discards a changed row and cancels on disposal or overlapping questions', async () => {
    const row = panelPolicy()
    const show = vi.fn()
    const prompt = new AccountPolicyPrompt({
      show,
      policy: () => row,
      now: () => Date.parse('2026-10-06T00:00:00Z'),
    })
    const pending = prompt.ask('openai', row)
    expect(await prompt.ask('openai', row)).toBe('cancel')
    row.sources[0]!.quote = 'Changed clause'
    expect(
      prompt.answer({
        type: 'accounts/confirm',
        provider: 'openai',
        product: 'api',
        choice: 'confirm',
      }),
    ).toBe(false)
    expect(await pending).toBe('cancel')
    const disposed = prompt.ask('openai', row)
    prompt.close()
    expect(await disposed).toBe('cancel')
  })
})
