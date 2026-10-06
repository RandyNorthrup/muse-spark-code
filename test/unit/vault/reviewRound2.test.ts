import { afterEach, describe, expect, it, vi } from 'vitest'
import { type VaultBroker } from '../../../src/core/vault/broker/broker'
import { type VaultBrokerDeps } from '../../../src/core/vault/broker/ports'
import { type VaultTicket } from '../../../src/shared/vault'
import { brokerFixture, cleanTaint, delayListing } from './brokerFixture'
import { VAULT_LOCK_DRAIN_MS } from '../../../src/shared/constants'
import { realAudit } from './auditFixture'
import { grant, use } from '../helpers/vault/fixtures'

const brokers = new Set<VaultBroker>()
afterEach(async () => {
  vi.useRealTimers()
  const closing = [...brokers].map((broker) => broker.dispose())
  brokers.clear()
  await Promise.all(closing)
})
async function setup(options: Partial<VaultBrokerDeps> = {}) {
  const fixture = await brokerFixture(options)
  brokers.add(fixture.broker)
  return fixture
}
async function request(fixture: Awaited<ReturnType<typeof setup>>) {
  const { broker, identity, stored } = fixture
  return await broker.request(identity, stored.metadata.handle, use(), cleanTaint)
}
async function standing(fixture: Awaited<ReturnType<typeof setup>>) {
  await fixture.change({ policy: { ...fixture.stored.metadata.policy, mode: 'alwaysAllow' } })
  return fixture.standing()
}
function lifetime() {
  return { close: vi.fn(), terminate: vi.fn(() => Promise.resolve(true)) }
}
async function activeLifetime(fixture: Awaited<ReturnType<typeof setup>>) {
  await standing(fixture)
  const ticket = await request(fixture)
  if (ticket.kind !== 'ticket') throw new Error('expected ticket')
  const life = lifetime()
  const admitted = await fixture.broker.redeem(fixture.identity.id, ticket.ticket, use(), life)
  expect(admitted.kind).toBe('ticket')
  return life
}
async function cancelledUse(fixture: Awaited<ReturnType<typeof setup>>) {
  const life = await activeLifetime(fixture),
    entered = Promise.withResolvers<undefined>(),
    waiting = Promise.withResolvers<boolean>()
  life.terminate = vi.fn(() => {
    entered.resolve(undefined)
    return waiting.promise
  })
  const cleanup = fixture.broker.endRequester(fixture.identity.id)
  await entered.promise
  return { cleanup, waiting }
}
async function assertNoMaterial(fixture: Awaited<ReturnType<typeof setup>>, ticket?: VaultTicket) {
  const destination = vi.fn(() => Promise.resolve())
  if (ticket) {
    await fixture.broker.redeem(fixture.identity.id, ticket, use(), lifetime())
    try {
      await fixture.broker.withApprovedMaterial(ticket.id, fixture.identity.id, use(), destination)
    } catch {
      /* Refusal is expected; the destination must never receive material. */
    }
  }
  expect(destination.mock.calls.length).toBe(0)
}

