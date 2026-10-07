import { afterEach, describe, expect, it, vi } from 'vitest'
import { type VaultBroker } from '../../../src/core/vault/broker/broker'
import {
  type VaultStorePort,
  type VaultTicket,
  vaultUseSchema,
  vaultBindingSchema,
} from '../../../src/shared/vault'
import { VAULT_APPROVAL_TTL_MS } from '../../../src/shared/constants'
import { brokerFixture, cleanTaint, delayListing } from './brokerFixture'
import { use } from '../helpers/vault/fixtures'

const brokers: VaultBroker[] = []
afterEach(async () => {
  const closing = brokers.splice(0).map((broker) => broker.dispose())
  await Promise.all(closing)
})
async function setup() {
  const fixture = await brokerFixture()
  brokers.push(fixture.broker)
  return fixture
}
async function request(fixture: Awaited<ReturnType<typeof setup>>) {
  return await fixture.broker.request(
    fixture.identity,
    fixture.stored.metadata.handle,
    use(),
    cleanTaint,
  )
}
async function standing(fixture: Awaited<ReturnType<typeof setup>>) {
  await fixture.change({ policy: { ...fixture.stored.metadata.policy, mode: 'alwaysAllow' } })
  return fixture.standing()
}
async function ticket(fixture: Awaited<ReturnType<typeof setup>>): Promise<VaultTicket> {
  const result = await request(fixture)
  if (result.kind !== 'ticket') throw new Error('expected standing ticket')
  return result.ticket
}
async function kindOf(result: Promise<{ kind: string }>): Promise<string> {
  const resolved = await result
  return resolved.kind
}
function lifetime() {
  return { close: vi.fn(), terminate: vi.fn(() => Promise.resolve(true)) }
}
async function materialDenied(fixture: Awaited<ReturnType<typeof setup>>, entry: VaultTicket) {
  const destination = vi.fn(() => Promise.resolve())
  await expect(
    fixture.broker.withApprovedMaterial(entry.id, fixture.identity.id, use(), destination),
  ).rejects.toThrow()
  expect(destination).not.toHaveBeenCalled()
}

