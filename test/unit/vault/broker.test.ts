import { afterEach, describe, expect, it, vi } from 'vitest'
import { type VaultBroker } from '../../../src/core/vault/broker/broker'
import { type VaultUseLifetime } from '../../../src/core/vault/broker/ports'
import { type VaultItem } from '../../../src/shared/vault'
import { vaultPrivateReadSchema } from '../../../src/shared/vaultProtocol'
import { randomBytes } from 'node:crypto'
import { brokerFixture, cleanTaint, delayListing } from './brokerFixture'
import { use, requester, grant } from '../helpers/vault/fixtures'

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
async function observeReads(
  fixture: Awaited<ReturnType<typeof setup>>,
  observed: (item: VaultItem) => Promise<void>,
): Promise<void> {
  const open = fixture.deps.repository.open
  fixture.deps.repository.open = async (key) => {
    const store = await open(key)
    const read = store.read.bind(store)
    store.read = async (id) => {
      const item = await read(id)
      await observed(item)
      return item
    }
    return store
  }
  await fixture.broker.lock()
  await fixture.broker.unlock()
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
  it('a rejected atomic use reservation is an audited denial', async () => {
    const fixture = await setup()
    await fixture.change({ policy: { ...fixture.stored.metadata.policy, mode: 'alwaysAllow' } })
    const grant = fixture.standing()
    fixture.deps.repository.consumeGrant = () => Promise.resolve(false)
    const result = await fixture.broker.request(
      fixture.identity,
      fixture.stored.metadata.handle,
      use(),
      cleanTaint,
    )
    expect(result).toEqual({ kind: 'denied', reason: 'scope' })
    expect(fixture.records.at(-1)).toMatchObject({
      decision: 'deny',
      grantId: grant.id,
      outcome: 'denied',
    })
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
  it('the management UI may create a session-scoped grant, which never covers another session', async () => {
    const fixture = await setup()
    await fixture.change({ policy: { ...fixture.stored.metadata.policy, mode: 'alwaysAllow' } })
    const scoped = {
      ...grant(),
      target: fixture.stored.metadata.bindings[0]!,
      sessionId: fixture.identity.sessionId,
    }
    await fixture.broker.grant(fixture.peer, scoped)
    expect(fixture.grants.get(scoped.id)).toEqual(scoped)
    const allowed = await fixture.broker.request(
      fixture.identity,
      fixture.stored.metadata.handle,
      use(),
      cleanTaint,
    )
    expect(allowed.kind).toBe('ticket')
    const other = { ...fixture.identity, id: 'f'.repeat(32), sessionId: '0'.repeat(32) }
    await fixture.broker.register(fixture.peer, other, 'ask')
    const asked = await fixture.broker.request(
      other,
      fixture.stored.metadata.handle,
      use(),
      cleanTaint,
    )
    expect(asked.kind).toBe('approval')
  })
  it('a grant needs trusted management UI, zero initial count and a fresh id', async () => {
    const fixture = await setup(),
      entry = grant()
    await expect(fixture.broker.grant({ ...fixture.peer, ui: false }, entry)).rejects.toThrow()
    await expect(fixture.broker.grant(fixture.peer, { ...entry, uses: 1 })).rejects.toThrow()
    await fixture.broker.grant(fixture.peer, entry)
    await expect(fixture.broker.grant(fixture.peer, entry)).rejects.toThrow()
  })
  it('unknown handles and unregistered identities are explicit audited denials; slot failures fail closed', async () => {
    const fixture = await setup()
    expect(
      await fixture.broker.request(fixture.identity, 'secret://missing', use(), cleanTaint),
    ).toEqual({ kind: 'denied', reason: 'scope' })
    expect(fixture.records.at(-1)).toMatchObject({
      handle: 'secret://missing',
      decision: 'deny',
      outcome: 'denied',
    })
    expect(
      await fixture.broker.request(
        { ...fixture.identity, id: 'f'.repeat(32) },
        fixture.stored.metadata.handle,
        use(),
        cleanTaint,
      ),
    ).toEqual({ kind: 'denied', reason: 'peer' })
    expect(fixture.records.at(-1)).toMatchObject({ decision: 'deny' })
    await fixture.broker.lock()
    fixture.deps.unlock.unlock = () => Promise.reject(new Error('test slot unavailable'))
    expect(
      await fixture.broker.request(
        fixture.identity,
        fixture.stored.metadata.handle,
        use(),
        cleanTaint,
      ),
    ).toEqual({ kind: 'denied', reason: 'locked' })
  })
  it('first-party presence is fresh and denies a late answer from before a lock', async () => {
    const fixture = await setup(true)
    const entry = await fixture.firstParty(true)
    fixture.deps.unlock.presence = vi.fn(() => Promise.resolve(false))
    await expect(fixture.broker.firstPartyRead(fixture.peer, entry.request)).rejects.toThrow()
    await expect(fixture.broker.firstPartyRead(fixture.peer, entry.request)).rejects.toThrow()
    expect(fixture.deps.unlock.presence).toHaveBeenCalledTimes(2)
    const waiting = Promise.withResolvers<boolean>()
    fixture.deps.unlock.presence = vi.fn(() => waiting.promise)
    const read = fixture.broker.firstPartyRead(fixture.peer, entry.request)
    const observed = expect(read).rejects.toThrow()
    await vi.waitFor(() => {
      expect(fixture.deps.unlock.presence).toHaveBeenCalledOnce()
    })
    await fixture.broker.lock()
    await fixture.broker.unlock()
    waiting.resolve(true)
    await observed
  })
  it.each(['lock', 'item'] as const)(
    '%s erases pending first-party material before presence returns',
    async (kind) => {
      const fixture = await setup(true)
      const entry = await fixture.firstParty(true)
      let held: Uint8Array = new Uint8Array()
      await observeReads(fixture, (item) => {
        if (item.material.kind === 'apiKey') held = item.material.value
        return Promise.resolve()
      })
      const waiting = Promise.withResolvers<boolean>()
      fixture.deps.unlock.presence = vi.fn(() => waiting.promise)
      const result = fixture.broker.firstPartyRead(fixture.peer, entry.request)
      const observed = expect(result).rejects.toThrow()
      try {
        await vi.waitFor(() => {
          expect(fixture.deps.unlock.presence).toHaveBeenCalledOnce()
        })
        fixture.notify('item', 'f'.repeat(32))
        expect(held.some((byte) => byte !== 0)).toBe(true)
        if (kind === 'lock') await fixture.broker.lock()
        else fixture.notify('item', entry.request.itemId)
        expect(held.byteLength).toBeGreaterThan(0)
        expect(held.every((byte) => byte === 0)).toBe(true)
      } finally {
        waiting.resolve(true)
        await observed
      }
    },
  )
  it('a lock during first-party reading erases the late buffer before any presence prompt', async () => {
    const fixture = await setup(true),
      entry = await fixture.firstParty(true),
      waiting = Promise.withResolvers<undefined>()
    let held: Uint8Array = new Uint8Array()
    await observeReads(fixture, async (item) => {
      if (item.material.kind === 'apiKey') held = item.material.value
      await waiting.promise
    })
    const result = fixture.broker.firstPartyRead(fixture.peer, entry.request),
      observed = expect(result).rejects.toThrow()
    try {
      await vi.waitFor(() => {
        expect(held.some((byte) => byte !== 0)).toBe(true)
      })
      await fixture.broker.lock()
    } finally {
      waiting.resolve(undefined)
      await observed
    }
    expect(held.every((byte) => byte === 0)).toBe(true)
    expect(fixture.deps.unlock.presence).not.toHaveBeenCalled()
  })
  it('lock during the final first-party metadata check rejects without returning erased material', async () => {
    const fixture = await setup(true),
      entry = await fixture.firstParty(),
      delayed = await delayListing(fixture)
    delayed.begin()
    const result = fixture.broker.firstPartyRead(fixture.peer, entry.request)
    await delayed.entered
    await fixture.broker.lock()
    delayed.release()
    await expect(result).rejects.toThrow()
  })
})
