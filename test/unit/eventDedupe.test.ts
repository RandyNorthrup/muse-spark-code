import { describe, expect, it, vi } from 'vitest'
import { SCHEDULE_EVENT_DEBOUNCE_MS } from '../../src/shared/constants'
import {
  SCHEDULE_EVENT_KINDS,
  scheduleEventSchema,
  scheduleEventRunId,
} from '../../src/shared/scheduleEvents'
import { ScheduleEventEngine } from '../../src/core/schedules/events/engine'
import { ScheduleEventPrivacy } from '../../src/core/schedules/events/privacy'
import { FakeScheduleEventClaims } from './helpers/schedules/events'
import { createHash } from 'node:crypto'

const BRANCH_TRIGGER = {
  kind: 'event',
  source: 'git',
  event: 'branchUpdated',
  conditions: [],
} as const

const branchEvent = (eventKey: string, observedAt = 0) =>
  scheduleEventSchema.parse({
    source: 'git',
    kind: 'branchUpdated',
    eventKey,
    observedAt,
    fields: { title: eventKey },
  })

function setup() {
  let now = 0
  const disk = new FakeScheduleEventClaims()
  const receipts = disk.receipts
  const store = disk.client()
  const claim = vi.spyOn(store, 'transact')
  const privacy = new ScheduleEventPrivacy([], { mark: vi.fn() }, 'Untrusted event data')
  const make = () => new ScheduleEventEngine(() => now, store, privacy)
  return {
    make,
    claim,
    receipts,
    disk,
    store,
    privacy,
    advance: (duration: number) => {
      now += duration
    },
  }
}

