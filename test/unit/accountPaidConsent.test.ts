import { describe, expect, it, vi } from 'vitest'
import {
  AccountPaidUseConsent,
  StaleEpochError,
  paidAccountQuestion,
  type AccountBindingGrants,
  type PaidAccountBinding,
  type PaidUseAnswer,
} from '../../src/core/paid/paidConsent'
import type { PaidUseRequest } from '../../src/shared/paid'
import { FakeLogOutputChannel } from './helpers/fakes'
import { Usd } from '../../src/shared/usd'
import { paidAuthorityKey, type PaidGrant } from '../../src/core/paid/paidAuthority'
import { quotedSearch } from './helpers/paidQuote'

const REQUEST: PaidUseRequest = { feature: 'webSearch', priceUsd: Usd.from(0.0025).toAmount() }
const BINDING: PaidAccountBinding = {
  provider: 'meta',
  account: 'a',
  price: '$5 per 1,000 searches',
  dailyBudgetUsd: Usd.from(5).toAmount(),
}
function rig() {
  // One durable store per rig, shared across instances like a restart that
  // kept its storage: binding grants with their approval epoch, the
  // revocation epoch per binding, and the quote grants. Each conditional
  // operation runs its epoch check and write with no await between them,
  // which is this single-threaded store's per-binding serialization; the
  // future production store must provide the same atomicity across windows.
  const grants = new Map<string, AccountBindingGrants>()
  const epochs = new Map<string, number>()
  const quotes = new Map<string, PaidGrant>()
  const state = { isOn: true, isCurrent: true, canRemember: true, quoteGeneration: 'stored-1' }
  const currentEpoch = (key: string) => epochs.get(key) ?? 0
  const deps = {
    isOn: () => state.isOn,
    isCurrent: () => state.isCurrent,
    canRemember: () => state.canRemember,
    readGrants: (key: string) => grants.get(key),
    saveGrantIf: vi.fn((key: string, epoch: number, next: AccountBindingGrants) => {
      if (currentEpoch(key) !== epoch) throw new StaleEpochError(key)
      grants.set(key, next)
      return Promise.resolve()
    }),
    readRevocationEpoch: (key: string) => epochs.get(key),
    advanceEpoch: vi.fn((key: string, expected: number) => {
      if (currentEpoch(key) !== expected) throw new StaleEpochError(key)
      epochs.set(key, expected + 1)
      return Promise.resolve()
    }),
    saveQuoteGrantIf: vi.fn((key: string, epoch: number, grant: PaidGrant) => {
      if (currentEpoch(key) !== epoch) throw new StaleEpochError(key)
      quotes.set(key + paidAuthorityKey(grant.quote), grant)
      return Promise.resolve()
    }),
    ask: vi.fn((_request: PaidUseRequest, _binding: PaidAccountBinding, _canRemember: boolean) =>
      Promise.resolve<PaidUseAnswer>('once'),
    ),
    log: new FakeLogOutputChannel(),
  }
  // Every instance gets a real account-scoped quote clear: one partition per
  // provider/account/price binding, shared across instances like a restart
  // that kept its storage. No bridge fabricates approval from a feature bit.
  const makeStore = (key: string) => ({
    revoke: vi.fn(() => {
      for (const name of quotes.keys()) if (name.startsWith(key)) quotes.delete(name)
      return Promise.resolve()
    }),
  })
  const stores = new Map<string, ReturnType<typeof makeStore>>()
  const storeFor = (key: string) => {
    const existing = stores.get(key)
    if (existing !== undefined) return existing
    const store = makeStore(key)
    stores.set(key, store)
    return store
  }
  const create = (patch: Partial<PaidAccountBinding> = {}) => {
    const binding = { ...BINDING, ...patch }
    const key = bindingKey(patch)
    const store = storeFor(key)
    return new AccountPaidUseConsent(
      {
        ...deps,
        quoteGeneration: () => state.quoteGeneration,
        readQuoteGrant: (quote) => quotes.get(key + paidAuthorityKey(quote)),
        revokeQuoteGrants: store.revoke,
      },
      binding,
    )
  }
  return { deps, grants, epochs, quotes, state, create, storeFor, bindingKey }
}