describe('RVM109B2 authority ownership', () => {
  it.each(['standing', 'UI'] as const)(
    'P1 cancellation and stricter re-registration refuse the suspended %s request',
    async (route) => {
      const fixture = await setup()
      if (route === 'standing') await standing(fixture)
      const delayed = await delayListing(fixture)
      delayed.begin()
      const pending = request(fixture)
      await delayed.entered
      await fixture.broker.endRequester(fixture.identity.id)
      const registered = fixture.broker.register(fixture.peer, fixture.identity, 'none')
      delayed.release()
      const result = await pending
      await registered
      if (result.kind === 'approval') {
        const answered = await fixture.broker.answer(fixture.peer, {
          requestId: result.request.id,
          digest: result.request.digest,
          decision: 'allowOnce',
        })
        await assertNoMaterial(fixture, answered.kind === 'ticket' ? answered.ticket : undefined)
        expect(answered.kind).toBe('denied')
      } else await assertNoMaterial(fixture, result.kind === 'ticket' ? result.ticket : undefined)
      expect(result.kind).toBe('denied')
      expect(fixture.deps.onApproval).not.toHaveBeenCalled()
      expect(await request(fixture)).toEqual({ kind: 'denied', reason: 'ceiling' })
    },
  )
  it('P1 an existing UI answer cannot survive cancellation and re-registration', async () => {
    const fixture = await setup(),
      delayed = await delayListing(fixture),
      approval = await request(fixture)
    if (approval.kind !== 'approval') throw new Error('expected approval')
    delayed.begin()
    const answered = fixture.broker.answer(fixture.peer, {
      requestId: approval.request.id,
      digest: approval.request.digest,
      decision: 'allowOnce',
    })
    await delayed.entered
    await fixture.broker.endRequester(fixture.identity.id)
    const registered = fixture.broker.register(fixture.peer, fixture.identity, 'none')
    delayed.release()
    const result = await answered
    await registered
    expect(result.kind).toBe('denied')
    await assertNoMaterial(fixture, result.kind === 'ticket' ? result.ticket : undefined)
    expect(
      await fixture.broker.answer(fixture.peer, {
        requestId: approval.request.id,
        digest: approval.request.digest,
        decision: 'allowOnce',
      }),
    ).toEqual({ kind: 'denied', reason: 'replay' })
  })
  it.each(['lock', 'lock-unlock'] as const)(
    'P2-3 a grant suspended before %s cannot persist later authority',
    async (action) => {
      const fixture = await setup(),
        entry = grant(),
        entered = Promise.withResolvers<undefined>(),
        waiting = Promise.withResolvers<undefined>(),
        snapshot = fixture.deps.repository.grants
      fixture.deps.repository.grants = async () => {
        const result = await snapshot()
        entered.resolve(undefined)
        await waiting.promise
        return result
      }
      const pending = fixture.broker.grant(fixture.peer, entry)
      const observed = (async () => {
        try {
          await pending
          return 'persisted'
        } catch {
          return 'refused'
        }
      })()
      await entered.promise
      await fixture.broker.lock()
      if (action === 'lock-unlock') await fixture.broker.unlock()
      waiting.resolve(undefined)
      const outcome = await observed
      expect(outcome).toBe('refused')
      expect(fixture.grants.has(entry.id)).toBe(false)
    },
  )
  it('P2-2 Lock owns removed requester cleanup until its terminal audit settles', async () => {
    const log = realAudit(),
      fixture = await setup({ audit: log.audit })
    const { cleanup, waiting } = await cancelledUse(fixture)
    let isLocked = false
    const locked = (async () => {
      await fixture.broker.lock()
      isLocked = true
    })()
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    expect(isLocked).toBe(false)
    waiting.resolve(false)
    await Promise.all([cleanup, locked])
    expect(log.outcomes()).toEqual(['pending', 'pending', 'unrecallable'])
    expect(log.generation()).toBe(3)
  })
  it('P2-2 Lock owns the authorization file append and records its locked denial', async () => {
    const log = realAudit(),
      fixture = await setup({ audit: log.audit })
    log.hold()
    const pending = request(fixture)
    await log.entered
    const locked = fixture.broker.lock()
    log.release()
    const result = await pending
    await locked
    expect(result).toEqual({ kind: 'denied', reason: 'locked' })
    expect(log.outcomes()).toEqual(['pending', 'locked'])
    expect(log.generation()).toBe(2)
    expect(fixture.deps.onApproval).not.toHaveBeenCalled()
  })
  it('P2-2 a failed terminal append is surfaced by Lock', async () => {
    const log = realAudit(),
      fixture = await setup({ audit: log.audit })
    const result = await request(fixture)
    expect(result.kind).toBe('approval')
    log.fail(true)
    try {
      await expect(fixture.broker.lock()).rejects.toThrow('test terminal append failed')
    } finally {
      log.fail(false)
    }
    expect(fixture.deps.onAuditFailure).toHaveBeenCalled()
    // The failed writer remains closed. The caller saw the failure; no success is claimed.
    brokers.delete(fixture.broker)
    try {
      await fixture.broker.dispose()
    } catch {
      /* The terminal failure remains observable. */
    }
  })
  it('P2-2 bounded Lock records retained liability for cleanup that never responds', async () => {
    const log = realAudit(),
      fixture = await setup({ audit: log.audit })
    const { cleanup, waiting } = await cancelledUse(fixture)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const locked = fixture.broker.lock(),
      observed = expect(locked).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(VAULT_LOCK_DRAIN_MS)
    await observed
    expect(log.outcomes()).toEqual(['pending', 'pending', 'unrecallable'])
    expect(fixture.heldKeys.every((key) => key.every((byte) => byte === 0))).toBe(true)
    waiting.resolve(false)
    await cleanup
    vi.useRealTimers()
  })
  it('P2-2 a timed-out acknowledgement completes its committed row before the terminal outcome', async () => {
    const log = realAudit(),
      fixture = await setup({ audit: log.audit })
    log.hold()
    const pending = request(fixture),
      denied = expect(pending).resolves.toEqual({ kind: 'denied', reason: 'locked' })
    await log.entered
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const locked = fixture.broker.lock(),
      observed = expect(locked).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(VAULT_LOCK_DRAIN_MS * 2)
    await observed
    log.release()
    await denied
    expect(log.generation()).toBe(2)
    expect(log.outcomes()).toEqual(['pending', 'locked'])
    expect(fixture.deps.onApproval).not.toHaveBeenCalled()
    vi.useRealTimers()
    brokers.delete(fixture.broker)
    try {
      await fixture.broker.dispose()
    } catch {
      /* The failed terminal append is still surfaced, not accepted. */
    }
  })
  it.each(['cancel', 'lock-unlock'] as const)(
    'P2-3 requester registration suspended before %s cannot install stale authority',
    async (action) => {
      const fixture = await setup(),
        who = { ...fixture.identity, id: 'f'.repeat(32) },
        launched = fixture.deps.identity.verifyLaunched,
        entered = Promise.withResolvers<undefined>(),
        waiting = Promise.withResolvers<undefined>()
      fixture.deps.identity.verifyLaunched = async (peer, registration) => {
        const isResult = await launched(peer, registration)
        entered.resolve(undefined)
        await waiting.promise
        return isResult
      }
      const pending = fixture.broker.register(fixture.peer, who, 'ask'),
        observed = expect(pending).rejects.toThrow()
      await entered.promise
      if (action === 'cancel') await fixture.broker.endRequester(who.id)
      else {
        await fixture.broker.lock()
        await fixture.broker.unlock()
      }
      waiting.resolve(undefined)
      await observed
      expect(
        await fixture.broker.request(who, fixture.stored.metadata.handle, use(), cleanTaint),
      ).toEqual({ kind: 'denied', reason: 'peer' })
    },
  )
  it('P2-3 simultaneous grants share the serialized management owner', async () => {
    const fixture = await setup(),
      entry = grant()
    const results = await Promise.allSettled([
      fixture.broker.grant(fixture.peer, entry),
      fixture.broker.grant(fixture.peer, entry),
    ])
    expect(results.filter((result) => result.status === 'fulfilled').length).toBe(1)
    expect(results.filter((result) => result.status === 'rejected').length).toBe(1)
  })
  it('P2-3 the repository commit guard refuses a grant whose writer waited across Lock', async () => {
    const fixture = await setup(),
      entry = grant(),
      save = fixture.deps.repository.saveGrant,
      entered = Promise.withResolvers<undefined>(),
      waiting = Promise.withResolvers<undefined>()
    let isCommitted = false
    fixture.deps.repository.saveGrant = async (pending, authorize) => {
      entered.resolve(undefined)
      await waiting.promise
      try {
        await save(pending, authorize)
      } finally {
        isCommitted = fixture.grants.has(entry.id)
      }
    }
    const pending = fixture.broker.grant(fixture.peer, entry),
      observed = expect(pending).rejects.toThrow()
    await entered.promise
    await fixture.broker.lock()
    await fixture.broker.unlock()
    waiting.resolve(undefined)
    await observed
    expect(fixture.grants.has(entry.id)).toBe(false)
    expect(isCommitted).toBe(false)
  })
  it('P1 an in-flight list retains its requester incarnation after a stricter registration', async () => {
    const fixture = await setup(),
      delayed = await delayListing(fixture)
    delayed.begin()
    const pending = fixture.broker.list(fixture.identity)
    await delayed.entered
    await fixture.broker.endRequester(fixture.identity.id)
    await fixture.broker.register(fixture.peer, fixture.identity, 'none')
    delayed.release()
    const listed = await pending
    expect(listed.length).toBe(0)
  })
  it('P2-2 Lock terminally audits a request minted before its grant snapshot returns', async () => {
    const log = realAudit(),
      fixture = await setup({ audit: log.audit }),
      snapshot = fixture.deps.repository.grants,
      entered = Promise.withResolvers<undefined>(),
      waiting = Promise.withResolvers<undefined>()
    fixture.deps.repository.grants = async () => {
      const result = await snapshot()
      entered.resolve(undefined)
      await waiting.promise
      return result
    }
    const pending = request(fixture)
    await entered.promise
    await fixture.broker.lock()
    waiting.resolve(undefined)
    expect(await pending).toEqual({ kind: 'denied', reason: 'locked' })
    expect(log.outcomes()).toEqual(['locked'])
  })
  it('P2-2 cancellation during an authorization append still records a terminal denial', async () => {
    const log = realAudit(),
      fixture = await setup({ audit: log.audit })
    log.hold()
    const pending = request(fixture)
    await log.entered
    await fixture.broker.endRequester(fixture.identity.id)
    log.release()
    expect(await pending).toEqual({ kind: 'denied', reason: 'peer' })
    expect(log.outcomes()).toEqual(['pending', 'denied'])
    expect(log.generation()).toBe(2)
  })
})
