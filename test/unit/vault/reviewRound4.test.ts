import { afterEach, describe, expect, it, vi } from 'vitest'
import { type VaultBroker } from '../../../src/core/vault/broker/broker'
import { type VaultUseLifetime } from '../../../src/core/vault/broker/ports'
import { VAULT_APPROVAL_TTL_MS } from '../../../src/shared/constants'
import { brokerFixture, cleanTaint } from './brokerFixture'
import { realAudit } from './auditFixture'
import { use } from '../helpers/vault/fixtures'

const brokers: VaultBroker[] = []
afterEach(async () => {
  for (const broker of brokers.splice(0)) await broker.dispose()
})
async function setup() {
  const log = realAudit()
  const fixture = await brokerFixture({ audit: log.audit })
  brokers.push(fixture.broker)
  await fixture.change({ policy: { ...fixture.stored.metadata.policy, mode: 'alwaysAllow' } })
  fixture.standing()
  return { ...fixture, log }
}
type Fixture = Awaited<ReturnType<typeof setup>>
const lifetime = () => ({ close: vi.fn(), terminate: vi.fn(() => Promise.resolve(true)) })
async function ticket(fixture: Fixture) {
  const result = await fixture.broker.request(
    fixture.identity,
    fixture.stored.metadata.handle,
    use(),
    cleanTaint,
  )
  if (result.kind !== 'ticket') throw new Error('expected granted use')
  return result.ticket
}
function material(fixture: Fixture, id: string, run = vi.fn(() => Promise.resolve())) {
  return fixture.broker.withApprovedMaterial(id, fixture.identity.id, use(), run)
}
async function redeemed(fixture: Fixture, life: VaultUseLifetime) {
  const entry = await ticket(fixture)
  const result = await fixture.broker.redeem(fixture.identity.id, entry, use(), life)
  expect(result.kind).toBe('ticket')
  return entry
}
async function hasSucceeded(
  pending: Promise<unknown>,
  done: (hasSucceeded: boolean) => void = () => undefined,
) {
  let hasSucceeded = false
  try {
    await pending
    hasSucceeded = true
  } catch {
    // Regressions assert the result; mutations must not leave unhandled rejections.
  }
  done(hasSucceeded)
  return hasSucceeded
}

