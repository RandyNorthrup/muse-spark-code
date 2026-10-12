import { poolMetadata } from './helpers/accounts/metadata'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { AccountRequestWriter, activeAccountBilling } from '../../src/core/accounts/requestWriter'
import { AccountStore } from '../../src/core/providers/accounts'
import type { AccountCredentialVault } from '../../src/core/providers/accountCredentialRecord'
import { Usd } from '../../src/shared/usd'
import { poolRig, poolRequest } from './helpers/accounts/pool'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'

const ORIGIN = 'https://provider.invalid'
function rig() {
  const t = poolRig()
  const keys = new Map(t.rows.map((row) => [row.id, `fake-only-${row.id}`]))
  const metadata = poolMetadata(t.rows, ORIGIN)
  const vault: AccountCredentialVault = {
    read: (binding) =>
      Promise.resolve({
        ...binding,
        v: 1,
        auth: 'apiKey',
        secret: keys.get(binding.account) ?? '',
      }),
    readForRemoval: () => Promise.resolve(undefined),
    write: (binding, credential) => {
      keys.set(binding.account, credential.secret)
      return Promise.resolve()
    },
    remove: (binding) => {
      keys.delete(binding.account)
      return Promise.resolve()
    },
  }
  const store = new AccountStore(metadata, vault)
  const client = fakeModelApiClient(fakeModelApi(), {
    trace: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })
  const createClient = vi.fn<ConstructorParameters<typeof AccountRequestWriter>[0]['createClient']>(
    (_binding, apiKey) => Promise.resolve(client.withAccountKey(apiKey)),
  )
  const writer = new AccountRequestWriter({
    store,
    pool: t.pool,
    refresh: () => Promise.resolve(),
    createClient,
  })
  return { ...t, store, writer, createClient }
}

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