describe('RVM109B lifecycle regressions', () => {
  it('P1-1 disclosure cannot express a model or agent recipient', () => {
    for (const recipient of ['model', 'agent', 'provider', 'context']) {
      expect(vaultUseSchema.safeParse({ kind: 'disclosure', recipient }).success).toBe(false)
      expect(vaultBindingSchema.safeParse({ kind: 'disclosure', recipient }).success).toBe(false)
    }
    expect(vaultUseSchema.safeParse({ kind: 'disclosure', recipient: 'person' }).success).toBe(true)
  })
  it('P1-1 person disclosure requires fresh presence even on a non-presence item', async () => {
    const fixture = await setup()
    await fixture.change({
      policy: { ...fixture.stored.metadata.policy, allowDisclosure: true },
      bindings: [{ kind: 'disclosure', recipient: 'person' }],
    })
    const use = { kind: 'disclosure', recipient: 'person' } as const
    const approval = await fixture.broker.request(
      fixture.identity,
      fixture.stored.metadata.handle,
      use,
      cleanTaint,
    )
    if (approval.kind !== 'approval') throw new Error('expected person approval')
    const answer = await fixture.broker.answer(fixture.peer, {
      requestId: approval.request.id,
      digest: approval.request.digest,
      decision: 'allowOnce',
    })
    if (answer.kind !== 'ticket') throw new Error('expected person ticket')
    fixture.deps.unlock.presence = vi.fn(() => Promise.resolve(false))
    expect(
      await fixture.broker.redeem(fixture.identity.id, answer.ticket, use, lifetime()),
    ).toEqual({ kind: 'denied', reason: 'presence' })
    expect(fixture.deps.unlock.presence).toHaveBeenCalledOnce()
    const destination = vi.fn(() => Promise.resolve())
    await expect(
      fixture.broker.withApprovedMaterial(answer.ticket.id, fixture.identity.id, use, destination),
    ).rejects.toThrow()
    expect(destination).not.toHaveBeenCalled()
  })
  it('P1-2 an answer expiring during metadata validation caches no session consent', async () => {
    const fixture = await setup()
    await fixture.change({
      policy: { ...fixture.stored.metadata.policy, mode: 'askOncePerSession' },
    })
    const delayed = await delayListing(fixture),
      approval = await request(fixture)
    if (approval.kind !== 'approval') throw new Error('expected approval')
    delayed.begin()
    const answer = fixture.broker.answer(fixture.peer, {
      requestId: approval.request.id,
      digest: approval.request.digest,
      decision: 'allowSession',
    })
    await delayed.entered
    fixture.clock.advance(VAULT_APPROVAL_TTL_MS)
    delayed.release()
    expect(await answer).toEqual({ kind: 'denied', reason: 'expired' })
    expect(await kindOf(request(fixture))).toBe('approval')
  })
  it('P1-2 expiry during the ticket audit cannot cache session consent', async () => {
    const fixture = await setup()
    await fixture.change({
      policy: { ...fixture.stored.metadata.policy, mode: 'askOncePerSession' },
    })
    const approval = await request(fixture)
    if (approval.kind !== 'approval') throw new Error('expected approval')
    const append = fixture.deps.audit.append,
      entered = Promise.withResolvers<undefined>(),
      waiting = Promise.withResolvers<undefined>()
    fixture.deps.audit.append = async (row) => {
      entered.resolve(undefined)
      await waiting.promise
      await append(row)
    }
    const answer = fixture.broker.answer(fixture.peer, {
      requestId: approval.request.id,
      digest: approval.request.digest,
      decision: 'allowSession',
    })
    await entered.promise
    fixture.clock.advance(VAULT_APPROVAL_TTL_MS)
    waiting.resolve(undefined)
    expect(await answer).toEqual({ kind: 'denied', reason: 'expired' })
    expect(await kindOf(request(fixture))).toBe('approval')
  })
  it.each(['redemption', 'release'] as const)(
    'P1-3 item expiry is enforced at %s',
    async (boundary) => {
      const fixture = await setup()
      await fixture.change({
        dates: { ...fixture.stored.metadata.dates, expiresAt: fixture.clock.now() + 100 },
      })
      await standing(fixture)
      const entry = await ticket(fixture),
        life = lifetime()
      if (boundary === 'release')
        expect(await kindOf(fixture.broker.redeem(fixture.identity.id, entry, use(), life))).toBe(
          'ticket',
        )
      fixture.clock.advance(101)
      if (boundary === 'redemption')
        expect(await fixture.broker.redeem(fixture.identity.id, entry, use(), life)).toEqual({
          kind: 'denied',
          reason: 'expired',
        })
      else await materialDenied(fixture, entry)
    },
  )
  it('P1-3 grant expiry between redemption and material release denies the destination', async () => {
    const fixture = await setup(),
      grant = await standing(fixture)
    grant.expiresAt = fixture.clock.now() + 100
    const entry = await ticket(fixture)
    expect(await kindOf(fixture.broker.redeem(fixture.identity.id, entry, use(), lifetime()))).toBe(
      'ticket',
    )
    fixture.clock.advance(101)
    await materialDenied(fixture, entry)
  })
  it('P1-4 a failed epoch write still defeats an in-flight unlock', async () => {
    const fixture = await setup()
    await fixture.broker.lock()
    const unlock = fixture.deps.unlock.unlock,
      waiting = Promise.withResolvers<Awaited<ReturnType<typeof unlock>>>(),
      entered = Promise.withResolvers<undefined>()
    fixture.deps.unlock.unlock = () => {
      entered.resolve(undefined)
      return waiting.promise
    }
    const pending = fixture.broker.unlock(),
      observed = expect(pending).rejects.toThrow()
    await entered.promise
    const bump = fixture.deps.epoch.bump
    fixture.deps.epoch.bump = () => Promise.reject(new Error('test epoch unavailable'))
    try {
      await expect(fixture.broker.lock()).rejects.toThrow('test epoch unavailable')
    } finally {
      fixture.deps.epoch.bump = bump
      waiting.resolve(await unlock(null))
    }
    await observed
    const status = await fixture.broker.status()
    expect(status.state).toBe('locked')
  })
  it.each(['wait', 'reject'] as const)(
    'P1-5 revoke wipes every active use before termination can %s',
    async (termination) => {
      const fixture = await setup(),
        grant = await standing(fixture),
        first = await ticket(fixture),
        second = await ticket(fixture),
        one = lifetime(),
        two = lifetime()
      await fixture.broker.redeem(fixture.identity.id, first, use(), one)
      await fixture.broker.redeem(fixture.identity.id, second, use(), two)
      const destination = Promise.withResolvers<undefined>(),
        stopping = Promise.withResolvers<boolean>()
      let held: Uint8Array = new Uint8Array()
      const released = fixture.broker.withApprovedMaterial(
          second.id,
          fixture.identity.id,
          use(),
          async (item) => {
            if (item.material.kind !== 'secret') throw new Error('expected generated material')
            held = item.material.value
            await destination.promise
          },
        ),
        observed = expect(released).rejects.toThrow()
      await vi.waitFor(() => {
        expect(held.some((byte) => byte !== 0)).toBe(true)
      })
      one.terminate = vi.fn(() => stopping.promise)
      const revoked = fixture.broker.revoke(fixture.peer, grant.id)
      try {
        await vi.waitFor(() => {
          expect(one.terminate).toHaveBeenCalledOnce()
        })
        expect(two.close).toHaveBeenCalledOnce()
        expect(held.every((byte) => byte === 0)).toBe(true)
        await materialDenied(fixture, first)
      } finally {
        if (termination === 'reject') stopping.reject(new Error('test termination failed'))
        else stopping.resolve(true)
        destination.resolve(undefined)
        try {
          await revoked
        } catch {
          /* The audit and every later termination must still settle. */
        }
        await observed
      }
      expect(two.terminate).toHaveBeenCalledOnce()
      expect(fixture.records.some((row) => row.outcome === 'revoked')).toBe(true)
      if (termination === 'reject')
        expect(fixture.records.some((row) => row.outcome === 'unrecallable')).toBe(true)
    },
  )
  it('P1-5 a second material read is denied while the first termination is waiting', async () => {
    const fixture = await setup(),
      grant = await standing(fixture),
      first = await ticket(fixture),
      second = await ticket(fixture),
      one = lifetime(),
      two = lifetime(),
      waiting = Promise.withResolvers<boolean>()
    await fixture.broker.redeem(fixture.identity.id, first, use(), one)
    await fixture.broker.redeem(fixture.identity.id, second, use(), two)
    one.terminate = vi.fn(() => waiting.promise)
    const revoked = fixture.broker.revoke(fixture.peer, grant.id)
    try {
      await vi.waitFor(() => {
        expect(one.terminate).toHaveBeenCalledOnce()
      })
      await materialDenied(fixture, second)
      expect(two.close).toHaveBeenCalledOnce()
      expect(fixture.grants.has(grant.id)).toBe(false)
    } finally {
      waiting.resolve(true)
      await revoked
    }
  })
  it('P2-6 lock erases temporary unwrap and repository keys while open is pending', async () => {
    const fixture = await setup()
    await fixture.broker.lock()
    const open = fixture.deps.repository.open,
      waiting = Promise.withResolvers<undefined>(),
      entered = Promise.withResolvers<undefined>()
    let held: Uint8Array = new Uint8Array()
    fixture.deps.repository.open = async (key) => {
      held = key
      entered.resolve(undefined)
      await waiting.promise
      return await open(key)
    }
    const pending = fixture.broker.unlock(),
      observed = expect(pending).rejects.toThrow()
    await entered.promise
    try {
      await fixture.broker.lock()
      expect(held.every((byte) => byte === 0)).toBe(true)
      expect(fixture.releasedKeys.every((key) => key.every((byte) => byte === 0))).toBe(true)
    } finally {
      waiting.resolve(undefined)
      await observed
    }
  })
  it('P2-6 final epoch read failure locks the newly opened store', async () => {
    const fixture = await setup()
    await fixture.broker.lock()
    const open = fixture.deps.repository.open,
      current = fixture.deps.epoch.current
    const opened: VaultStorePort[] = []
    let isFailEpoch = false
    fixture.deps.repository.open = async (key) => {
      const store = await open(key)
      opened.push(store)
      return store
    }
    fixture.deps.audit.open = () => {
      isFailEpoch = true
      return Promise.resolve()
    }
    fixture.deps.epoch.current = () =>
      isFailEpoch ? Promise.reject(new Error('test epoch read failed')) : current()
    await expect(fixture.broker.unlock()).rejects.toThrow('test epoch read failed')
    fixture.deps.epoch.current = current
    const store = opened[0]
    if (!store) throw new Error('expected opened store')
    expect(() => store.list()).toThrow('locked')
  })
  it('P2-8 revoking A preserves B requesters and approvals', async () => {
    const fixture = await setup(),
      grant = fixture.standing(),
      other = { ...fixture.identity, id: 'f'.repeat(32) },
      metadata = {
        ...fixture.stored.metadata,
        id: 'e'.repeat(32),
        name: 'other',
        handle: 'secret://other',
      }
    await fixture.broker.register(fixture.peer, other, 'ask')
    fixture.items.set(metadata.id, { ...fixture.stored, metadata })
    await fixture.broker.lock()
    await fixture.broker.unlock()
    const pending = await fixture.broker.request(other, metadata.handle, use(), cleanTaint)
    if (pending.kind !== 'approval') throw new Error('expected unrelated approval')
    await fixture.broker.revoke(fixture.peer, grant.id)
    expect(
      await kindOf(
        fixture.broker.answer(fixture.peer, {
          requestId: pending.request.id,
          digest: pending.request.digest,
          decision: 'allowOnce',
        }),
      ),
    ).toBe('ticket')
    expect(await kindOf(fixture.broker.request(other, metadata.handle, use(), cleanTaint))).toBe(
      'approval',
    )
  })
  it.each(['lock', 'cancel'] as const)(
    'P2-9 %s explicitly audits pending approvals and unused tickets',
    async (action) => {
      const fixture = await setup(),
        pending = await request(fixture)
      if (pending.kind !== 'approval') throw new Error('expected pending approval')
      await standing(fixture)
      const unused = await ticket(fixture)
      if (action === 'lock') await fixture.broker.lock()
      else await fixture.broker.endRequester(fixture.identity.id)
      const outcomes = fixture.records
        .filter((row) => row.decision === 'deny')
        .map((row) => row.outcome)
      expect(outcomes).toEqual([
        action === 'lock' ? 'locked' : 'revoked',
        action === 'lock' ? 'locked' : 'revoked',
      ])
      expect(
        await kindOf(
          fixture.broker.answer(fixture.peer, {
            requestId: pending.request.id,
            digest: pending.request.digest,
            decision: 'allowOnce',
          }),
        ),
      ).toBe('denied')
      expect(
        await kindOf(fixture.broker.redeem(fixture.identity.id, unused, use(), lifetime())),
      ).toBe('denied')
    },
  )
})
