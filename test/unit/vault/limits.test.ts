import { afterEach, describe, expect, it, vi } from 'vitest'
import { type VaultBroker } from '../../../src/core/vault/broker/broker'
import { brokerFixture, cleanTaint } from './brokerFixture'
import { use } from '../helpers/vault/fixtures'
import type * as VaultConstants from '../../../src/shared/constants'

// An isolated test instance uses a two-entry cap so the real boundary is exercised cheaply.
vi.mock('../../../src/shared/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof VaultConstants>()
  return { ...actual, VAULT_LIMITS: { ...actual.VAULT_LIMITS, items: 2 } }
})
const brokers: VaultBroker[] = []
afterEach(async () => {
  for (const broker of brokers.splice(0)) await broker.dispose()
})
describe('broker resource boundaries', () => {
  it.each(['approval', 'ticket'] as const)(
    'a full %s queue denies and audits the next request',
    async (kind) => {
      const fixture = await brokerFixture()
      brokers.push(fixture.broker)
      const grant = fixture.standing()
      grant.maxUses = null
      if (kind === 'ticket')
        await fixture.change({ policy: { ...fixture.stored.metadata.policy, mode: 'alwaysAllow' } })
      for (let index = 0; index < 2; index += 1) {
        const result = await fixture.broker.request(
          fixture.identity,
          fixture.stored.metadata.handle,
          use(),
          cleanTaint,
        )
        expect(result.kind).toBe(kind)
      }
      const denied = await fixture.broker.request(
        fixture.identity,
        fixture.stored.metadata.handle,
        use(),
        cleanTaint,
      )
      expect(denied).toEqual({ kind: 'denied', reason: 'policy' })
      expect(fixture.records).toHaveLength(3)
      expect(fixture.records.at(-1)).toMatchObject({ decision: 'deny', outcome: 'denied' })
      expect(grant.uses).toBe(kind === 'ticket' ? 2 : 0)
    },
  )
  it('the requester cap refuses a further trusted registration', async () => {
    const fixture = await brokerFixture()
    brokers.push(fixture.broker)
    await fixture.broker.register(fixture.peer, { ...fixture.identity, id: 'f'.repeat(32) }, 'ask')
    await expect(
      fixture.broker.register(fixture.peer, { ...fixture.identity, id: '0'.repeat(32) }, 'ask'),
    ).rejects.toThrow()
  })
})
