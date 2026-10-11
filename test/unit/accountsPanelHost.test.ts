import { describe, expect, it, vi } from 'vitest'
import { AccountStore, type AccountProvider } from '../../src/core/providers/accounts'
import { AccountConfirmations } from '../../src/core/accounts/confirmations'
import {
  AccountsPanelHandler,
  type AccountsPanelHostPort,
} from '../../src/host/models/accountsHandler'
import { AccountPolicyPrompt } from '../../src/host/models/accountPolicyPrompt'
import {
  accountsNoticeSchema,
  accountsPolicyQuestionSchema,
  modelsAccountsSliceSchema,
} from '../../src/shared/modelsPanel'
import { panelPolicy, panelQuestion, panelSlice } from './helpers/accounts/panel'

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
  return {
    handler,
    accounts,
    vault,
    store,
    use,
    credential,
    answer,
    metadata,
    configure: (value: Partial<AccountProvider>) => {
      entry = { ...entry, ...value }
    },
  }
}

async function pendingAddition(h: ReturnType<typeof harness>) {
  const account = { id: 'team', label: 'Team', order: 2, thresholds: {} }
  const request = { type: 'accounts/add', provider: 'openai', account }
  const opened = Promise.withResolvers<undefined>()
  const credential = Promise.withResolvers<undefined>()
  h.credential.mockImplementationOnce(() => {
    opened.resolve(undefined)
    return credential.promise
  })
  const original = h.handler.handle(request)
  await opened.promise
  return { account, request, original, credential }
}

