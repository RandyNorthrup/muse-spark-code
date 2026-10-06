import { describe, expect, it } from 'vitest'
import { readScheduleClock, scheduleTimeAtClock } from '../../src/core/schedules/time/clock'
import { missedScheduleTimes } from '../../src/core/schedules/time/missed'
import { nextScheduleTime } from '../../src/core/schedules/time/scheduleTime'
import { FakeScheduleClock } from './helpers/schedules/clock'
import { fakeSchedule } from './helpers/schedules/fixtures'

const start = Date.parse('2026-10-05T12:00:00Z')
const interval = fakeSchedule({ trigger: { kind: 'interval', everyMs: 60_000, anchorMs: start } })
const composed = fakeSchedule({
  trigger: {
    kind: 'afterEvent',
    event: { kind: 'event', source: 'manual', event: 'manual', conditions: [] },
    time: { kind: 'interval', everyMs: 60_000, anchorMs: 0 },
  },
})

describe('M115 elapsed clock and missed-fire computation', () => {
  it('ignores forward and backward wall corrections for interval occurrence identities', () => {
    const clock = new FakeScheduleClock(start)
    let state = readScheduleClock(clock)
    clock.advance(30_000)
    clock.jumpWall(3_600_000)
    state = readScheduleClock(clock, state)
    expect(state).toMatchObject({ elapsedMs: start + 30_000, jumpMs: 3_600_000 })
    expect(missedScheduleTimes(interval, start, Math.floor(state.elapsedMs))).toMatchObject({
      dueCount: 0,
    })
    clock.advance(30_000)
    clock.jumpWall(-7_200_000)
    state = readScheduleClock(clock, state)
    expect(state).toMatchObject({ elapsedMs: start + 60_000, jumpMs: -7_200_000 })
    expect(missedScheduleTimes(interval, start, Math.floor(state.elapsedMs))).toEqual({
      dueCount: 1,
      missedCount: 0,
      catchUpAtMs: start + 60_000,
      nextFireAtMs: start + 120_000,
    })
  })

  it('recovers one of three elapsed fires after measured sleep without changing its id', () => {
    const clock = new FakeScheduleClock(start)
    const before = readScheduleClock(clock)
    clock.sleep(210_000)
    const state = readScheduleClock(clock, before, 210_000)
    expect(state).toMatchObject({ elapsedMs: start + 210_000, jumpMs: 0 })
    const recovered = missedScheduleTimes(interval, start, Math.floor(state.elapsedMs))
    expect(recovered).toEqual({
      dueCount: 3,
      missedCount: 2,
      catchUpAtMs: start + 180_000,
      nextFireAtMs: start + 240_000,
    })
    expect(
      missedScheduleTimes(interval, recovered.catchUpAtMs!, Math.floor(state.elapsedMs)),
    ).toEqual({
      dueCount: 0,
      missedCount: 0,
      nextFireAtMs: start + 240_000,
    })
    expect(
      missedScheduleTimes({ ...interval, catchUp: 'skip' }, start, Math.floor(state.elapsedMs)),
    ).toEqual({
      dueCount: 3,
      missedCount: 3,
      nextFireAtMs: start + 240_000,
    })
  })

  it('counts suspend-inclusive clocks once and retains fractional monotonic readings', () => {
    const clock = new FakeScheduleClock(start)
    let state = readScheduleClock(clock)
    clock.advance(210_000)
    state = readScheduleClock(clock, state)
    expect(state.elapsedMs).toBe(start + 210_000)
    const fractional = { now: () => start + 210_001, monotonicNow: () => 210_000.5 }
    state = readScheduleClock(fractional, state)
    expect(state.elapsedMs).toBe(start + 210_000.5)
  })

  it('does not guess that a wall jump was sleep and validates clock/reset inputs', () => {
    const clock = new FakeScheduleClock(start)
    const before = readScheduleClock(clock)
    clock.sleep(210_000)
    expect(readScheduleClock(clock, before).elapsedMs).toBe(start)
    for (const value of [-1, NaN, Infinity]) {
      expect(() => readScheduleClock({ now: () => start, monotonicNow: () => value })).toThrow()
      expect(() => readScheduleClock(clock, before, value)).toThrow()
    }
    clock.advance(1)
    const later = readScheduleClock(clock, before)
    expect(() => readScheduleClock({ now: () => start, monotonicNow: () => 0 }, later)).toThrow(
      'clockReset',
    )
    expect(() => readScheduleClock({ now: () => -1, monotonicNow: () => 0 })).toThrow()
    expect(() =>
      readScheduleClock(clock, { ...before, elapsedMs: Number.MAX_SAFE_INTEGER }, 1),
    ).toThrow()
  })

  it('recomputes wall kinds after jumps and never returns occurrences behind a durable cursor', () => {
    const plan = fakeSchedule({ zone: 'UTC', trigger: { kind: 'cron', expression: '0 * * * *' } })
    const through = start + 3 * 3_600_000 + 30_000
    const recovered = missedScheduleTimes(plan, start, through)
    expect(recovered).toEqual({
      dueCount: 3,
      missedCount: 2,
      catchUpAtMs: start + 3 * 3_600_000,
      nextFireAtMs: start + 4 * 3_600_000,
    })
    expect(missedScheduleTimes(plan, recovered.catchUpAtMs!, start - 3_600_000)).toEqual({
      dueCount: 0,
      missedCount: 0,
      nextFireAtMs: start + 4 * 3_600_000,
    })
    expect(
      missedScheduleTimes({ ...plan, catchUp: 'skip' }, start, through).catchUpAtMs,
    ).toBeUndefined()
    expect(missedScheduleTimes({ ...plan, catchUp: 'skip' }, start, start + 3_600_000)).toEqual({
      dueCount: 1,
      missedCount: 0,
      catchUpAtMs: start + 3_600_000,
      nextFireAtMs: start + 2 * 3_600_000,
    })
  })

  it('counts a folded wall time once and a gap once across sleep', () => {
    const plan = fakeSchedule({ trigger: { kind: 'cron', expression: '30 1 * * *' } })
    const before = Date.parse('2026-11-01T07:00:00Z')
    const through = Date.parse('2026-11-01T10:00:00Z')
    expect(missedScheduleTimes(plan, before, through)).toEqual({
      dueCount: 1,
      missedCount: 0,
      catchUpAtMs: Date.parse('2026-11-01T08:30:00Z'),
      nextFireAtMs: Date.parse('2026-11-02T09:30:00Z'),
    })
    const gap = {
      ...plan,
      trigger: { kind: 'cron', expression: '15,30,45 2 * * *' },
    } satisfies typeof plan
    expect(
      missedScheduleTimes(
        gap,
        Date.parse('2026-03-08T09:00:00Z'),
        Date.parse('2026-03-08T11:00:00Z'),
      ).dueCount,
    ).toBe(1)
  })

  it('honours both ends during recovery, including once and event-composed fires', () => {
    expect(
      missedScheduleTimes({ ...interval, end: { atMs: start + 180_000 } }, start, start + 210_000),
    ).toEqual({
      dueCount: 2,
      missedCount: 1,
      catchUpAtMs: start + 120_000,
    })
    expect(
      missedScheduleTimes(
        { ...interval, end: { afterRuns: 2 }, fireCount: 2 },
        start,
        start + 210_000,
      ),
    ).toEqual({ dueCount: 0, missedCount: 0 })
    expect(
      missedScheduleTimes(
        { ...interval, end: { afterRuns: 2 }, fireCount: 1 },
        start,
        start + 210_000,
      ).dueCount,
    ).toBe(3)
    const once = fakeSchedule({ trigger: { kind: 'once', atMs: start + 60_000 } })
    expect(missedScheduleTimes(once, start, start + 210_000)).toEqual({
      dueCount: 1,
      missedCount: 0,
      catchUpAtMs: start + 60_000,
    })
    expect(missedScheduleTimes(composed, start, start + 210_000, start)).toEqual({
      dueCount: 1,
      missedCount: 0,
      catchUpAtMs: start + 60_000,
    })
    expect(nextScheduleTime(composed, start)).toBeUndefined()
    expect(() => missedScheduleTimes(interval, start, -1)).toThrow()
  })

  it('counts a long elapsed downtime arithmetically without retaining a backlog', () => {
    const through = start + 1_000_000 * 60_000 + 30_000
    expect(missedScheduleTimes(interval, start, through)).toEqual({
      dueCount: 1_000_000,
      missedCount: 999_999,
      catchUpAtMs: through - 30_000,
      nextFireAtMs: through + 30_000,
    })
  })

  it('counts dense wall cron through a whole gap or fold day with no duplicate fires', () => {
    const plan = fakeSchedule({ trigger: { kind: 'cron', expression: '* * * * *' } })
    for (const [after, through, count] of [
      ['2026-03-08T08:00:00Z', '2026-03-09T07:00:00Z', 1380],
      ['2026-11-01T07:00:00Z', '2026-11-02T08:00:00Z', 1440],
    ] satisfies [string, string, number][]) {
      const recovered = missedScheduleTimes(plan, Date.parse(after), Date.parse(through))
      expect(recovered).toEqual({
        dueCount: count,
        missedCount: count - 1,
        catchUpAtMs: Date.parse(through),
        nextFireAtMs: Date.parse(through) + 60_000,
      })
    }
  })

  it('keeps interval end dates on the wall clock while ids and wake projections stay elapsed', () => {
    const clock = new FakeScheduleClock(start)
    const before = readScheduleClock(clock)
    clock.advance(30_000)
    clock.jumpWall(3_600_000)
    const state = readScheduleClock(clock, before)
    const plan = { ...interval, end: { atMs: start + 3_600_000 } }
    const domain = scheduleTimeAtClock(plan, state)
    expect(domain.nowMs).toBe(start + 30_000)
    expect(nextScheduleTime(domain.plan, domain.nowMs)).toBeUndefined()
    const open = scheduleTimeAtClock(interval, state)
    const occurrence = nextScheduleTime(open.plan, open.nowMs)
    expect(occurrence).toBe(start + 60_000)
    expect(occurrence! + open.wallOffsetMs).toBe(clock.now() + 30_000)
    const wall = fakeSchedule({ trigger: { kind: 'cron', expression: '0 * * * *' } })
    expect(scheduleTimeAtClock(wall, state)).toEqual({
      plan: wall,
      nowMs: clock.now(),
      wallOffsetMs: 0,
    })
    const event = { ...composed, end: plan.end }
    const eventDomain = scheduleTimeAtClock(event, state)
    expect(nextScheduleTime(eventDomain.plan, start, start)).toBeUndefined()
    const fractional = readScheduleClock(
      { now: () => start + 30_001, monotonicNow: () => 30_000.5 },
      before,
    )
    const fractionalDomain = scheduleTimeAtClock(
      { ...interval, end: { atMs: start + 60_001 } },
      fractional,
    )
    expect(nextScheduleTime(fractionalDomain.plan, fractionalDomain.nowMs)).toBe(start + 60_000)
  })
})