function bindingKey(patch: Partial<PaidAccountBinding> = {}) {
  return JSON.stringify([
    patch.provider ?? BINDING.provider,
    patch.account ?? BINDING.account,
    patch.price ?? BINDING.price,
  ])
}

function holdFirstSave(t: ReturnType<typeof rig>) {
  const finish = Promise.withResolvers<undefined>()
  const save = t.deps.saveGrantIf.getMockImplementation()!
  t.deps.saveGrantIf.mockImplementationOnce(async (key, epoch, next) => {
    await finish.promise
    await save(key, epoch, next)
  })
  return finish
}

/** Approves Always for `request` on a fresh instance; returns the instance. */
async function approveSearch(t: ReturnType<typeof rig>, request: PaidUseRequest) {
  t.deps.ask.mockResolvedValue('always')
  const consent = t.create()
  expect(await consent.allows(request)).toBe(true)
  return consent
}

/**
 * Approves Always for search and voice on `consent` (a fresh instance
 * unless the caller passes the one that revoked); returns the instance.
 */
async function approveSearchAndVoice(
  t: ReturnType<typeof rig>,
  request: PaidUseRequest,
  consent = t.create(),
) {
  t.deps.ask.mockResolvedValue('always')
  expect(await consent.allows(request)).toBe(true)
  expect(await consent.allows({ feature: 'voice' })).toBe(true)
  expect(t.deps.ask).toHaveBeenCalledTimes(2)
  return consent
}

/** A restart on the same store reuses both grants with no new ask. */
async function expectRestartReusesBoth(
  t: ReturnType<typeof rig>,
  request: PaidUseRequest,
  asks: number,
) {
  expect(await t.create().allows(request)).toBe(true)
  expect(await t.create().allows({ feature: 'voice' })).toBe(true)
  expect(t.deps.ask).toHaveBeenCalledTimes(asks)
}

/**
 * A restart on the same store finds only stale leftovers: it asks again
 * and Deny is honoured for both.
 */
async function expectRestartAsksDenied(
  t: ReturnType<typeof rig>,
  request: PaidUseRequest,
  asks: number,
) {
  t.deps.ask.mockResolvedValue('deny')
  expect(await t.create().allows(request)).toBe(false)
  expect(await t.create().allows({ feature: 'voice' })).toBe(false)
  expect(t.deps.ask).toHaveBeenCalledTimes(asks)
}

/** A failing clear rejects `revoke()` while its quote leftover stays stored. */
async function expectFailedRevokeKeepsQuote(
  t: ReturnType<typeof rig>,
  failClear: () => void,
  revoke: () => Promise<void>,
) {
  failClear()
  await expect(revoke()).rejects.toThrow('disk unavailable')
  expect(t.quotes.size).toBe(1)
}

/**
 * Approves Always for `approved`, then requires a fresh popup — honoured as
 * Deny — for `changed` on the same and on a new instance.
 */
async function expectReaskAfterChange(
  t: ReturnType<typeof rig>,
  approved: PaidUseRequest,
  changed: PaidUseRequest,
) {
  const consent = await approveSearch(t, approved)
  expect(t.deps.ask).toHaveBeenCalledTimes(1)
  t.deps.ask.mockResolvedValue('deny')
  // Same instance, same account, binding and price string: only the quote changed.
  expect(await consent.allows(changed)).toBe(false)
  expect(t.deps.ask).toHaveBeenCalledTimes(2)
  // A new instance (restart) reads the same store and asks again too.
  expect(await t.create().allows(changed)).toBe(false)
  expect(t.deps.ask).toHaveBeenCalledTimes(3)
}

/** The current conditional quote save, for gating or observing one call. */
function currentQuoteSave(t: ReturnType<typeof rig>) {
  return t.deps.saveQuoteGrantIf.getMockImplementation()!
}

/**
 * Opens one popup on a fresh instance, revokes from a second instance while
 * the answer is held, then resolves Always: the late answer is refused.
 */
async function heldAnswerRevoked(t: ReturnType<typeof rig>, request: PaidUseRequest) {
  const a = t.create(),
    b = t.create()
  const answer = Promise.withResolvers<PaidUseAnswer>()
  t.deps.ask.mockReturnValueOnce(answer.promise)
  const asking = a.allows(request)
  await vi.waitFor(() => {
    expect(t.deps.ask).toHaveBeenCalledTimes(1)
  })
  await b.revoke()
  answer.resolve('always')
  expect(await asking).toBe(false)
}

