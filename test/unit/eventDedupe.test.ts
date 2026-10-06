import { describe, expect, it, vi } from 'vitest'
import { SCHEDULE_EVENT_DEBOUNCE_MS } from '../../src/shared/constants'
import {
  SCHEDULE_EVENT_KINDS,
  scheduleEventSchema,
  scheduleEventRunId,
} from '../../src/shared/scheduleEvents'
import { ScheduleEventEngine } from '../../src/core/schedules/events/engine'
import { ScheduleEventPrivacy } from '../../src/core/schedules/events/privacy'
import { FakeScheduleDisk } from './helpers/schedules/store'

const BRANCH_TRIGGER = {
  kind: 'event',
  source: 'git',
  event: 'branchUpdated',
  conditions: [],
} as const

const branchEvent = (eventKey: string) =>
  scheduleEventSchema.parse({
    source: 'git',
    kind: 'branchUpdated',
    eventKey,
    observedAt: 0,
    fields: { title: eventKey },
  })

function setup() {
  let now = 0
  const disk = new FakeScheduleDisk()
  const receipts = disk.claims
  const claim = vi.fn((id: string) => disk.client().claim(id))
  const privacy = new ScheduleEventPrivacy([], { mark: vi.fn() }, 'Untrusted event data')
  const make = () => new ScheduleEventEngine(() => now, claim, privacy)
  return {
    make,
    claim,
    receipts,
    advance: (duration: number) => {
      now += duration
    },
  }
}

describe('event debounce and permanent occurrence claims', () => {
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
    expect(engine.drain()).toEqual([])
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS)
    expect(engine.drain()[0]).toMatchObject({
      runId: scheduleEventRunId('schedule', event),
      event,
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
    await engine.enqueue('schedule', trigger, branchEvent('b'))
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS - 1)
    expect(engine.drain()).toEqual([])
    test.advance(1)
    const fires = engine.drain()
    expect(fires).toHaveLength(1)
    expect(fires[0]).toMatchObject({
      event: { eventKey: 'a', fields: { title: 'a' } },
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
    engine.discard('schedule')
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS)
    expect(engine.drain()).toEqual([])
    expect(await test.make().enqueue('schedule', trigger, event)).toBe(false)
    await expect(engine.enqueue('../escape', trigger, event)).rejects.toThrow()
  })

  it('does not restore a discarded schedule after an asynchronous claim', async () => {
    const settlement = Promise.withResolvers<boolean>()
    const claim = vi.fn(() => settlement.promise)
    const engine = new ScheduleEventEngine(
      () => SCHEDULE_EVENT_DEBOUNCE_MS,
      claim,
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
    engine.discard('schedule')
    settlement.resolve(true)
    expect(await pending).toBe(false)
    expect(engine.drain()).toEqual([])
  })

  it('keeps the earliest complete event when a burst arrives out of order', async () => {
    const test = setup()
    const engine = test.make()
    const trigger = BRANCH_TRIGGER
    await engine.enqueue('schedule', trigger, branchEvent('b'))
    await engine.enqueue('schedule', trigger, branchEvent('a'))
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS)
    expect(engine.drain()[0]).toMatchObject({
      event: { eventKey: 'a', fields: { title: 'a' } },
      coalescedCount: 2,
    })
  })

  it('keeps separate bursts when the scheduler drains after a debounce deadline', async () => {
    const test = setup()
    const engine = test.make()
    const trigger = BRANCH_TRIGGER
    await engine.enqueue('schedule', trigger, branchEvent('a'))
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS + 1)
    await engine.enqueue('schedule', trigger, branchEvent('b'))
    expect(engine.drain().map((fire) => fire.event.eventKey)).toEqual(['a'])
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS)
    expect(engine.drain().map((fire) => fire.event.eventKey)).toEqual(['b'])
  })

  it('discard removes both matured and pending bursts after revocation', async () => {
    const test = setup()
    const engine = test.make()
    const trigger = BRANCH_TRIGGER
    await engine.enqueue('schedule', trigger, branchEvent('a'))
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS)
    await engine.enqueue('schedule', trigger, branchEvent('b'))
    engine.discard('schedule')
    test.advance(SCHEDULE_EVENT_DEBOUNCE_MS)
    expect(engine.drain()).toEqual([])
  })

  it('cancels admission during scrubbing before any permanent claim', async () => {
    const pending = Promise.withResolvers<ReturnType<typeof scheduleEventSchema.parse>>()
    const privacy = new ScheduleEventPrivacy([], { mark: vi.fn() }, 'Untrusted data')
    vi.spyOn(privacy, 'scrub').mockReturnValue(pending.promise)
    const claim = vi.fn(() => Promise.resolve(true))
    const engine = new ScheduleEventEngine(() => 0, claim, privacy)
    const event = branchEvent('a')
    const admission = engine.enqueue(
      'schedule',
      { kind: 'event', source: 'git', event: 'branchUpdated', conditions: [] },
      event,
    )
    engine.discard('schedule')
    pending.resolve(event)
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
    expect([...first.drain(), ...second.drain()]).toHaveLength(1)
    expect(await test.make().enqueue('schedule', trigger, branchEvent('a'))).toBe(false)
  })
})
