import { describe, expect, it, vi } from 'vitest'
import {
  AccountPaidUseConsent,
  paidAccountQuestion,
  type AccountPaidUseConsentDeps,
  type PaidAccountBinding,
} from '../../src/core/paid/paidConsent'
import type { PaidFeature } from '../../src/shared/constants'
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
  const grants = new Map<string, ReadonlySet<PaidFeature>>()
  const state = { isOn: true, isCurrent: true, canRemember: true }
  const deps: {
    -readonly [Key in keyof AccountPaidUseConsentDeps]: AccountPaidUseConsentDeps[Key]
  } = {
    isOn: () => state.isOn,
    isCurrent: () => state.isCurrent,
    canRemember: () => state.canRemember,
    readGrants: (key) => grants.get(key) ?? new Set(),
    writeGrants: vi.fn<AccountPaidUseConsentDeps['writeGrants']>((key, next) => {
      grants.set(key, next)
      return Promise.resolve()
    }),
    ask: vi.fn<AccountPaidUseConsentDeps['ask']>(() => Promise.resolve('once')),
    log: new FakeLogOutputChannel(),
  }
  const create = (patch: Partial<PaidAccountBinding> = {}) =>
    new AccountPaidUseConsent(deps, { ...BINDING, ...patch })
  return { deps, grants, state, create }
}

function holdFirstWrite(t: ReturnType<typeof rig>) {
  const finish = Promise.withResolvers<undefined>()
  const write = vi.mocked(t.deps.writeGrants).getMockImplementation()!
  vi.mocked(t.deps.writeGrants).mockImplementationOnce(async (key, next) => {
    await finish.promise
    await write(key, next)
  })
  return finish
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
    vi.mocked(t.deps.ask).mockResolvedValue('always')
    const finish = holdFirstWrite(t)
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
      expect(t.deps.writeGrants).toHaveBeenCalledTimes(1)
    })
    finish.resolve(undefined)
    expect(await Promise.all([first, second])).toEqual([true, true])
    expect(t.grants.size).toBe(1)
    expect(t.grants.values().next().value).toEqual(new Set(['autoReviewer', 'judge']))
    expect(await a.allows(judge)).toBe(true)
    expect(t.deps.ask).toHaveBeenCalledTimes(2)
    await a.revoke()
    for (const features of t.grants.values()) expect(features.size).toBe(0)
  })

  it('discards a queued Always effect after revocation and preserves both features on a fresh generation', async () => {
    const t = rig(),
      a = t.create()
    vi.mocked(t.deps.ask).mockResolvedValue('always')
    const finish = holdFirstWrite(t)
    const first = a.allows(REQUEST),
      second = a.allows({ feature: 'voice' })
    await vi.waitFor(() => {
      expect(t.deps.writeGrants).toHaveBeenCalledTimes(1)
    })
    const revoked = a.revoke()
    expect(await a.allows(REQUEST)).toBe(false)
    finish.resolve(undefined)
    expect(await Promise.all([first, second])).toEqual([false, false])
    await revoked
    expect(t.deps.writeGrants).toHaveBeenCalledTimes(2)
    for (const features of t.grants.values()) expect(features.size).toBe(0)
    expect(await Promise.all([a.allows(REQUEST), a.allows({ feature: 'voice' })])).toEqual([
      true,
      true,
    ])
    expect(t.grants.values().next().value).toEqual(new Set(['webSearch', 'voice']))
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
    vi.mocked(t.deps.ask).mockResolvedValue('always')
    // Search Always grants persist their quote ceiling, not a legacy feature bit.
    const quotes = new Map<string, PaidGrant>()
    const create = (patch: Partial<PaidAccountBinding> = {}) => {
      const binding = { ...BINDING, ...patch }
      const bindingKey = JSON.stringify([binding.provider, binding.account, binding.price])
      return new AccountPaidUseConsent(
        {
          ...t.deps,
          readQuoteGrant: (quote) => quotes.get(bindingKey + paidAuthorityKey(quote)),
          writeQuoteGrant: (grant) => {
            quotes.set(bindingKey + paidAuthorityKey(grant.quote), grant)
            return Promise.resolve()
          },
        },
        binding,
      )
    }
    t.grants.set('legacy', new Set(['webSearch']))
    const a = create()
    expect(await a.allows(REQUEST)).toBe(true)
    expect(await create().allows(REQUEST)).toBe(true)
    expect(t.deps.ask).toHaveBeenCalledTimes(1)
    for (const patch of [
      { provider: 'openai' },
      { account: 'b' },
      { price: '$6 per 1,000 searches' },
    ])
      expect(await create(patch).allows(REQUEST)).toBe(true)
    expect(t.deps.ask).toHaveBeenCalledTimes(4)
    t.state.canRemember = false
    expect(await create().allows(REQUEST)).toBe(true)
    expect(t.deps.ask).toHaveBeenCalledTimes(5)
  })

  it('asks again for requiresAsking, Deny or a new window after Allow once', async () => {
    const t = rig(),
      a = t.create()
    expect(await a.allows(REQUEST)).toBe(true)
    vi.mocked(t.deps.ask).mockResolvedValue('deny')
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
    vi.mocked(t.deps.ask).mockImplementation(() => {
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
    vi.mocked(t.deps.ask).mockReturnValue(answer.promise)
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
    vi.mocked(t.deps.ask).mockReturnValueOnce(answer.promise)
    const pending = a.allows(REQUEST)
    const revoked = a.revoke()
    expect(await a.allows(REQUEST)).toBe(false)
    answer.resolve('always')
    expect(await pending).toBe(false)
    await revoked
    expect(await a.allows(REQUEST)).toBe(true)
    expect(t.deps.ask).toHaveBeenCalledTimes(3)
  })

  it('clears a remembered write before revocation finishes and keeps failed deletion revoked', async () => {
    const t = rig(),
      a = t.create()
    vi.mocked(t.deps.ask).mockResolvedValue('always')
    const finish = Promise.withResolvers<undefined>()
    const write = t.deps.writeGrants
    t.deps.writeGrants = vi.fn<AccountPaidUseConsentDeps['writeGrants']>(async (key, grants) => {
      if (grants.size > 0) await finish.promise
      await write(key, grants)
    })
    const pending = a.allows(REQUEST)
    await vi.waitFor(() => {
      expect(t.deps.writeGrants).toHaveBeenCalledTimes(1)
    })
    const revoked = a.revoke()
    finish.resolve(undefined)
    expect(await pending).toBe(false)
    await revoked
    for (const grants of t.grants.values()) expect(grants.size).toBe(0)
    expect(await a.allows(REQUEST)).toBe(true)
    t.deps.writeGrants = vi.fn(() => Promise.reject(new Error('disk unavailable')))
    await expect(a.revoke()).rejects.toThrow('disk unavailable')
    vi.mocked(t.deps.ask).mockResolvedValue('deny')
    expect(await a.allows(REQUEST)).toBe(false)
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
    vi.mocked(t.deps.writeGrants)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
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

  it('refuses a tariff or account that changes during a remembered grant write', async () => {
    const t = rig(),
      a = t.create()
    vi.mocked(t.deps.ask).mockResolvedValue('always')
    vi.mocked(t.deps.writeGrants).mockImplementation(async () => {
      await Promise.resolve()
      t.state.isCurrent = false
    })
    expect(await a.allows(REQUEST)).toBe(false)
  })
})
