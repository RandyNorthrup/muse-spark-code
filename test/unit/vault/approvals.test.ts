import { afterEach, describe, expect, it, vi } from 'vitest'
import { type VaultBroker } from '../../../src/core/vault/broker/broker'
import { type VaultApprovalRequest, type VaultTicket } from '../../../src/shared/vault'
import { brokerFixture, cleanTaint } from './brokerFixture'
import { requester, use } from '../helpers/vault/fixtures'

const brokers: VaultBroker[] = []
afterEach(async () => {
  for (const broker of brokers.splice(0)) await broker.dispose()
})
async function setup() {
  const fixture = await brokerFixture()
  brokers.push(fixture.broker)
  return fixture
}
async function ask(fixture: Awaited<ReturnType<typeof setup>>): Promise<VaultApprovalRequest> {
  const result = await fixture.broker.request(
    fixture.identity,
    fixture.stored.metadata.handle,
    use(),
    cleanTaint,
  )
  if (result.kind !== 'approval') throw new Error('expected approval')
  return result.request
}
async function allow(
  fixture: Awaited<ReturnType<typeof setup>>,
  request: VaultApprovalRequest,
): Promise<VaultTicket> {
  const result = await fixture.broker.answer(fixture.peer, {
    requestId: request.id,
    digest: request.digest,
    decision: 'allowOnce',
  })
  if (result.kind !== 'ticket') throw new Error('expected ticket')
  return result.ticket
}
const lifetime = () => ({ close: vi.fn(), terminate: vi.fn(() => Promise.resolve(true)) })
describe('broker-owned approvals', () => {
  it('checks the answer digest and only the authenticated host UI can answer', async () => {
    const fixture = await setup(),
      request = await ask(fixture)
    const answer = { requestId: request.id, digest: request.digest, decision: 'allowOnce' as const }
    expect(await fixture.broker.answer({ ...fixture.peer, ui: false }, answer)).toEqual({
      kind: 'denied',
      reason: 'peer',
    })
    expect(
      await fixture.broker.answer({ ...fixture.peer, hostId: 'f'.repeat(32) }, answer),
    ).toEqual({ kind: 'denied', reason: 'peer' })
    expect(await fixture.broker.answer({ ...fixture.peer, processId: 101 }, answer)).toEqual({
      kind: 'denied',
      reason: 'peer',
    })
    expect(
      await fixture.broker.answer(fixture.peer, { ...answer, digest: '0'.repeat(64) }),
    ).toEqual({ kind: 'denied', reason: 'digest' })
    const resolved2155_0 = await fixture.broker.answer(fixture.peer, answer)
    expect(resolved2155_0.kind).toBe('ticket')
    expect(await fixture.broker.answer(fixture.peer, answer)).toEqual({
      kind: 'denied',
      reason: 'replay',
    })
  })
  it('denial consumes the id and expiry denies without a usable ticket', async () => {
    const fixture = await setup(),
      request = await ask(fixture)
    const answer = { requestId: request.id, digest: request.digest, decision: 'deny' as const }
    expect(await fixture.broker.answer(fixture.peer, answer)).toEqual({
      kind: 'denied',
      reason: 'policy',
    })
    expect(await fixture.broker.answer(fixture.peer, { ...answer, decision: 'allowOnce' })).toEqual(
      { kind: 'denied', reason: 'replay' },
    )
    const late = await ask(fixture)
    fixture.clock.advance(120_000)
    expect(
      await fixture.broker.answer(fixture.peer, {
        requestId: late.id,
        digest: late.digest,
        decision: 'allowOnce',
      }),
    ).toEqual({ kind: 'denied', reason: 'expired' })
  })
  it('actual use, nonce, requester, epoch, deadline and replay are checked at redemption', async () => {
    const fixture = await setup()
    const ticket = await allow(fixture, await ask(fixture))
    expect(await fixture.broker.redeem('f'.repeat(32), ticket, use(), lifetime())).toEqual({
      kind: 'denied',
      reason: 'peer',
    })
    expect(
      await fixture.broker.redeem(
        fixture.identity.id,
        { ...ticket, nonce: 'f'.repeat(32) },
        use(),
        lifetime(),
      ),
    ).toEqual({ kind: 'denied', reason: 'peer' })
    expect(
      await fixture.broker.redeem(
        fixture.identity.id,
        ticket,
        { ...use(), names: ['OTHER'] },
        lifetime(),
      ),
    ).toEqual({ kind: 'denied', reason: 'digest' })
    expect(await fixture.broker.redeem(fixture.identity.id, ticket, use(), lifetime())).toEqual({
      kind: 'denied',
      reason: 'replay',
    })
    const second = await allow(fixture, await ask(fixture))
    const resolved3931_0 = await fixture.broker.redeem(
      fixture.identity.id,
      second,
      use(),
      lifetime(),
    )
    expect(resolved3931_0.kind).toBe('ticket')
    expect(await fixture.broker.redeem(fixture.identity.id, second, use(), lifetime())).toEqual({
      kind: 'denied',
      reason: 'replay',
    })
    const late = await allow(fixture, await ask(fixture))
    fixture.clock.advance(120_000)
    expect(await fixture.broker.redeem(fixture.identity.id, late, use(), lifetime())).toEqual({
      kind: 'denied',
      reason: 'expired',
    })
  })
  it('caller and returned-card mutation cannot widen the broker snapshot', async () => {
    const fixture = await setup(),
      original = use(),
      who = requester()
    const pending = fixture.broker.request(
      who,
      fixture.stored.metadata.handle,
      original,
      cleanTaint,
    )
    original.names.push('OTHER')
    who.hostId = 'f'.repeat(32)
    const result = await pending
    if (result.kind !== 'approval') throw new Error('expected approval')
    const digest = result.request.digest
    result.request.use = { ...use(), names: ['OTHER'] }
    result.request.requester.role = { kind: 'subagent' }
    const answered = await fixture.broker.answer(fixture.peer, {
      requestId: result.request.id,
      digest,
      decision: 'allowOnce',
    })
    expect(answered.kind).toBe('ticket')
    if (answered.kind === 'ticket')
      expect(
        await fixture.broker.redeem(
          fixture.identity.id,
          answered.ticket,
          result.request.use,
          lifetime(),
        ),
      ).toEqual({ kind: 'denied', reason: 'digest' })
  })
  it('session answers cover only the exact use, role, workspace and conversation lifetime', async () => {
    const fixture = await setup()
    await fixture.change({
      policy: { ...fixture.stored.metadata.policy, mode: 'askOncePerSession' },
    })
    const request = await ask(fixture)
    const resolved5634_0 = await fixture.broker.answer(fixture.peer, {
      requestId: request.id,
      digest: request.digest,
      decision: 'allowSession',
    })
    expect(resolved5634_0.kind).toBe('ticket')
    const resolved5787_0 = await fixture.broker.request(
      fixture.identity,
      fixture.stored.metadata.handle,
      use(),
      cleanTaint,
    )
    expect(resolved5787_0.kind).toBe('ticket')
    const other = { ...requester(), id: 'f'.repeat(32), role: { kind: 'subagent' as const } }
    await fixture.broker.register(fixture.peer, other, 'ask')
    const resolved6075_0 = await fixture.broker.request(
      other,
      fixture.stored.metadata.handle,
      use(),
      cleanTaint,
    )
    expect(resolved6075_0.kind).toBe('approval')
    await fixture.broker.endRequester(fixture.identity.id)
    expect(
      await fixture.broker.request(
        fixture.identity,
        fixture.stored.metadata.handle,
        use(),
        cleanTaint,
      ),
    ).toEqual({ kind: 'denied', reason: 'peer' })
  })
  it('prompt cannot make Always or remember disclosure/taint', async () => {
    const fixture = await setup(),
      request = await ask(fixture)
    expect(
      await fixture.broker.answer(fixture.peer, {
        requestId: request.id,
        digest: request.digest,
        decision: 'allowSession',
      }),
    ).toEqual({ kind: 'denied', reason: 'policy' })
    await fixture.change({
      policy: { ...fixture.stored.metadata.policy, mode: 'askOncePerSession' },
    })
    const result = await fixture.broker.request(
      fixture.identity,
      fixture.stored.metadata.handle,
      use(),
      { tainted: true, reasons: [{ source: 'web', label: 'page' }] },
    )
    if (result.kind !== 'approval') throw new Error('expected approval')
    expect(
      await fixture.broker.answer(fixture.peer, {
        requestId: result.request.id,
        digest: result.request.digest,
        decision: 'allowSession',
      }),
    ).toEqual({ kind: 'denied', reason: 'policy' })
  })
  it('policy changes between approval and redemption fail closed', async () => {
    const fixture = await setup(),
      request = await ask(fixture)
    await fixture.change({ policy: { ...fixture.stored.metadata.policy, mode: 'never' } })
    expect(
      await fixture.broker.answer(fixture.peer, {
        requestId: request.id,
        digest: request.digest,
        decision: 'allowOnce',
      }),
    ).toEqual({ kind: 'denied', reason: 'policy' })
  })
  it('unanswered approvals expire as audited denials', async () => {
    const fixture = await setup()
    await ask(fixture)
    fixture.clock.advance(120_000)
    await fixture.broker.tick()
    expect(fixture.records.at(-1)).toMatchObject({ decision: 'deny', outcome: 'expired' })
  })
})
