import { afterEach, describe, expect, it } from 'vitest'
import { type VaultBroker } from '../../../src/core/vault/broker/broker'
import { type VaultAuditWriter } from '../../../src/core/vault/broker/ports'
import { brokerFixture, cleanTaint } from './brokerFixture'
import { realAudit } from './auditFixture'
import { use } from '../helpers/vault/fixtures'

const brokers: VaultBroker[] = []
afterEach(async () => {
  while (brokers.length > 0) await brokers.pop()?.dispose()
})
async function setup() {
  const fixture = await brokerFixture()
  brokers.push(fixture.broker)
  return fixture
}
describe('RVM109B3 owned completions', () => {
  it('audit paging reads the reducer-installed actual writer and refuses reads after Lock', async () => {
    const log = realAudit(),
      fixture = await brokerFixture({ audit: log.audit })
    brokers.push(fixture.broker)
    const approval = await fixture.broker.request(
      fixture.identity,
      fixture.stored.metadata.handle,
      use(),
      cleanTaint,
    )
    expect(approval.kind).toBe('approval')
    const records = await fixture.broker.readAudit(fixture.peer)
    expect(records.map((row) => row.outcome)).toEqual(['pending'])
    await fixture.broker.lock()
    await expect(fixture.broker.readAudit(fixture.peer)).rejects.toThrow()
  })

  it('simultaneous unlocks install one owned key, store and audit writer', async () => {
    const fixture = await setup()
    await fixture.broker.lock()
    const unwrap = fixture.deps.unlock.unlock,
      entered = Promise.withResolvers<undefined>(),
      waiting = Promise.withResolvers<undefined>()
    let unwraps = 0
    fixture.deps.unlock.unlock = async (slotId) => {
      unwraps += 1
      entered.resolve(undefined)
      await waiting.promise
      return await unwrap(slotId)
    }
    const first = fixture.broker.unlock(),
      second = fixture.broker.unlock()
    await entered.promise
    expect(unwraps).toBe(1)
    waiting.resolve(undefined)
    await Promise.all([first, second])
    expect(unwraps).toBe(1)
    expect(fixture.heldKeys.filter((key) => key.some((byte) => byte !== 0))).toHaveLength(1)
  })

  it('an old lock epoch writer cannot commit into a freshly unlocked generation', async () => {
    const fixture = await setup(),
      bump = fixture.deps.epoch.bump,
      entered = Promise.withResolvers<undefined>(),
      waiting = Promise.withResolvers<undefined>()
    let isOld = true
    fixture.deps.epoch.bump = async (authorize) => {
      if (isOld) {
        isOld = false
        entered.resolve(undefined)
        await waiting.promise
      }
      return await bump(authorize)
    }
    const locked = fixture.broker.lock(),
      observed = expect(locked).rejects.toThrow()
    await entered.promise
    await fixture.broker.unlock()
    waiting.resolve(undefined)
    await observed
    const status = await fixture.broker.status()
    expect(status.state).toBe('unlocked')
    expect(status.lockEpoch).toBe(0)
  })

  it('P1-1 a delayed old connection close cannot cancel a replacement registration', async () => {
    const fixture = await setup(),
      connection = fixture.broker.beginConnection()
    const authenticated = await fixture.broker.authenticate(connection, () =>
      Promise.resolve({
        peer: fixture.peer,
        requester: fixture.identity,
        firstParty: false,
        manage: false,
      }),
    )
    await fixture.broker.endRequester(fixture.identity.id)
    await fixture.broker.register(fixture.peer, fixture.identity, 'ask')
    await fixture.broker.closeConnection(connection)
    expect(fixture.deps.onRevoked).toHaveBeenCalledOnce()
    expect(await fixture.broker.list(fixture.identity)).toHaveLength(1)
    expect(
      await fixture.broker.request(
        fixture.identity,
        fixture.stored.metadata.handle,
        use(),
        cleanTaint,
        authenticated.token,
      ),
    ).toEqual({ kind: 'denied', reason: 'peer' })
  })
  it('P2-4 an obsolete unwrap completion cannot close the fresh audit writer or erase its key', async () => {
    const log = realAudit(),
      fixture = await brokerFixture({ audit: log.audit })
    brokers.push(fixture.broker)
    await fixture.broker.lock()
    const unlock = fixture.deps.unlock.unlock,
      openWriter = fixture.deps.audit.openWriter.bind(fixture.deps.audit),
      entered = Promise.withResolvers<undefined>(),
      waiting = Promise.withResolvers<Awaited<ReturnType<typeof unlock>>>()
    const writers: VaultAuditWriter[] = []
    fixture.deps.audit.openWriter = async (key) => {
      const writer = await openWriter(key)
      writers.push(writer)
      return writer
    }
    let isOld = true
    fixture.deps.unlock.unlock = async (slotId) => {
      if (isOld) {
        isOld = false
        entered.resolve(undefined)
        return await waiting.promise
      }
      return await unlock(slotId)
    }
    const obsolete = fixture.broker.unlock(),
      observed = expect(obsolete).rejects.toThrow()
    await entered.promise
    await fixture.broker.lock()
    await fixture.broker.unlock()
    const fresh = writers[0]
    if (!fresh) throw new Error('missing fresh writer')
    expect(await fresh.read()).toEqual([])
    waiting.resolve(await unlock(null))
    await observed
    expect(await fresh.read()).toEqual([])
    const status1 = await fixture.broker.status()
    expect(status1.state).toBe('unlocked')
    expect(fixture.heldKeys.at(-1)?.some((byte) => byte !== 0)).toBe(true)
  })
  it('P2-4 a stale epoch snapshot from list cannot lock the fresh generation', async () => {
    const fixture = await setup(),
      current = fixture.deps.epoch.current,
      entered = Promise.withResolvers<undefined>(),
      waiting = Promise.withResolvers<undefined>()
    let isOld = true
    fixture.deps.epoch.current = async () => {
      const epoch = await current()
      if (isOld) {
        isOld = false
        entered.resolve(undefined)
        await waiting.promise
      }
      return epoch
    }
    const obsolete = fixture.broker.list(fixture.identity)
    await entered.promise
    await fixture.broker.lock()
    await fixture.broker.unlock()
    const status2 = await fixture.broker.status()
    expect(status2.state).toBe('unlocked')
    waiting.resolve(undefined)
    expect(await obsolete).toEqual([])
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    const status3 = await fixture.broker.status()
    expect(status3.state).toBe('unlocked')
  })
  it('P2-3 an obsolete pending scrub cannot append after its terminal row in a reopened writer', async () => {
    const log = realAudit(),
      fixture = await brokerFixture({ audit: log.audit })
    brokers.push(fixture.broker)
    const key = Buffer.from(fixture.heldKeys[0]!),
      unlock = fixture.deps.unlock.unlock
    fixture.deps.unlock.unlock = async (slotId) => {
      const result = await unlock(slotId)
      result.key.fill(0)
      return { ...result, key: Buffer.from(key) }
    }
    const scrub = fixture.deps.scrub,
      entered = Promise.withResolvers<undefined>(),
      waiting = Promise.withResolvers<undefined>()
    let isOld = true
    fixture.deps.scrub = async (text) => {
      if (isOld) {
        isOld = false
        entered.resolve(undefined)
        await waiting.promise
      }
      return await scrub(text)
    }
    const pending = fixture.broker.request(
      fixture.identity,
      fixture.stored.metadata.handle,
      use(),
      cleanTaint,
    )
    await entered.promise
    await fixture.broker.lock()
    expect(await pending).toEqual({ kind: 'denied', reason: 'locked' })
    await fixture.broker.unlock()
    waiting.resolve(undefined)
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    expect(log.outcomes()).toEqual(['locked'])
    const status4 = await fixture.broker.status()
    expect(status4.state).toBe('unlocked')
    key.fill(0)
  })
})
