import { afterEach, describe, expect, it, vi } from 'vitest'
import { type VaultBroker } from '../../../src/core/vault/broker/broker'
import { type VaultUseLifetime } from '../../../src/core/vault/broker/ports'
import { vaultPrivateReadSchema } from '../../../src/shared/vaultProtocol'
import { randomBytes } from 'node:crypto'
import { brokerFixture, cleanTaint } from './brokerFixture'
import { use, requester } from '../helpers/vault/fixtures'

const brokers: VaultBroker[] = []
afterEach(async () => {
  for (const broker of brokers.splice(0)) await broker.dispose()
})
async function setup(isFirstPartyOnly = false) {
  const fixture = await brokerFixture({ firstPartyOnly: isFirstPartyOnly })
  brokers.push(fixture.broker)
  return fixture
}
async function authorized(fixture: Awaited<ReturnType<typeof setup>>, lifetime: VaultUseLifetime) {
  const result = await fixture.broker.request(
    fixture.identity,
    fixture.stored.metadata.handle,
    use(),
    cleanTaint,
  )
  if (result.kind !== 'ticket') throw new Error('expected authorized ticket')
  return await fixture.broker.redeem(fixture.identity.id, result.ticket, use(), lifetime)
}
describe('vault broker lifetime and isolation', () => {
  it('idle lock zeroes both source and held unpooled key buffers', async () => {
    const fixture = await setup()
    expect(fixture.releasedKeys.every((key) => key.every((byte) => byte === 0))).toBe(true)
    fixture.clock.advance(fixture.deps.idleMs)
    await fixture.broker.tick()
    const resolved1470_0 = await fixture.broker.status()
    expect(resolved1470_0.state).toBe('locked')
    expect(fixture.heldKeys.every((key) => key.every((byte) => byte === 0))).toBe(true)
    const resolved1619_0 = await fixture.broker.status()
    expect(resolved1619_0.lockEpoch).toBe(1)
  })
  it('manual, external epoch, screen lock and exit invalidate tickets and keys', async () => {
    const fixture = await setup()
    const ask = await fixture.broker.request(
      fixture.identity,
      fixture.stored.metadata.handle,
      use(),
      cleanTaint,
    )
    if (ask.kind !== 'approval') throw new Error('expected approval')
    const answered = await fixture.broker.answer(fixture.peer, {
      requestId: ask.request.id,
      digest: ask.request.digest,
      decision: 'allowOnce',
    })
    if (answered.kind !== 'ticket') throw new Error('expected ticket')
    await fixture.broker.lock()
    await fixture.broker.unlock()
    expect(
      await fixture.broker.redeem(fixture.identity.id, answered.ticket, use(), {
        close: vi.fn(),
        terminate: () => Promise.resolve(true),
      }),
    ).toEqual({ kind: 'denied', reason: 'replay' })
    fixture.externalLock()
    const resolved2496_0 = await fixture.broker.status()
    expect(resolved2496_0.state).toBe('locked')
    await fixture.broker.unlock()
    fixture.screenLock()
    await vi.waitFor(async () => {
      const resolved2648_0 = await fixture.broker.status()
      expect(resolved2648_0.state).toBe('locked')
    })
    await fixture.broker.unlock()
    await fixture.broker.dispose()
    expect(fixture.heldKeys.every((key) => key.every((byte) => byte === 0))).toBe(true)
    await expect(fixture.broker.unlock()).rejects.toThrow()
  })
  it('standing grant uses are spent atomically and cannot exceed the count', async () => {
    const fixture = await setup()
    await fixture.change({ policy: { ...fixture.stored.metadata.policy, mode: 'alwaysAllow' } })
    const grant = fixture.standing()
    grant.maxUses = 1
    const results = await Promise.all([
      fixture.broker.request(fixture.identity, fixture.stored.metadata.handle, use(), cleanTaint),
      fixture.broker.request(fixture.identity, fixture.stored.metadata.handle, use(), cleanTaint),
    ])
    expect(results.map((result) => result.kind)).toEqual(['ticket', 'approval'])
    expect(grant.uses).toBe(1)
  })
  it('revoke closes active connections and terminates pinned processes immediately', async () => {
    const fixture = await setup()
    await fixture.change({ policy: { ...fixture.stored.metadata.policy, mode: 'alwaysAllow' } })
    const grant = fixture.standing()
    const lifetime = { close: vi.fn(), terminate: vi.fn(() => Promise.resolve(true)) }
    const resolved3904_0 = await authorized(fixture, lifetime)
    expect(resolved3904_0.kind).toBe('ticket')
    await fixture.broker.revoke(fixture.peer, grant.id)
    expect(lifetime.close).toHaveBeenCalledOnce()
    expect(lifetime.terminate).toHaveBeenCalledOnce()
    expect(fixture.records.at(-1)).toMatchObject({ outcome: 'revoked', decision: 'deny' })
    expect(
      await fixture.broker.request(
        fixture.identity,
        fixture.stored.metadata.handle,
        use(),
        cleanTaint,
      ),
    ).toEqual({ kind: 'denied', reason: 'peer' })
  })
  it('lock during fresh per-use presence denies late approval and ends the lifetime', async () => {
    const fixture = await setup()
    await fixture.change({
      requirePresence: true,
      policy: { ...fixture.stored.metadata.policy, mode: 'alwaysAllow' },
    })
    fixture.standing()
    const pending = Promise.withResolvers<boolean>()
    const entered = vi.fn()
    fixture.deps.unlock.presence = vi.fn(() => {
      entered()
      return pending.promise
    })
    const lifetime = { close: vi.fn(), terminate: vi.fn(() => Promise.resolve(true)) }
    const redeem = authorized(fixture, lifetime)
    await vi.waitFor(() => {
      expect(entered).toHaveBeenCalledOnce()
    })
    await fixture.broker.lock()
    expect(lifetime.close).toHaveBeenCalledOnce()
    pending.resolve(true)
    expect(await redeem).toEqual({ kind: 'denied', reason: 'locked' })
  })
  it('presence prompts are fresh for every use and denial never dispatches', async () => {
    const fixture = await setup()
    await fixture.change({
      requirePresence: true,
      policy: { ...fixture.stored.metadata.policy, mode: 'alwaysAllow' },
    })
    fixture.standing()
    fixture.deps.unlock.presence = vi.fn(() => Promise.resolve(false))
    expect(
      await authorized(fixture, { close: vi.fn(), terminate: () => Promise.resolve(true) }),
    ).toEqual({ kind: 'denied', reason: 'presence' })
    expect(
      await authorized(fixture, { close: vi.fn(), terminate: () => Promise.resolve(true) }),
    ).toEqual({ kind: 'denied', reason: 'presence' })
    expect(fixture.deps.unlock.presence).toHaveBeenCalledTimes(2)
  })
  it('fallback preserves only origin-bound first-party reads; agents never use it', async () => {
    const fixture = await setup(true)
    const material = randomBytes(32)
    const metadata = {
      ...fixture.stored.metadata,
      kind: 'apiKey' as const,
      firstParty: true,
      hidden: true,
      policy: { mode: 'never' as const, unattendedAllowed: false, allowDisclosure: false },
      bindings: [{ kind: 'origin' as const, origin: 'https://example.test' }],
    }
    fixture.items.set(metadata.id, {
      metadata,
      material: { kind: 'apiKey', value: material, auth: 'bearer', origin: 'https://example.test' },
    })
    await fixture.broker.lock()
    await fixture.broker.unlock()
    const request = vaultPrivateReadSchema.parse({
      v: 1,
      kind: 'firstPartyRead',
      itemId: metadata.id,
      origin: 'https://example.test',
      client: 'model',
    })
    const read = await fixture.broker.firstPartyRead(fixture.peer, request)
    expect(read.equals(material)).toBe(true)
    read.fill(0)
    await expect(
      fixture.broker.firstPartyRead(fixture.peer, { ...request, origin: 'https://other.test' }),
    ).rejects.toThrow()
    await expect(
      fixture.broker.firstPartyRead({ ...fixture.peer, ui: false }, request),
    ).rejects.toThrow()
    expect(
      await fixture.broker.request(fixture.identity, metadata.handle, use(), cleanTaint),
    ).toEqual({ kind: 'denied', reason: 'firstPartyOnly' })
    expect(await fixture.broker.list(fixture.identity)).toEqual([])
    const resolved7372_0 = await fixture.broker.status()
    expect(resolved7372_0.state).toBe('firstPartyOnly')
    expect(JSON.stringify(fixture.records)).not.toContain(material.toString('hex'))
  })
  it('registration rejects foreign hosts and impersonated unlaunched requesters', async () => {
    const fixture = await setup()
    await expect(
      fixture.broker.register(
        { ...fixture.peer, processId: 999 },
        { ...requester(), id: 'f'.repeat(32) },
        'ask',
      ),
    ).rejects.toThrow()
    expect(
      await fixture.broker.request(
        { ...requester(), role: { kind: 'subagent' } },
        fixture.stored.metadata.handle,
        use(),
        cleanTaint,
      ),
    ).toEqual({ kind: 'denied', reason: 'peer' })
  })
})