describe('RVM109B4 failure and terminal ownership', () => {
  it('P2-3 a new Finish after disposal is refused rather than treated as terminal cleanup', async () => {
    const fixture = await setup()
    await fixture.broker.dispose()
    brokers.splice(brokers.indexOf(fixture.broker), 1)
    await expect(fixture.broker.finish('1'.repeat(32), false)).rejects.toThrow()
  })
  it('P1 throwing lifetime close cannot strand plaintext or stop later effects', async () => {
    const fixture = await setup(),
      life = lifetime(),
      entry = await redeemed(fixture, life),
      entered = Promise.withResolvers<undefined>(),
      destination = Promise.withResolvers<undefined>()
    let held = new Uint8Array()
    const pending = fixture.broker.withApprovedMaterial(
      entry.id,
      fixture.identity.id,
      use(),
      async (item) => {
        if (item.material.kind !== 'secret') throw new Error('expected generated secret')
        held = item.material.value
        entered.resolve(undefined)
        await destination.promise
      },
    )
    const observed = hasSucceeded(pending)
    await entered.promise
    expect(held.some((byte) => byte !== 0)).toBe(true)
    life.close.mockImplementation(() => {
      throw new Error('test close failed')
    })
    fixture.deps.onAuditFailure = vi.fn(() => {
      throw new Error('test notice failed')
    })
    try {
      await fixture.broker.endRequester(fixture.identity.id)
      expect(held.every((byte) => byte === 0)).toBe(true)
      expect(life.terminate).toHaveBeenCalledOnce()
      expect(fixture.log.outcomes()).toEqual(['pending', 'pending', 'revoked'])
      await fixture.broker.lock()
      expect(fixture.deps.onLocked).toHaveBeenCalled()
    } finally {
      life.close.mockReset()
      fixture.deps.onAuditFailure = vi.fn()
      destination.resolve(undefined)
      held.fill(0)
    }
    expect(await observed).toBe(false)
  })

  it('P2-1 failed redemption audit revokes admission and closes its lifetime', async () => {
    const fixture = await setup(),
      entry = await ticket(fixture),
      life = lifetime(),
      destination = vi.fn(() => Promise.resolve())
    fixture.log.fail(true)
    try {
      await expect(fixture.broker.redeem(fixture.identity.id, entry, use(), life)).rejects.toThrow()
      expect(life.close).toHaveBeenCalledOnce()
      await expect(material(fixture, entry.id, destination)).rejects.toThrow()
      expect(destination).not.toHaveBeenCalled()
      expect(fixture.log.outcomes()).toEqual(['pending'])
      expect(fixture.deps.onAuditFailure).toHaveBeenCalled()
    } finally {
      fixture.log.fail(false)
    }
  })

  it('P2-1 material cannot start before the redemption audit succeeds', async () => {
    const fixture = await setup(),
      entry = await ticket(fixture),
      entered = Promise.withResolvers<undefined>(),
      waiting = Promise.withResolvers<undefined>(),
      scrub = fixture.deps.scrub,
      destination = vi.fn(() => Promise.resolve())
    let isHolding = true
    fixture.deps.scrub = async (text) => {
      if (isHolding) {
        entered.resolve(undefined)
        await waiting.promise
      }
      return await scrub(text)
    }
    const redemption = fixture.broker.redeem(fixture.identity.id, entry, use(), lifetime())
    await entered.promise
    try {
      await expect(material(fixture, entry.id, destination)).rejects.toThrow()
      expect(destination).not.toHaveBeenCalled()
    } finally {
      isHolding = false
      waiting.resolve(undefined)
    }
    const result = await redemption
    expect(result.kind).toBe('ticket')
    await material(fixture, entry.id, destination)
    expect(destination).toHaveBeenCalledOnce()
  })

  it.each([true, false])(
    'P2-2 Finish(%s) invalidates material suspended in store read',
    async (succeeded) => {
      const fixture = await setup(),
        open = fixture.deps.repository.open,
        entered = Promise.withResolvers<undefined>(),
        waiting = Promise.withResolvers<undefined>()
      let held = new Uint8Array()
      fixture.deps.repository.open = async (key) => {
        const store = await open(key),
          read = store.read.bind(store)
        store.read = async (id) => {
          const value = await read(id)
          if (value.material.kind !== 'secret') throw new Error('expected held secret')
          held = value.material.value
          entered.resolve(undefined)
          await waiting.promise
          return value
        }
        return store
      }
      await fixture.broker.lock()
      await fixture.broker.unlock()
      let isRetired = false
      const entry = await redeemed(fixture, lifetime()),
        destination = vi.fn(() => Promise.resolve()),
        pending = material(fixture, entry.id, destination),
        observed = hasSucceeded(pending, (hasSucceeded) => {
          isRetired = !hasSucceeded
        })
      await entered.promise
      try {
        await fixture.broker.finish(entry.id, succeeded)
        expect(isRetired).toBe(true)
        expect(fixture.log.outcomes()).toEqual([
          'pending',
          'pending',
          succeeded ? 'succeeded' : 'failed',
        ])
      } finally {
        waiting.resolve(undefined)
      }
      expect(await observed).toBe(false)
      expect(destination).not.toHaveBeenCalled()
      await vi.waitFor(() => {
        expect(held.every((byte) => byte === 0)).toBe(true)
      })
    },
  )

  it('P2-3 expiry during requester termination settles one terminal audit without self-waiting', async () => {
    const fixture = await setup(),
      life = lifetime(),
      stopping = Promise.withResolvers<boolean>(),
      entered = Promise.withResolvers<undefined>()
    life.terminate.mockImplementation(() => {
      entered.resolve(undefined)
      return stopping.promise
    })
    await redeemed(fixture, life)
    let isSettled = false
    const cancelled = hasSucceeded(
      fixture.broker.endRequester(fixture.identity.id),
      (hasSucceeded) => {
        isSettled = hasSucceeded
      },
    )
    try {
      await entered.promise
      fixture.clock.advance(VAULT_APPROVAL_TTL_MS)
      await fixture.broker.tick()
      stopping.resolve(true)
      await vi.waitFor(() => {
        expect(isSettled).toBe(true)
      })
      expect(await cancelled).toBe(true)
      expect(fixture.log.outcomes()).toEqual(['pending', 'pending', 'revoked'])
      expect(life.close).toHaveBeenCalledOnce()
      expect(life.terminate).toHaveBeenCalledOnce()
    } finally {
      stopping.resolve(true)
    }
  })

  it('P2-4 cancelled automatic unlock releases the queue before obsolete unwrap returns', async () => {
    const fixture = await setup()
    await fixture.broker.lock()
    const unwrap = fixture.deps.unlock.unlock,
      entered = Promise.withResolvers<undefined>(),
      waiting = Promise.withResolvers<Awaited<ReturnType<typeof unwrap>>>()
    let fresh: Promise<void> | undefined, granted: Promise<boolean> | undefined
    let isOld = true,
      isRetired = false,
      isFresh = false,
      isGranted = false
    fixture.deps.unlock.unlock = async (slotId) => {
      if (isOld) {
        isOld = false
        entered.resolve(undefined)
        return await waiting.promise
      }
      return await unwrap(slotId)
    }
    const old = hasSucceeded(ticket(fixture), (hasSucceeded) => {
      isRetired = !hasSucceeded
    })
    await entered.promise
    let lateKey: Uint8Array = new Uint8Array()
    try {
      await fixture.broker.endRequester(fixture.identity.id)
      await fixture.broker.register(fixture.peer, fixture.identity, 'ask')
      await fixture.broker.unlock()
      fresh = (async () => {
        const result = await fixture.broker.request(
          fixture.identity,
          fixture.stored.metadata.handle,
          use(),
          cleanTaint,
        )
        isFresh = result.kind === 'ticket'
      })()
      const grant = structuredClone(fixture.grants.values().next().value!)
      grant.id = '9'.repeat(32)
      granted = hasSucceeded(fixture.broker.grant(fixture.peer, grant), (hasSucceeded) => {
        isGranted = hasSucceeded
      })
      await vi.waitFor(() => {
        expect([isRetired, isFresh, isGranted]).toEqual([true, true, true])
      })
      await Promise.all([old, fresh, granted])
      const result = await unwrap(null)
      lateKey = result.key
      waiting.resolve(result)
      await vi.waitFor(() => {
        expect(lateKey.every((byte) => byte === 0)).toBe(true)
      })
      const status = await fixture.broker.status()
      expect(status.state).toBe('unlocked')
      expect(fixture.heldKeys.at(-1)?.some((byte) => byte !== 0)).toBe(true)
    } finally {
      if (lateKey.length === 0) waiting.resolve(await unwrap(null))
      await Promise.all([old, fresh, granted])
    }
  })
})
