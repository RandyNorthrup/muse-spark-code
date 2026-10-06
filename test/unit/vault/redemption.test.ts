import { afterEach, describe, expect, it, vi } from 'vitest'
import { type VaultItem } from '../../../src/shared/vault'
import { type VaultBroker } from '../../../src/core/vault/broker/broker'
import { VAULT_APPROVAL_TTL_MS } from '../../../src/shared/constants'
import { brokerFixture, cleanTaint } from './brokerFixture'
import { use } from '../helpers/vault/fixtures'

const engines = new Set<VaultBroker>()
afterEach(async () => {
  for (const engine of engines) await engine.dispose()
  engines.clear()
})
async function setup() {
  const fixture = await brokerFixture()
  engines.add(fixture.broker)
  await fixture.change({ policy: { ...fixture.stored.metadata.policy, mode: 'alwaysAllow' } })
  const grant = fixture.standing()
  const result = await fixture.broker.request(
    fixture.identity,
    fixture.stored.metadata.handle,
    use(),
    cleanTaint,
  )
  if (result.kind !== 'ticket') throw new Error('expected ticket')
  const lifetime = { close: vi.fn(), terminate: vi.fn(() => Promise.resolve(true)) }
  return { ...fixture, grant, ticket: result.ticket, lifetime }
}
async function redeem(fixture: Awaited<ReturnType<typeof setup>>) {
  const result = await fixture.broker.redeem(
    fixture.identity.id,
    fixture.ticket,
    use(),
    fixture.lifetime,
  )
  expect(result.kind).toBe('ticket')
}
function secret(item: VaultItem): Uint8Array {
  if (item.material.kind !== 'secret') throw new Error('expected secret')
  return item.material.value
}
describe('broker-owned approved material', () => {
  it('rechecks grant expiry, target and revocation at redemption', async () => {
    const fixture = await setup()
    fixture.grant.expiresAt = fixture.clock.now()
    const expired = await fixture.broker.redeem(
      fixture.identity.id,
      fixture.ticket,
      use(),
      fixture.lifetime,
    )
    expect(expired).toEqual({ kind: 'denied', reason: 'scope' })
    const widened = await setup()
    widened.grant.target = { kind: 'environment', commandDigest: '0'.repeat(64), names: ['OTHER'] }
    expect(
      await widened.broker.redeem(widened.identity.id, widened.ticket, use(), widened.lifetime),
    ).toEqual({ kind: 'denied', reason: 'scope' })
    const removed = await setup()
    removed.grants.delete(removed.grant.id)
    expect(
      await removed.broker.redeem(removed.identity.id, removed.ticket, use(), removed.lifetime),
    ).toEqual({ kind: 'denied', reason: 'scope' })
  })
  it('only the actual requester and digest may receive a single material release, erased after use', async () => {
    const fixture = await setup()
    await redeem(fixture)
    const run = vi.fn(() => Promise.resolve())
    await expect(
      fixture.broker.withApprovedMaterial(fixture.ticket.id, 'f'.repeat(32), use(), run),
    ).rejects.toThrow()
    await expect(
      fixture.broker.withApprovedMaterial(
        fixture.ticket.id,
        fixture.identity.id,
        { ...use(), names: ['OTHER'] },
        run,
      ),
    ).rejects.toThrow()
    let held: Uint8Array = new Uint8Array()
    await fixture.broker.withApprovedMaterial(
      fixture.ticket.id,
      fixture.identity.id,
      use(),
      async (item) => {
        held = secret(item)
        expect(held.some((byte) => byte !== 0)).toBe(true)
        await run()
      },
    )
    expect(held.byteLength).toBeGreaterThan(0)
    expect(held.every((byte) => byte === 0)).toBe(true)
    await expect(
      fixture.broker.withApprovedMaterial(fixture.ticket.id, fixture.identity.id, use(), run),
    ).rejects.toThrow()
    expect(run).toHaveBeenCalledOnce()
  })
  it('callback failure and an expired admitted ticket never leave reusable material', async () => {
    const fixture = await setup()
    await redeem(fixture)
    let held: Uint8Array = new Uint8Array()
    await expect(
      fixture.broker.withApprovedMaterial(fixture.ticket.id, fixture.identity.id, use(), (item) => {
        held = secret(item)
        return Promise.reject(new Error('test destination failed'))
      }),
    ).rejects.toThrow('test destination failed')
    expect(held.every((byte) => byte === 0)).toBe(true)
    const expired = await setup()
    await redeem(expired)
    expired.clock.advance(VAULT_APPROVAL_TTL_MS)
    const run = vi.fn(() => Promise.resolve())
    await expect(
      expired.broker.withApprovedMaterial(expired.ticket.id, expired.identity.id, use(), run),
    ).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
  })
  it('metadata changed after admission is refused before a destination sees material', async () => {
    const fixture = await setup()
    await redeem(fixture)
    await fixture.change({ policy: { ...fixture.stored.metadata.policy, mode: 'never' } })
    const run = vi.fn(() => Promise.resolve())
    await expect(
      fixture.broker.withApprovedMaterial(fixture.ticket.id, fixture.identity.id, use(), run),
    ).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
  })
  it.each(['lock', 'grant', 'item'] as const)(
    '%s during a destination call erases material immediately and rejects its late completion',
    async (kind) => {
      const fixture = await setup()
      await redeem(fixture)
      const waiting = Promise.withResolvers<undefined>()
      let held: Uint8Array = new Uint8Array()
      const dispatched = fixture.broker.withApprovedMaterial(
        fixture.ticket.id,
        fixture.identity.id,
        use(),
        async (item) => {
          held = secret(item)
          await waiting.promise
        },
      )
      const observed = expect(dispatched).rejects.toThrow()
      await vi.waitFor(() => {
        expect(held.some((byte) => byte !== 0)).toBe(true)
      })
      if (kind === 'lock') await fixture.broker.lock()
      else fixture.notify(kind, kind === 'grant' ? fixture.grant.id : fixture.stored.metadata.id)
      await vi.waitFor(() => {
        expect(fixture.lifetime.close).toHaveBeenCalledOnce()
        expect(held.every((byte) => byte === 0)).toBe(true)
      })
      waiting.resolve(undefined)
      await observed
      expect(fixture.lifetime.terminate).toHaveBeenCalledOnce()
    },
  )
})