describe('M108 panel host', () => {
  it('keeps uncaptured Muse Code metadata mutations off as well as credentials', async () => {
    const h = harness()
    h.configure({ policyProvider: 'meta', product: 'muse-code', auth: 'subscription' })
    const account = panelSlice().accounts[0]!
    const requests = [
      { type: 'accounts/add', provider: 'openai', account: { ...account, id: 'team' } },
      { type: 'accounts/update', provider: 'openai', account },
      { type: 'accounts/remove', provider: 'openai', account: 'work' },
      { type: 'accounts/order', provider: 'openai', accounts: ['personal', 'work'] },
      { type: 'accounts/thresholds', provider: 'openai', account: 'work', thresholds: {} },
    ]
    for (const request of requests) {
      expect(await h.handler.handle(request)).toEqual({
        type: 'accounts/error',
        code: 'unavailable',
      })
    }
    expect(h.metadata.writeAccounts).not.toHaveBeenCalled()
    expect(h.vault.remove).not.toHaveBeenCalled()
    expect(h.credential).not.toHaveBeenCalled()
    const snapshot = await h.handler.snapshot('openai')
    expect(snapshot.policy?.product).toBe('muse-code')
  })
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
      thresholds: { spendUsd: { week: '0.3' } },
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
        questionId: panelQuestion().questionId,
        providerGeneration: 1,
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
  it.each(['cancelled', 'credential storage failed'])(
    'rolls back a %s credential addition so the same draft can be retried',
    async (failure) => {
      const h = harness()
      const account = { id: 'team', label: 'Team', order: 2, thresholds: {} }
      const request = { type: 'accounts/add', provider: 'openai', account }
      h.credential.mockRejectedValueOnce(new Error(failure))
      expect(await h.handler.handle(request)).toEqual({
        type: 'accounts/error',
        code: 'unavailable',
      })
      const cancelled = await h.handler.snapshot('openai')
      expect(cancelled.accounts).toEqual(panelSlice().accounts)
      expect(h.vault.remove).toHaveBeenCalledWith({
        provider: 'openai',
        account: 'team',
        origin: 'https://provider.invalid',
      })
      expect(await h.handler.handle(request)).toMatchObject({
        accounts: expect.arrayContaining([account]),
      })
      expect(h.credential).toHaveBeenCalledTimes(2)
    },
  )
  it('does not roll back an existing account when a duplicate add fails', async () => {
    const h = harness()
    await h.handler.handle({
      type: 'accounts/add',
      provider: 'openai',
      account: panelSlice().accounts[0],
    })
    const unchanged = await h.handler.snapshot('openai')
    expect(unchanged.accounts).toEqual(panelSlice().accounts)
    expect(h.credential).not.toHaveBeenCalled()
    expect(h.vault.remove).not.toHaveBeenCalled()
  })
  it.each(['pending', 'cancelled'])(
    'preserves a replacement account and credential when the original addition is %s',
    async (state) => {
      const h = harness()
      // A second surface/CLI adapter shares the real store's mutation queue.
      const other = new AccountStore(h.metadata, h.vault)
      const { account, request, original, credential } = await pendingAddition(h)
      await other.remove('openai', 'team')
      const rollbackStarted = Promise.withResolvers<undefined>()
      const rollback = Promise.withResolvers<undefined>()
      const remove = h.accounts.remove.bind(h.accounts)
      vi.spyOn(h.accounts, 'remove').mockImplementationOnce(async (...args) => {
        rollbackStarted.resolve(undefined)
        await rollback.promise
        await remove(...args)
      })
      if (state === 'cancelled') {
        credential.reject(new Error('cancelled'))
        await rollbackStarted.promise
      }
      // Even byte-identical metadata is a distinct addition with its own credential.
      expect(await h.handler.handle(request)).toMatchObject({
        accounts: expect.arrayContaining([account]),
      })
      h.vault.remove.mockClear()
      if (state === 'pending') {
        credential.reject(new Error('cancelled'))
        await rollbackStarted.promise
      }
      rollback.resolve(undefined)
      expect(await original).toEqual({ type: 'accounts/error', code: 'unavailable' })
      const snapshot = await h.handler.snapshot('openai')
      expect(snapshot.accounts).toEqual([...panelSlice().accounts, account])
      expect(h.vault.remove).not.toHaveBeenCalled()
    },
  )
  it('compares rollback ownership after earlier queued replacement mutations settle', async () => {
    const h = harness()
    const other = new AccountStore(h.metadata, h.vault)
    const { account, original, credential } = await pendingAddition(h)
    const writing = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const write = h.metadata.writeAccounts.getMockImplementation()!
    h.metadata.writeAccounts.mockImplementationOnce(async (...args) => {
      writing.resolve(undefined)
      await release.promise
      await write(...args)
    })
    const blocker = other.update('openai', panelSlice().accounts[0]!)
    await writing.promise
    const removal = other.remove('openai', 'team')
    const replacement = other.add('openai', account)
    const rollingBack = Promise.withResolvers<undefined>()
    const remove = h.accounts.remove.bind(h.accounts)
    vi.spyOn(h.accounts, 'remove').mockImplementationOnce(async (...args) => {
      rollingBack.resolve(undefined)
      await remove(...args)
    })
    credential.reject(new Error('cancelled'))
    await rollingBack.promise
    // Rollback joins behind removal/re-addition while the original still owns the ID.
    release.resolve(undefined)
    await Promise.all([blocker, removal, replacement])
    expect(await original).toEqual({ type: 'accounts/error', code: 'unavailable' })
    const snapshot = await h.handler.snapshot('openai')
    expect(snapshot.accounts).toEqual([...panelSlice().accounts, account])
    expect(h.vault.remove).toHaveBeenCalledTimes(1)
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
  it('validates question correlation and recovery projections without secret-bearing fields', () => {
    const question = panelQuestion()
    expect(accountsPolicyQuestionSchema.safeParse(question).success).toBe(true)
    for (const change of [
      { questionId: '' },
      { providerGeneration: 0 },
      { providerGeneration: Number.MAX_SAFE_INTEGER + 1 },
      { secret: 'planted' },
    ])
      expect(accountsPolicyQuestionSchema.safeParse({ ...question, ...change }).success).toBe(false)
    const event = {
      type: 'stop',
      provider: 'openai',
      account: 'work',
      time: '2026-10-06T00:00:00Z',
      trigger: { kind: 'vendorLimit', reason: 'quota', resetAt: null },
    }
    expect(accountsNoticeSchema.safeParse({ event, resetAt: null }).success).toBe(true)
    expect(accountsNoticeSchema.safeParse({ event, resetAt: '2026-10-07T00:00:00Z' }).success).toBe(
      true,
    )
    for (const value of [
      event,
      { event },
      { event, resetAt: 'tomorrow' },
      { event, resetAt: null, secret: 'planted' },
      { event: { ...event, secret: 'planted' }, resetAt: null },
      {
        event: {
          type: 'spread',
          provider: 'openai',
          account: 'work',
          time: event.time,
          workerId: 'worker',
        },
        resetAt: '2026-10-07T00:00:00Z',
      },
    ])
      expect(accountsNoticeSchema.safeParse(value).success).toBe(false)
  })
})

function questionHarness() {
  const row = panelPolicy()
  const show = vi.fn()
  const prompt = new AccountPolicyPrompt({
    show,
    policy: () => row,
    now: () => Date.parse('2026-10-06T00:00:00Z'),
  })
  return {
    row,
    show,
    prompt,
    question: () => accountsPolicyQuestionSchema.parse(show.mock.lastCall?.[1]),
  }
}

describe('M108 host-issued policy dialog', () => {
  it('keeps delayed answers correlated across the handler provider lookup', async () => {
    const h = harness()
    const { row, prompt, question } = questionHarness()
    h.answer.mockImplementation((request) => prompt.answer(request))
    const first = prompt.ask('openai', row)
    const old = question()
    const entry = await h.metadata.read('openai')
    const lookup = Promise.withResolvers<AccountProvider | undefined>()
    h.metadata.read.mockReturnValueOnce(lookup.promise)
    const response = h.handler.handle({
      type: 'accounts/confirm',
      provider: 'openai',
      product: 'api',
      choice: 'confirm',
      questionId: old.questionId,
      providerGeneration: old.providerGeneration,
    })
    prompt.close()
    expect(await first).toBe('cancel')
    // Even the identical clause requires an answer to this new host-issued question.
    const next = prompt.ask('openai', row)
    const current = question()
    lookup.resolve(entry)
    expect(await response).toEqual({ type: 'accounts/error', code: 'consentRequired' })
    for (const correlation of [
      { questionId: old.questionId, providerGeneration: current.providerGeneration },
      { questionId: current.questionId, providerGeneration: old.providerGeneration },
    ]) {
      expect(
        prompt.answer({
          type: 'accounts/confirm',
          provider: 'openai',
          product: 'api',
          choice: 'confirm',
          ...correlation,
        }),
      ).toBe(false)
    }
    expect(
      await h.handler.handle({
        type: 'accounts/confirm',
        provider: 'openai',
        product: 'api',
        choice: 'ownCapsOnly',
        questionId: current.questionId,
        providerGeneration: current.providerGeneration,
      }),
    ).toMatchObject({ provider: 'openai' })
    expect(await next).toBe('ownCapsOnly')
  })
  it('rejects an answer belonging to a closed question when its replacement quotes another clause', async () => {
    const { row, prompt, question } = questionHarness()
    const first = prompt.ask('openai', row)
    const answer = {
      type: 'accounts/confirm',
      provider: 'openai',
      product: 'api',
      choice: 'confirm',
      questionId: question().questionId,
      providerGeneration: question().providerGeneration,
    }
    prompt.close()
    expect(await first).toBe('cancel')
    row.sources[0]!.quote = 'Replacement clause'
    const next = prompt.ask('openai', row)
    expect(question().questionId).not.toBe(answer.questionId)
    expect(question().providerGeneration).not.toBe(answer.providerGeneration)
    expect(prompt.answer(answer)).toBe(false)
    prompt.close()
    expect(await next).toBe('cancel')
  })
  it('quotes the actual row and only accepts the matching pending provider and product', async () => {
    const { row, show, prompt, question } = questionHarness()
    const pending = prompt.ask('openai', row)
    const request = {
      type: 'accounts/confirm',
      provider: 'openai',
      product: 'api',
      choice: 'confirm',
      questionId: question().questionId,
      providerGeneration: question().providerGeneration,
    } as const
    expect(show).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({
        policy: expect.objectContaining({ sources: row.sources, checkedAt: row.checkedAt }),
      }),
    )
    expect(prompt.answer({ ...request, provider: 'other' })).toBe(false)
    expect(prompt.answer({ ...request, product: 'other' })).toBe(false)
    expect(prompt.answer({ ...request, secret: 'planted' })).toBe(false)
    expect(prompt.answer(request)).toBe(true)
    expect(await pending).toBe('confirm')
    expect(prompt.answer(request)).toBe(false)
  })
  it('discards a changed row and cancels on disposal or overlapping questions', async () => {
    const { row, prompt, question } = questionHarness()
    const pending = prompt.ask('openai', row)
    expect(await prompt.ask('openai', row)).toBe('cancel')
    row.sources[0]!.quote = 'Changed clause'
    expect(
      prompt.answer({
        type: 'accounts/confirm',
        provider: 'openai',
        product: 'api',
        choice: 'confirm',
        questionId: question().questionId,
        providerGeneration: question().providerGeneration,
      }),
    ).toBe(false)
    expect(await pending).toBe('cancel')
    const disposed = prompt.ask('openai', row)
    prompt.close()
    expect(await disposed).toBe('cancel')
  })
})