/**
 * A refused race stored no approval: only the revoker's empty clear record
 * may exist, and a restart asks with Deny honoured.
 */
async function expectRaceStoredNothing(t: ReturnType<typeof rig>) {
  for (const stored of t.grants.values()) expect(stored.features.size).toBe(0)
  t.deps.ask.mockResolvedValue('deny')
  expect(await t.create().allows({ feature: 'voice' })).toBe(false)
  expect(t.deps.ask).toHaveBeenCalledTimes(2)
}

describe('M108 account-bound paid use consent', () => {
  it('passes an exact sub-nano budget through consent without rounding its digits', async () => {
    const t = rig()
    const dailyBudgetUsd = Usd.from('0.0000000001000000000000000000001').toAmount()
    const request = quotedSearch('0.0025', 'muse-spark-1.3')
    expect(await t.create({ dailyBudgetUsd }).allows(request)).toBe(true)
    expect(t.deps.ask).toHaveBeenCalledExactlyOnceWith(
      request,
      { ...BINDING, dailyBudgetUsd },
      true,
    )
    expect(paidAccountQuestion({ ...BINDING, dailyBudgetUsd })).toContain('$0.00000000011')
  })

  it('merges concurrent Always answers inside the account owner and fences queued revocation', async () => {
    const t = rig(),
      a = t.create()
    t.deps.ask.mockResolvedValue('always')
    const finish = holdFirstSave(t)
    const judge: PaidUseRequest = {
      feature: 'judge',
      modelId: 'muse-spark-1.3',
      dailyBudgetUsd: Usd.from(5).toAmount(),
    }
    const reviewer: PaidUseRequest = {
      feature: 'autoReviewer',
      modelId: 'muse-spark-1.3',
      tool: 'edit',
      action: 'edit file',
    }
    const first = a.allows(judge),
      second = a.allows(reviewer)
    await vi.waitFor(() => {
      expect(t.deps.saveGrantIf).toHaveBeenCalledTimes(1)
    })
    finish.resolve(undefined)
    expect(await Promise.all([first, second])).toEqual([true, true])
    expect(t.grants.size).toBe(1)
    expect(t.grants.values().next().value?.features).toEqual(new Set(['autoReviewer', 'judge']))
    expect(await a.allows(judge)).toBe(true)
    expect(t.deps.ask).toHaveBeenCalledTimes(2)
    await a.revoke()
    for (const grants of t.grants.values()) expect(grants.features.size).toBe(0)
  })

  it('discards a queued Always effect after revocation and preserves both features on a fresh generation', async () => {
    const t = rig(),
      a = t.create()
    t.deps.ask.mockResolvedValue('always')
    const finish = holdFirstSave(t)
    const search = quotedSearch('0.0025', 'model-a')
    const first = a.allows(search),
      second = a.allows({ feature: 'voice' })
    await vi.waitFor(() => {
      expect(t.deps.saveGrantIf).toHaveBeenCalledTimes(1)
    })
    const revoked = a.revoke()
    expect(await a.allows(search)).toBe(false)
    finish.resolve(undefined)
    expect(await Promise.all([first, second])).toEqual([false, false])
    await revoked
    expect(t.deps.saveGrantIf).toHaveBeenCalledTimes(2)
    for (const grants of t.grants.values()) expect(grants.features.size).toBe(0)
    expect(t.quotes.size).toBe(0)
    expect(await Promise.all([a.allows(search), a.allows({ feature: 'voice' })])).toEqual([
      true,
      true,
    ])
    // Voice Always lives in the binding grant; search Always lives in the quote store.
    expect(t.grants.values().next().value?.features).toEqual(new Set(['voice']))
    expect(t.quotes.size).toBe(1)
  })

  it('asks once before the first charge per account, with the account, tariff and shared budget', async () => {
    const t = rig()
    const request = quotedSearch('0.0025', 'muse-spark-1.3')
    const a = t.create(),
      b = t.create({ account: 'b' })
    expect(await a.allows(request)).toBe(true)
    expect(await a.allows(request)).toBe(true)
    expect(t.deps.ask).toHaveBeenCalledTimes(1)
    expect(await b.allows(request)).toBe(true)
    expect(t.deps.ask).toHaveBeenCalledTimes(2)
    expect(t.deps.ask).toHaveBeenLastCalledWith(request, { ...BINDING, account: 'b' }, true)
    const detail = paidAccountQuestion(BINDING)
    expect(detail).toContain('meta · a')
    expect(detail).toContain('$5 per 1,000 searches')
    expect(detail).toContain('Shared daily budget: $5.00')
  })

  it('binds Always to workspace, provider, account and price; never reuses legacy feature grants', async () => {
    const t = rig()
    const request = quotedSearch('0.0025', 'model-a')
    t.deps.ask.mockResolvedValue('always')
    // Search Always grants persist their quote ceiling, not a legacy feature bit.
    t.grants.set('legacy', { epoch: 0, features: new Set(['webSearch']) })
    expect(await t.create().allows(request)).toBe(true)
    expect(await t.create().allows(request)).toBe(true)
    expect(t.deps.ask).toHaveBeenCalledTimes(1)
    for (const patch of [
      { provider: 'openai' },
      { account: 'b' },
      { price: '$6 per 1,000 searches' },
    ])
      expect(await t.create(patch).allows(request)).toBe(true)
    expect(t.deps.ask).toHaveBeenCalledTimes(4)
    t.state.canRemember = false
    expect(await t.create().allows(request)).toBe(true)
    expect(t.deps.ask).toHaveBeenCalledTimes(5)
  })

  it('holds Always across instances and restarts through the account quote store', async () => {
    const t = rig()
    t.deps.ask.mockResolvedValue('always')
    t.grants.set('legacy', { epoch: 0, features: new Set(['webSearch', 'voice']) })
    const search = quotedSearch('0.0025', 'model-a')
    const a = t.create()
    expect(await a.allows(search)).toBe(true)
    expect(await a.allows({ feature: 'voice' })).toBe(true)
    expect(t.deps.ask).toHaveBeenCalledTimes(2)
    // New instances — a restart that kept the stores — ask nothing, and a
    // differently-keyed legacy grant still authorizes nothing.
    expect(await t.create().allows(search)).toBe(true)
    expect(await t.create().allows({ feature: 'voice' })).toBe(true)
    expect(t.deps.ask).toHaveBeenCalledTimes(2)
  })

  it('asks again from the account store when the price changed', async () => {
    const t = rig()
    const request = quotedSearch('0.0025', 'model-a')
    await approveSearch(t, request)
    expect(await t.create({ price: '$6 per 1,000 searches' }).allows(request)).toBe(true)
    expect(t.deps.ask).toHaveBeenCalledTimes(2)
  })

  it('asks again when the quote generation changes, even with a kept quote grant', async () => {
    const t = rig()
    const request = quotedSearch('0.0025', 'model-a')
    await approveSearch(t, request)
    expect(await t.create().allows(request)).toBe(true)
    expect(t.deps.ask).toHaveBeenCalledTimes(1)
    t.state.quoteGeneration = 'stored-2'
    expect(await t.create().allows(request)).toBe(true)
    expect(t.deps.ask).toHaveBeenCalledTimes(2)
  })

  it('asks again for a higher tariff under the same binding, then honours Deny', async () => {
    // Same account, binding and price string: only the ceiling changed.
    await expectReaskAfterChange(
      rig(),
      quotedSearch('0.0025', 'model-a'),
      quotedSearch('0.01', 'model-a'),
    )
  })

  it('asks again for a different model under the same binding, then honours Deny', async () => {
    // Same account, binding and price string: only the model changed.
    await expectReaskAfterChange(
      rig(),
      quotedSearch('0.0025', 'model-a'),
      quotedSearch('0.0025', 'model-b'),
    )
  })

  it('revoke clears the account quote grant, so the next use asks and is denied', async () => {
    const t = rig()
    const request = quotedSearch('0.0025', 'model-a')
    t.deps.ask.mockResolvedValue('always')
    const a = t.create()
    expect(await a.allows(request)).toBe(true)
    expect(t.quotes.size).toBe(1)
    await a.revoke()
    expect(t.quotes.size).toBe(0)
    t.deps.ask.mockResolvedValue('deny')
    expect(await a.allows(request)).toBe(false)
    expect(t.deps.ask).toHaveBeenCalledTimes(2)
  })

  it('asks again for requiresAsking, Deny or a new window after Allow once', async () => {
    const t = rig(),
      a = t.create()
    expect(await a.allows(REQUEST)).toBe(true)
    t.deps.ask.mockResolvedValue('deny')
    expect(await a.allows(REQUEST, true)).toBe(false)
    expect(await t.create().allows(REQUEST)).toBe(false)
    expect(await t.create().allows(REQUEST)).toBe(false)
    expect(t.deps.ask).toHaveBeenCalledTimes(4)
  })

  it('refuses off, removed accounts or changed tariffs before and after the question', async () => {
    const t = rig(),
      a = t.create()
    t.state.isOn = false
    expect(await a.allows(REQUEST)).toBe(false)
    t.state.isOn = true
    t.state.isCurrent = false
    expect(await a.allows(REQUEST)).toBe(false)
    expect(t.deps.ask).not.toHaveBeenCalled()
    t.state.isCurrent = true
    t.deps.ask.mockImplementation(() => {
      t.state.isCurrent = false
      return Promise.resolve('always')
    })
    expect(await a.allows(REQUEST)).toBe(false)
    expect(t.grants.size).toBe(0)
  })

  it('shares a concurrent first question, but each account opens its own', async () => {
    const t = rig(),
      a = t.create(),
      b = t.create({ account: 'b' })
    const answer = Promise.withResolvers<'once'>()
    t.deps.ask.mockReturnValue(answer.promise)
    const first = a.allows(REQUEST),
      second = a.allows(REQUEST),
      other = b.allows(REQUEST)
    expect(t.deps.ask).toHaveBeenCalledTimes(2)
    answer.resolve('once')
    expect(await Promise.all([first, second, other])).toEqual([true, true, true])
  })

  it('revokes existing and pending grants immediately, then asks anew', async () => {
    const t = rig(),
      a = t.create()
    expect(await a.allows(REQUEST)).toBe(true)
    await a.revoke()
    const answer = Promise.withResolvers<'always'>()
    t.deps.ask.mockReturnValueOnce(answer.promise)
    const pending = a.allows(REQUEST)
    const revoked = a.revoke()
    expect(await a.allows(REQUEST)).toBe(false)
    answer.resolve('always')
    expect(await pending).toBe(false)
    await revoked
    expect(await a.allows(REQUEST)).toBe(true)
    expect(t.deps.ask).toHaveBeenCalledTimes(3)
  })

  it('clears a remembered quote write before revocation finishes and keeps failed deletion revoked', async () => {
    const t = rig(),
      a = t.create()
    const request = quotedSearch('0.0025', 'model-a')
    t.deps.ask.mockResolvedValue('always')
    const save = currentQuoteSave(t)
    const finish = Promise.withResolvers<undefined>()
    t.deps.saveQuoteGrantIf.mockImplementationOnce(async (key, epoch, grant) => {
      await finish.promise
      await save(key, epoch, grant)
    })
    const pending = a.allows(request)
    await vi.waitFor(() => {
      expect(t.deps.saveQuoteGrantIf).toHaveBeenCalledTimes(1)
    })
    const revoked = a.revoke()
    finish.resolve(undefined)
    expect(await pending).toBe(false)
    await revoked
    for (const grants of t.grants.values()) expect(grants.features.size).toBe(0)
    expect(t.quotes.size).toBe(0)
    expect(await a.allows(request)).toBe(true)
    await expectFailedRevokeKeepsQuote(
      t,
      () => t.deps.saveGrantIf.mockRejectedValueOnce(new Error('disk unavailable')),
      () => a.revoke(),
    )
    // The grant is still in the store, but the advanced epoch voids it.
    t.deps.ask.mockResolvedValue('deny')
    expect(await a.allows(request)).toBe(false)
  })

  it('reuses a post-revocation Always grant after a restart with no new ask', async () => {
    const t = rig()
    const request = quotedSearch('0.0025', 'model-a')
    const a = t.create()
    await a.revoke()
    // The approval runs on the same instance that revoked, so the test
    // would catch a post-revocation local-epoch restart defect.
    await approveSearchAndVoice(t, request, a)
    expect(t.epochs.get(bindingKey())).toBe(1)
    // A restart on the same store reads the durable epoch, so both grants hold.
    await expectRestartReusesBoth(t, request, 2)
  })

  it('ignores leftover binding grants after a restart when their clear failed', async () => {
    const t = rig()
    const request = quotedSearch('0.0025', 'model-a')
    const a = await approveSearchAndVoice(t, request)
    t.deps.saveGrantIf.mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(a.revoke()).rejects.toThrow('disk unavailable')
    // The epoch already advanced, so a restart finds only stale leftovers.
    await expectRestartAsksDenied(t, request, 4)
  })

  it('ignores leftover quote grants after a restart when their clear failed', async () => {
    const t = rig()
    const request = quotedSearch('0.0025', 'model-a')
    const a = await approveSearch(t, request)
    expect(t.deps.ask).toHaveBeenCalledTimes(1)
    await expectFailedRevokeKeepsQuote(
      t,
      () => t.storeFor(bindingKey()).revoke.mockRejectedValueOnce(new Error('disk unavailable')),
      () => a.revoke(),
    )
    t.deps.ask.mockResolvedValue('deny')
    expect(await t.create().allows(request)).toBe(false)
    expect(t.deps.ask).toHaveBeenCalledTimes(2)
  })

  it('reports a failed epoch advance honestly with the grants still working', async () => {
    const t = rig()
    const request = quotedSearch('0.0025', 'model-a')
    const a = await approveSearchAndVoice(t, request)
    t.deps.advanceEpoch.mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(a.revoke()).rejects.toThrow('disk unavailable')
    // Nothing was cleared and the epoch never moved: both instances reuse.
    expect(t.quotes.size).toBe(1)
    expect(await a.allows(request)).toBe(true)
    expect(await a.allows({ feature: 'voice' })).toBe(true)
    await expectRestartReusesBoth(t, request, 2)
  })

  it('keeps a concurrent ask on one instance from resurrecting a revoked grant', async () => {
    const t = rig()
    const request = quotedSearch('0.0025', 'model-a')
    t.deps.ask.mockResolvedValue('always')
    // A opens its question before B revokes; B's epoch advance lands first.
    await heldAnswerRevoked(t, request)
    // The late Always is refused, and nothing durable is resurrected.
    expect(t.quotes.size).toBe(0)
    t.deps.ask.mockResolvedValue('deny')
    expect(await t.create().allows(request)).toBe(false)
    expect(t.deps.ask).toHaveBeenCalledTimes(2)
  })

  it('rejects invalid binding data and uses ceiling display for a fractional budget', () => {
    const t = rig()
    for (const patch of [
      { provider: '../secret' },
      { account: 'USER' },
      { price: '' },
      { dailyBudgetUsd: Usd.from(-1).toAmount() },
    ])
      expect(() => t.create(patch)).toThrow()
    expect(
      paidAccountQuestion({ ...BINDING, dailyBudgetUsd: Usd.from('0.123').toAmount() }),
    ).toContain('$0.13')
  })

  it('keeps consent off until every concurrent revocation has finished', async () => {
    const t = rig(),
      a = t.create()
    const first = Promise.withResolvers<undefined>(),
      second = Promise.withResolvers<undefined>()
    const advance = t.deps.advanceEpoch.getMockImplementation()!
    t.deps.advanceEpoch
      .mockImplementationOnce(async (key, expected) => {
        await first.promise
        await advance(key, expected)
      })
      .mockImplementationOnce(async (key, expected) => {
        await second.promise
        await advance(key, expected)
      })
    const revokingOne = a.revoke(),
      revokingTwo = a.revoke()
    first.resolve(undefined)
    await revokingOne
    expect(await a.allows(REQUEST)).toBe(false)
    expect(t.deps.ask).not.toHaveBeenCalled()
    second.resolve(undefined)
    await revokingTwo
    expect(await a.allows(REQUEST)).toBe(true)
  })

  it('refuses a tariff or account that changes during a remembered quote write', async () => {
    const t = rig()
    const request = quotedSearch('0.0025', 'model-a')
    t.deps.ask.mockResolvedValue('always')
    const save = currentQuoteSave(t)
    const a = t.create()
    t.deps.saveQuoteGrantIf.mockImplementationOnce(async (key, epoch, grant) => {
      await Promise.resolve()
      t.state.isCurrent = false
      await save(key, epoch, grant)
    })
    expect(await a.allows(request)).toBe(false)
  })

  it('refuses a non-search answer opened before another instance revokes, storing nothing', async () => {
    const t = rig()
    // A opens its voice popup at epoch 0; B revokes before the answer lands.
    await heldAnswerRevoked(t, { feature: 'voice' })
    expect(t.quotes.size).toBe(0)
    await expectRaceStoredNothing(t)
  })

  it('refuses a non-search save held while another instance revokes, storing nothing', async () => {
    const t = rig()
    const a = t.create(),
      b = t.create()
    t.deps.ask.mockResolvedValue('always')
    const save = t.deps.saveGrantIf.getMockImplementation()!
    const finish = Promise.withResolvers<undefined>()
    t.deps.saveGrantIf.mockImplementationOnce(async (key, epoch, next) => {
      await finish.promise
      await save(key, epoch, next)
    })
    // A's voice write is captured under epoch 0, then held.
    const asking = a.allows({ feature: 'voice' })
    await vi.waitFor(() => {
      expect(t.deps.saveGrantIf).toHaveBeenCalledTimes(1)
    })
    await b.revoke()
    finish.resolve(undefined)
    // The conditional save fails, and the downgraded Allow-once is refused.
    expect(await asking).toBe(false)
    await expectRaceStoredNothing(t)
  })

  it('orders concurrent revokes strictly forward past a delayed writer', async () => {
    const t = rig()
    const request = quotedSearch('0.0025', 'model-a')
    const a = t.create(),
      b = t.create(),
      c = t.create()
    // A's compare-and-set read epoch 0, then its advance waits.
    const advance = t.deps.advanceEpoch.getMockImplementation()!
    const finish = Promise.withResolvers<undefined>()
    t.deps.advanceEpoch.mockImplementationOnce(async (key, expected) => {
      await finish.promise
      await advance(key, expected)
    })
    const revoking = a.revoke()
    await vi.waitFor(() => {
      expect(t.deps.advanceEpoch).toHaveBeenCalledTimes(1)
    })
    // B revokes cleanly to 1; C approves Always for search and voice under 1.
    await b.revoke()
    t.deps.ask.mockResolvedValue('always')
    expect(await c.allows(request)).toBe(true)
    expect(await c.allows({ feature: 'voice' })).toBe(true)
    // A's delayed advance of 0 fails, so it advances again to 2 and clears:
    // it can neither move the epoch backwards nor republish an older value.
    finish.resolve(undefined)
    await revoking
    expect(t.epochs.get(bindingKey())).toBe(2)
    // Every older grant is invalid: a restart asks, and Deny is honoured.
    t.deps.ask.mockResolvedValue('deny')
    expect(await t.create().allows(request)).toBe(false)
    expect(await t.create().allows({ feature: 'voice' })).toBe(false)
    expect(t.deps.ask).toHaveBeenCalledTimes(4)
  })

  it('refuses an instance-counter-era quote grant once the epoch matches its counter', async () => {
    const t = rig()
    const request = quotedSearch('0.0025', 'model-a')
    // A pre-upgrade approval stored the old `[counter, hostGeneration]`
    // encoding, and a revoke since moved the durable epoch onto the same
    // number the old counter used.
    const legacy = quotedSearch('0.0025', 'model-a')
    t.quotes.set(bindingKey() + paidAuthorityKey(legacy.quote), {
      quote: legacy.quote,
      generation: JSON.stringify([1, 'stored-1']),
      order: 0,
    })
    t.epochs.set(bindingKey(), 1)
    t.deps.ask.mockResolvedValue('deny')
    expect(await t.create().allows(request)).toBe(false)
    expect(t.deps.ask).toHaveBeenCalledTimes(1)
  })
})
