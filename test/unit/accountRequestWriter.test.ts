import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { activeAccountBilling } from '../../src/core/accounts/requestWriter'
import { Usd } from '../../src/shared/usd'
import { poolRequest } from './helpers/accounts/pool'
import { writerRig } from './helpers/accounts/writer'

const ORIGIN = 'https://provider.invalid'
const rigs: { liveLeases: () => number }[] = []
function rig() {
  const t = writerRig(ORIGIN)
  rigs.push(t)
  return t
}

// A lease leaked anywhere in this suite fails here.
afterEach(() => {
  // Splice first: a failing assertion must not carry its rigs into the next test.
  const pending = rigs.splice(0)
  for (const t of pending) expect(t.liveLeases()).toBe(0)
})

describe('account request writer', () => {
  it('fences a released owner before any send and refunds its reservation', async () => {
    const t = rig()
    let isCurrent = true
    const lease = await t.writer.acquire(poolRequest({ isCurrent: () => isCurrent }), ORIGIN)
    isCurrent = false
    expect(lease.isCurrent()).toBe(false)
    expect(() => {
      lease.beforeSend()
    }).toThrow()
    await lease.settle(null)
    expect(t.claims[0]!.actual).toBe(0n)
  })
  it('constructs only admitted account client and refunds cancellation before send', async () => {
    const t = rig()
    t.rows[0]!.thresholds = { requests: { day: 0 } }
    const lease = await t.writer.acquire(poolRequest(), ORIGIN)
    expect(lease.account).toBe('b')
    expect(await lease.client.currentKeyDigest()).toBe(
      createHash('sha256').update('fake-only-b').digest('hex'),
    )
    await lease.settle(null)
    expect(t.claims[0]!.actual).toBe(0n)
    expect(t.pool.current('conversation', 'main')).toBeUndefined()
    expect(t.createClient).toHaveBeenCalledOnce()
  })
  it('revocation and replacement fence held clients and prevent dispatch', async () => {
    for (const change of ['replace', 'remove'] as const) {
      const t = rig()
      const lease = await t.writer.acquire(poolRequest(), ORIGIN)
      if (change === 'replace')
        await t.store.setCredential('anthropic', 'a', {
          v: 1,
          provider: 'anthropic',
          account: 'a',
          origin: ORIGIN,
          auth: 'apiKey',
          secret: 'fake-replacement',
        })
      else await t.store.remove('anthropic', 'a')
      expect(lease.isCurrent()).toBe(false)
      expect(() => {
        lease.beforeSend()
      }).toThrow()
      await expect(lease.client.currentKeyDigest()).rejects.toThrow()
      await lease.settle(null)
      expect(t.claims[0]!.actual).toBe(0n)
    }
  })
  it('unwinds failed client construction and permits later admission by same owner', async () => {
    const t = rig()
    t.createClient.mockRejectedValueOnce(new Error('fake client failure'))
    await expect(t.writer.acquire(poolRequest(), ORIGIN)).rejects.toThrow('fake client failure')
    expect(t.claims[0]!.actual).toBe(0n)
    const lease = await t.writer.acquire(poolRequest(), ORIGIN)
    lease.beforeSend()
    // A retry is a new send on the same lease: the fence rechecks the payer
    // instead of refusing the second send.
    lease.beforeSend()
    expect(lease.isCurrent()).toBe(true)
    await lease.settle(null)
    expect(t.claims[1]!.actual).toBeNull()
    expect(lease.isCurrent()).toBe(false)
    await expect(lease.client.currentKeyDigest()).rejects.toThrow()
    await expect(lease.settle(Usd.from(0).toAmount())).rejects.toThrow()
  })
  it('keeps concurrent billing contexts isolated through waits and clears after completion', async () => {
    const t = rig()
    const main = await t.writer.acquire(poolRequest(), ORIGIN)
    const worker = await t.writer.acquire(poolRequest({ kind: 'worker', owner: 'child' }), ORIGIN)
    const seen = await Promise.all(
      [main, worker].map((lease) =>
        t.writer.within(lease, async () => {
          await Promise.resolve()
          return activeAccountBilling()
        }),
      ),
    )
    expect(
      seen.map((billing) => ({ provider: billing?.provider, account: billing?.account })),
    ).toEqual([
      { provider: 'anthropic', account: main.account },
      { provider: 'anthropic', account: worker.account },
    ])
    expect(activeAccountBilling()).toBeUndefined()
    await main.settle(null)
    await worker.settle(null)
  })
})