describe('event debounce and permanent occurrence claims', () => {
  it('joins the A/a B/b host interleaving into one shared burst', async () => {
    const test = setup()
    const first = test.make()
    const second = test.make()
    expect(await first.enqueue('schedule', BRANCH_TRIGGER, branchEvent('a'))).toBe(true)
    expect(await second.enqueue('schedule', BRANCH_TRIGGER, branchEvent('a'))).toBe(false)
    test.advance(1)
    expect(await second.enqueue('schedule', BRANCH_TRIGGER, branchEvent('b', 1))).toBe(true)
    expect(await first.enqueue('schedule', BRANCH_TRIGGER, branchEvent('b', 1))).toBe(false)
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS)
    const fires = [...(await first.drain()), ...(await second.drain())]
    expect(fires).toHaveLength(1)
    expect(fires[0]?.coalescedCount).toBe(2)
  })

  it('takes over an abandoned burst after the window plus lease exactly once', async () => {
    const test = setup()
    const owner = test.make()
    await owner.enqueue('schedule', BRANCH_TRIGGER, branchEvent('a'))
    const firstSurvivor = test.make()
    const secondSurvivor = test.make()
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS)
    expect(await firstSurvivor.drain()).toEqual([])
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS - 1)
    expect(await firstSurvivor.drain()).toEqual([])
    test.advance(1)
    const competing = await Promise.all([firstSurvivor.drain(), secondSurvivor.drain()])
    const fires = competing.flat()
    expect(await owner.drain()).toEqual([])
    expect(await test.make().drain()).toEqual([])
    expect(fires).toHaveLength(1)
    expect(fires[0]?.coalescedCount).toBe(1)
  })

  it('fires distinct account and digest keys and treats an evk1-looking raw key as fresh', async () => {
    const test = setup()
    const engine = test.make()
    const raw = 'fixture@example.invalid'
    const digest = createHash('sha256').update(raw).digest('base64url')
    expect(await engine.enqueue('schedule', BRANCH_TRIGGER, branchEvent(raw))).toBe(true)
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS)
    const fires = await engine.drain()
    expect(fires).toHaveLength(1)
    expect(await engine.enqueue('schedule', BRANCH_TRIGGER, branchEvent(digest, 1))).toBe(true)
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS)
    const digestFires = await engine.drain()
    expect(digestFires).toHaveLength(1)
    const safe = await test.privacy.scrub(branchEvent(raw))
    expect(await engine.enqueue('schedule', BRANCH_TRIGGER, branchEvent(safe.eventKey))).toBe(true)
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS)
    const prefixedFires = await engine.drain()
    expect(prefixedFires).toHaveLength(1)
    const all = [...fires, ...digestFires, ...prefixedFires]
    expect(new Set(all.map((fire) => fire.runId)).size).toBe(3)
    expect(test.receipts.size).toBe(3)
    expect(JSON.stringify(all)).not.toContain(raw)
  })

  it('migrates legacy opaque and scrubbed receipts without admitting their own replays', async () => {
    const test = setup()
    const opaque = 'legacy-opaque'
    const account = 'fixture@example.invalid'
    const legacyDigest = createHash('sha256').update(account).digest('base64url')
    for (const key of [opaque, legacyDigest])
      test.disk.legacyReceipts.add(scheduleEventRunId('schedule', branchEvent(key)))
    for (const raw of [opaque, account]) {
      expect(await test.make().enqueue('schedule', BRANCH_TRIGGER, branchEvent(raw))).toBe(false)
      expect(await test.make().enqueue('another', BRANCH_TRIGGER, branchEvent(raw))).toBe(true)
    }
    // A legacy digest alone cannot reveal whether its old raw input was the
    // account or that digest. Preserve its replay fence conservatively.
    expect(await test.make().enqueue('schedule', BRANCH_TRIGGER, branchEvent(legacyDigest))).toBe(
      false,
    )
    expect(await test.make().enqueue('schedule', BRANCH_TRIGGER, branchEvent('fresh'))).toBe(true)
    expect(test.disk.legacyReceipts.size).toBe(2)
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS * 2)
    const fires = await test.make().drain()
    expect(fires).toHaveLength(2)
    expect(fires.find((fire) => fire.scheduleId === 'another')?.coalescedCount).toBe(2)
    expect(JSON.stringify(fires)).not.toContain(account)
  })

  it('retains matured bursts while a different host opens the next window', async () => {
    const test = setup()
    const first = test.make()
    const second = test.make()
    await first.enqueue('schedule', BRANCH_TRIGGER, branchEvent('a'))
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS)
    await second.enqueue('schedule', BRANCH_TRIGGER, branchEvent('b', 1))
    const firstFires = await first.drain()
    expect(firstFires.map((fire) => fire.event.fields['title'])).toEqual(['a'])
    expect(await second.drain()).toEqual([])
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS)
    expect(await first.drain()).toEqual([])
    const secondFires = await second.drain()
    expect(secondFires.map((fire) => fire.event.fields['title'])).toEqual(['b'])
  })

  it.each(SCHEDULE_EVENT_KINDS)('admits and marks %s from its fake source', async (kind) => {
    const test = setup()
    const engine = test.make()
    const event = scheduleEventSchema.parse({
      source: 'source',
      kind,
      eventKey: 'opaque',
      observedAt: 0,
      fields: { scheduleId: 'schedule' },
    })
    const trigger = { kind: 'event', source: 'source', event: kind, conditions: [] } as const
    expect(await engine.enqueue('schedule', trigger, event)).toBe(true)
    expect(await engine.drain()).toEqual([])
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS)
    const drained = await engine.drain()
    expect(drained[0]).toMatchObject({
      runId: scheduleEventRunId('schedule', await test.privacy.scrub(event)),
      event: await test.privacy.scrub(event),
      coalescedCount: 1,
      block: { trust: 'untrusted' },
    })
    expect(await test.make().enqueue('schedule', trigger, event)).toBe(false)
  })

  it('coalesces every claimed member, resets the debounce and survives a restart', async () => {
    const test = setup()
    const engine = test.make()
    const trigger = BRANCH_TRIGGER
    await engine.enqueue('schedule', trigger, branchEvent('a'))
    test.advance(1)
    await engine.enqueue('schedule', trigger, branchEvent('b', 1))
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS - 1)
    expect(await engine.drain()).toEqual([])
    test.advance(1)
    const fires = await engine.drain()
    expect(fires).toHaveLength(1)
    expect(fires[0]).toMatchObject({
      event: { fields: { title: 'a' } },
      coalescedCount: 2,
    })
    for (const key of ['a', 'b'])
      expect(await test.make().enqueue('schedule', trigger, branchEvent(key))).toBe(false)
    expect(test.receipts.size).toBe(2)
    expect(await test.make().enqueue('another', trigger, branchEvent('a'))).toBe(true)
  })

  it('claims before buffering and never rolls a claim back after a crash or discard', async () => {
    const test = setup()
    const event = scheduleEventSchema.parse({
      source: 'manual',
      kind: 'manual',
      eventKey: 'poke',
      observedAt: 0,
      fields: { scheduleId: 'schedule' },
    })
    const trigger = { kind: 'event', source: 'manual', event: 'manual', conditions: [] } as const
    const engine = test.make()
    expect(await engine.enqueue('wrong', trigger, event)).toBe(false)
    expect(test.claim).not.toHaveBeenCalled()
    await engine.enqueue('schedule', trigger, event)
    await engine.discard('schedule')
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS)
    expect(await engine.drain()).toEqual([])
    expect(await test.make().enqueue('schedule', trigger, event)).toBe(false)
    await expect(engine.enqueue('../escape', trigger, event)).rejects.toThrow()
  })

  it('does not restore a discarded schedule after an asynchronous claim', async () => {
    const settlement = Promise.withResolvers<undefined>()
    const disk = new FakeScheduleEventClaims()
    const store = disk.client()
    const original = store.transact
    const claim = vi.spyOn(store, 'transact').mockImplementationOnce(async (scheduleId, update) => {
      await settlement.promise
      return await original(scheduleId, update)
    })
    const engine = new ScheduleEventEngine(
      () => SCHEDULE_EVENT_DEBOUNCE_MS,
      store,
      new ScheduleEventPrivacy([], { mark: vi.fn() }, 'Untrusted data'),
    )
    const trigger = BRANCH_TRIGGER
    const pending = engine.enqueue(
      'schedule',
      trigger,
      scheduleEventSchema.parse({
        source: 'git',
        kind: 'branchUpdated',
        eventKey: 'one',
        fields: {},
        observedAt: 0,
      }),
    )
    await vi.waitFor(() => {
      expect(claim).toHaveBeenCalled()
    })
    await engine.discard('schedule')
    settlement.resolve(undefined)
    expect(await pending).toBe(false)
    expect(await engine.drain()).toEqual([])
  })

  it('keeps the earliest complete event when a burst arrives out of order', async () => {
    const test = setup()
    const engine = test.make()
    const trigger = BRANCH_TRIGGER
    await engine.enqueue('schedule', trigger, branchEvent('b', 1))
    await engine.enqueue('schedule', trigger, branchEvent('a'))
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS)
    const drained = await engine.drain()
    expect(drained[0]).toMatchObject({
      event: { fields: { title: 'a' } },
      coalescedCount: 2,
    })
  })

  it('keeps separate bursts when the scheduler drains after a debounce deadline', async () => {
    const test = setup()
    const engine = test.make()
    const trigger = BRANCH_TRIGGER
    await engine.enqueue('schedule', trigger, branchEvent('a'))
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS + 1)
    await engine.enqueue('schedule', trigger, branchEvent('b', 1))
    const firstFires = await engine.drain()
    expect(firstFires.map((fire) => fire.event.fields['title'])).toEqual(['a'])
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS)
    const secondFires = await engine.drain()
    expect(secondFires.map((fire) => fire.event.fields['title'])).toEqual(['b'])
  })

  it('discard removes both matured and pending bursts after revocation', async () => {
    const test = setup()
    const engine = test.make()
    const trigger = BRANCH_TRIGGER
    await engine.enqueue('schedule', trigger, branchEvent('a'))
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS)
    await engine.enqueue('schedule', trigger, branchEvent('b', 1))
    await engine.discard('schedule')
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS)
    expect(await engine.drain()).toEqual([])
  })

  it('cancels admission during scrubbing before any permanent claim', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<ScheduleEventPrivacy['admission']>>>()
    const privacy = new ScheduleEventPrivacy([], { mark: vi.fn() }, 'Untrusted data')
    vi.spyOn(privacy, 'admission').mockReturnValue(pending.promise)
    const store = new FakeScheduleEventClaims().client()
    const claim = vi.spyOn(store, 'transact')
    const engine = new ScheduleEventEngine(() => 0, store, privacy)
    const event = branchEvent('a')
    const admission = engine.enqueue(
      'schedule',
      { kind: 'event', source: 'git', event: 'branchUpdated', conditions: [] },
      event,
    )
    await engine.discard('schedule')
    claim.mockClear()
    pending.resolve({ event, legacyEventKey: event.eventKey })
    expect(await admission).toBe(false)
    expect(claim).not.toHaveBeenCalled()
  })

  it('has one winner across two host engines and a restarted client', async () => {
    const test = setup()
    const trigger = BRANCH_TRIGGER
    const first = test.make()
    const second = test.make()
    expect(
      await Promise.all([
        first.enqueue('schedule', trigger, branchEvent('a')),
        second.enqueue('schedule', trigger, branchEvent('a')),
      ]),
    ).toEqual([true, false])
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS)
    expect([...(await first.drain()), ...(await second.drain())]).toHaveLength(1)
    expect(await test.make().enqueue('schedule', trigger, branchEvent('a'))).toBe(false)
  })
})
