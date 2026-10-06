import { describe, expect, it, vi } from 'vitest'
import {
  AccountConfirmations,
  type AccountConfirmationStore,
} from '../../src/core/accounts/confirmations'
import { policyRig } from './helpers/accounts/policy'

describe('M108 machine-local account confirmations', () => {
  it('records the machine, provider, product, version, check date, answer and time', async () => {
    const t = policyRig()
    const grant = await t.confirmations.obtain(t.policy(), true)
    expect(grant?.choice).toBe('confirm')
    expect(t.data.get('meta/model-api')).toEqual({
      confirmation: {
        machineId: 'machine-a',
        provider: 'meta',
        product: 'model-api',
        recordVersion: t.policy().recordVersion,
        recordCheckedAt: '2026-10-05',
        answeredAt: '2026-10-06T12:00:00.000Z',
        choice: 'confirm',
      },
      policyDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    await t.confirmations.obtain(t.policy(), true)
    expect(t.ask).toHaveBeenCalledTimes(1)
  })

  it('never carries a grant to another machine, provider or product', async () => {
    const t = policyRig()
    await t.confirmations.obtain(t.policy(), true)
    const other = new AccountConfirmations({ ...t.deps, machineId: 'machine-b' })
    expect(await other.read(t.policy())).toBeUndefined()
    for (const patch of [{ provider: 'openai' }, { product: 'muse-code' }]) {
      const row = { ...t.policy(), ...patch }
      t.data.set(`${row.provider}/${row.product}`, t.data.get('meta/model-api'))
      expect(await t.confirmations.read(row)).toBeUndefined()
    }
  })

  it('rejects a tampered machine, provider, product, version, check date or answer time', async () => {
    const t = policyRig()
    await t.confirmations.obtain(t.policy(), true)
    const stored = vi.mocked(t.store.write).mock.calls[0]![2]
    for (const patch of [
      { machineId: 'machine-b' },
      { provider: 'openai' },
      { product: 'api' },
      { recordVersion: 'other' },
      { recordCheckedAt: '2026-10-04' },
      { answeredAt: '2026-10-07T00:00:00Z' },
    ]) {
      t.data.set('meta/model-api', {
        ...stored,
        confirmation: { ...stored.confirmation, ...patch },
      })
      expect(await t.confirmations.read(t.policy())).toBeUndefined()
    }
  })

  it.each([
    { recordVersion: 'new-version' },
    { checkedAt: '2026-10-06' },
    { sources: [{ quote: 'changed clause', url: 'https://example.test/terms', pageDate: null }] },
    { multipleAccounts: 'onePerPerson' as const },
  ])('asks again when the policy row changes: %j', async (patch) => {
    const t = policyRig()
    const grant = await t.confirmations.obtain(t.policy(), true)
    t.change(patch)
    expect(grant?.isCurrent(t.policy())).toBe(false)
    await t.confirmations.obtain(t.policy(), true)
    expect(t.ask).toHaveBeenCalledTimes(2)
  })

  it('shares one concurrent question and headless never opens one', async () => {
    const t = policyRig()
    expect(await t.confirmations.obtain(t.policy(), false)).toBeUndefined()
    expect(t.ask).not.toHaveBeenCalled()
    const answer = Promise.withResolvers<unknown>()
    t.ask.mockImplementation(() => answer.promise)
    const first = t.confirmations.obtain(t.policy(), true)
    const second = t.confirmations.obtain(t.policy(), true)
    await vi.waitFor(() => {
      expect(t.ask).toHaveBeenCalledTimes(1)
    })
    answer.resolve('ownCapsOnly')
    const grants = await Promise.all([first, second])
    expect(grants.map((grant) => grant?.choice)).toEqual(['ownCapsOnly', 'ownCapsOnly'])
    const decision1 = await t.confirmations.obtain(t.policy(), false)
    expect(decision1?.choice).toBe('ownCapsOnly')
  })

  it('revokes immediately and refuses an answer from a revoked pending dialog', async () => {
    const t = policyRig()
    const grant = await t.confirmations.obtain(t.policy(), true)
    const revoked = t.confirmations.revoke('meta', 'model-api')
    expect(grant?.isCurrent(t.policy())).toBe(false)
    await revoked
    const answer = Promise.withResolvers<unknown>()
    t.ask.mockImplementation(() => answer.promise)
    const pending = t.confirmations.obtain(t.policy(), true)
    await vi.waitFor(() => {
      expect(t.ask).toHaveBeenCalledTimes(2)
    })
    await t.confirmations.revoke('meta', 'model-api')
    answer.resolve('confirm')
    expect(await pending).toBeUndefined()
    expect(t.data.size).toBe(0)
  })

  it('serializes revocation after an in-flight write and recovers after I/O failure', async () => {
    const t = policyRig()
    const finish = Promise.withResolvers<undefined>()
    const write = t.store.write
    t.store.write = vi.fn<AccountConfirmationStore['write']>(async (provider, product, value) => {
      await finish.promise
      await write(provider, product, value)
    })
    const pending = t.confirmations.obtain(t.policy(), true)
    await vi.waitFor(() => {
      expect(t.store.write).toHaveBeenCalledTimes(1)
    })
    const revoked = t.confirmations.revoke('meta', 'model-api')
    finish.resolve(undefined)
    expect(await pending).toBeUndefined()
    await revoked
    expect(t.data.size).toBe(0)
    t.store.write = vi.fn(() => Promise.reject(new Error('disk unavailable')))
    await expect(t.confirmations.obtain(t.policy(), true)).rejects.toThrow('disk unavailable')
    await expect(t.confirmations.revoke('meta', 'model-api')).resolves.toBeUndefined()
  })

  it('never rereads a revoked grant while deletion is pending or after deletion fails', async () => {
    const t = policyRig()
    await t.confirmations.obtain(t.policy(), true)
    const finish = Promise.withResolvers<undefined>()
    t.store.remove = vi.fn(() => finish.promise)
    const deleting = t.confirmations.revoke('meta', 'model-api')
    await vi.waitFor(() => {
      expect(t.store.remove).toHaveBeenCalledTimes(1)
    })
    expect(await t.confirmations.obtain(t.policy(), false)).toBeUndefined()
    finish.resolve(undefined)
    await deleting
    // The fake deletion deliberately left the old bytes, as a failed write might.
    expect(await t.confirmations.obtain(t.policy(), false)).toBeUndefined()
    t.store.remove = vi.fn(() => Promise.reject(new Error('disk unavailable')))
    await expect(t.confirmations.revoke('meta', 'model-api')).rejects.toThrow('disk unavailable')
    expect(await t.confirmations.obtain(t.policy(), false)).toBeUndefined()
    const decision2 = await t.confirmations.obtain(t.policy(), true)
    expect(decision2?.choice).toBe('confirm')
  })

  it('rejects malformed stored records, future answers and invalid popup choices', async () => {
    const t = policyRig()
    t.data.set('meta/model-api', { choice: 'confirm' })
    expect(await t.confirmations.read(t.policy())).toBeUndefined()
    await t.confirmations.obtain(t.policy(), true)
    const future = new AccountConfirmations({
      ...t.deps,
      now: () => Date.parse('2026-10-05T12:00:00Z'),
    })
    expect(await future.read(t.policy())).toBeUndefined()
    const invalidClock = new AccountConfirmations({ ...t.deps, now: () => NaN })
    expect(await invalidClock.read(t.policy())).toBeUndefined()
    await t.confirmations.revoke('meta', 'model-api')
    t.ask.mockResolvedValue({ choice: 'confirm', secret: 'fake-only' })
    await expect(t.confirmations.obtain(t.policy(), true)).rejects.toThrow()
    expect(t.data.size).toBe(0)
  })
})
