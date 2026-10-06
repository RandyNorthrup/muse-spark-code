import { describe, expect, it, vi } from 'vitest'
import { parseScheduleLoop } from '../../src/core/schedules/time/loop'
import { ZonedScheduleCalendar } from '../../src/core/schedules/time/zonedCalendar'
import {
  nextScheduleTime,
  nextTimeFire,
  previewScheduleTimes,
} from '../../src/core/schedules/time/scheduleTime'
import type { ScheduleTimeTrigger, ScheduleV2 } from '../../src/shared/scheduleV2'
import { FakeScheduleClock } from './helpers/schedules/clock'
import { fakeSchedule } from './helpers/schedules/fixtures'

const instant = Date.parse
const transitions = [
  {
    zone: 'America/Los_Angeles',
    spring: '2026-03-08',
    beforeGap: '2026-03-08T08:30:00Z',
    gapFire: '2026-03-08T10:00:00Z',
    autumn: '2026-11-01',
    beforeFold: '2026-11-01T07:30:00Z',
    foldHour: 1,
    foldFire: '2026-11-01T08:30:00Z',
    secondFold: '2026-11-01T09:30:00Z',
  },
  {
    zone: 'Europe/Berlin',
    spring: '2026-03-29',
    beforeGap: '2026-03-28T23:30:00Z',
    gapFire: '2026-03-29T01:00:00Z',
    autumn: '2026-10-25',
    beforeFold: '2026-10-24T22:30:00Z',
    foldHour: 2,
    foldFire: '2026-10-25T00:30:00Z',
    secondFold: '2026-10-25T01:30:00Z',
  },
  {
    zone: 'Australia/Sydney',
    spring: '2026-10-04',
    beforeGap: '2026-10-03T14:30:00Z',
    gapFire: '2026-10-03T16:00:00Z',
    autumn: '2026-04-05',
    beforeFold: '2026-04-04T13:30:00Z',
    foldHour: 2,
    foldFire: '2026-04-04T15:30:00Z',
    secondFold: '2026-04-04T16:30:00Z',
  },
]

function recurringKinds(date: string, hour: number): readonly ScheduleTimeTrigger[] {
  const times = [{ hour, minute: 30 }]
  return [
    { kind: 'daily', everyDays: 1, anchorDate: date, times },
    { kind: 'weekly', days: [{ weekday: 0, times }] },
    { kind: 'cron', expression: `30 ${String(hour)} * * *` },
  ]
}

describe('M115 stored-zone time engine', () => {
  for (const transition of transitions) {
    describe(transition.zone, () => {
      for (const trigger of recurringKinds(transition.spring, 2)) {
        it(`${trigger.kind} moves a spring gap to its first valid minute`, () => {
          const clock = new FakeScheduleClock(transition.beforeGap, transition.zone)
          const fire = nextTimeFire(trigger, transition.zone, clock.now())
          expect(fire).toBe(instant(transition.gapFire))
          expect(clock.localAt(fire)).toMatchObject({ hour: '03', minute: '00' })
          expect(nextTimeFire(trigger, transition.zone, fire!)).toBeGreaterThan(fire!)
          if (trigger.kind === 'weekly') {
            expect(nextTimeFire(trigger, transition.zone, fire!)).toBe(
              fire! + 7 * 86_400_000 - 1_800_000,
            )
          }
        })
      }
      for (const trigger of recurringKinds(transition.autumn, transition.foldHour)) {
        it(`${trigger.kind} fires a fold once at its first occurrence`, () => {
          const clock = new FakeScheduleClock(transition.beforeFold, transition.zone)
          const fire = nextTimeFire(trigger, transition.zone, clock.now())
          expect(fire).toBe(instant(transition.foldFire))
          const next = nextTimeFire(trigger, transition.zone, fire!)
          expect(next).toBeGreaterThan(instant(transition.secondFold))
          if (trigger.kind === 'weekly') expect(next).toBe(fire! + 7 * 86_400_000 + 3_600_000)
          expect(
            nextTimeFire(trigger, transition.zone, instant(transition.secondFold) - 60_000),
          ).toBe(next)
        })
      }

      it('keeps five-fire previews identical to successive admissions', () => {
        for (const trigger of recurringKinds(transition.spring, 2)) {
          const plan = fakeSchedule({ trigger, zone: transition.zone })
          const preview = previewScheduleTimes(plan, instant(transition.beforeGap))
          expect(preview).toHaveLength(5)
          let after = instant(transition.beforeGap)
          for (const [index, fire] of preview.entries()) {
            expect(nextScheduleTime({ ...plan, fireCount: index }, after)).toBe(fire)
            after = fire
          }
        }
      })

      it('keeps absolute once and elapsed interval occurrences across both transitions', () => {
        for (const at of [transition.beforeGap, transition.beforeFold]) {
          const anchorMs = instant(at)
          const interval: ScheduleTimeTrigger = { kind: 'interval', everyMs: 3_600_000, anchorMs }
          expect(nextTimeFire(interval, transition.zone, anchorMs)).toBe(anchorMs + 3_600_000)
          const once: ScheduleTimeTrigger = { kind: 'once', atMs: anchorMs + 3_600_000 }
          expect(nextTimeFire(once, transition.zone, anchorMs)).toBe(once.atMs)
          expect(nextTimeFire(once, transition.zone, once.atMs)).toBeUndefined()
        }
      })

      it('keeps weekdays on the next local Monday across both transitions', () => {
        const trigger: ScheduleTimeTrigger = { kind: 'weekdays', times: [{ hour: 9, minute: 0 }] }
        for (const at of [transition.beforeGap, transition.beforeFold]) {
          const clock = new FakeScheduleClock(at, transition.zone)
          const fire = nextTimeFire(trigger, transition.zone, clock.now())
          const date = clock.localAt(fire)
          expect(date).toMatchObject({ hour: '09', minute: '00' })
          expect(
            new Date(`${date['year']!}-${date['month']!}-${date['day']!}T00:00:00Z`).getUTCDay(),
          ).toBe(1)
        }
      })
    })
  }

  it('deduplicates repeated times and multiple gap times at the same boundary', () => {
    const plan = fakeSchedule({
      trigger: {
        kind: 'daily',
        everyDays: 1,
        anchorDate: '2026-03-08',
        times: [
          { hour: 2, minute: 45 },
          { hour: 3, minute: 0 },
          { hour: 2, minute: 15 },
          { hour: 2, minute: 15 },
        ],
      },
    })
    const preview = previewScheduleTimes(plan, instant('2026-03-08T09:59:00Z'))
    expect(preview.slice(0, 3)).toEqual([
      instant('2026-03-08T10:00:00Z'),
      instant('2026-03-09T09:15:00Z'),
      instant('2026-03-09T09:45:00Z'),
    ])
    const weekly = fakeSchedule({
      trigger: {
        kind: 'weekly',
        days: [
          { weekday: 1, times: [{ hour: 9, minute: 0 }] },
          {
            weekday: 1,
            times: [
              { hour: 8, minute: 0 },
              { hour: 8, minute: 0 },
            ],
          },
        ],
      },
    })
    expect(previewScheduleTimes(weekly, instant('2026-03-09T07:00:00Z')).slice(0, 2)).toEqual([
      instant('2026-03-09T15:00:00Z'),
      instant('2026-03-09T16:00:00Z'),
    ])
  })

  it('uses calendar days anchored to the stored zone rather than 24-hour durations', () => {
    const trigger: ScheduleTimeTrigger = {
      kind: 'daily',
      everyDays: 2,
      anchorDate: '2026-03-07',
      times: [{ hour: 9, minute: 0 }],
    }
    const first = nextTimeFire(trigger, 'America/Los_Angeles', instant('2026-03-06T12:00:00Z'))
    const second = nextTimeFire(trigger, 'America/Los_Angeles', first!)
    expect(first).toBe(instant('2026-03-07T17:00:00Z'))
    expect(second).toBe(instant('2026-03-09T16:00:00Z'))
    expect(second! - first!).toBe(47 * 3_600_000)
    expect(nextTimeFire(trigger, 'America/Los_Angeles', instant('2026-03-05T12:00:00Z'))).toBe(
      first,
    )
    expect(nextTimeFire(trigger, 'America/Los_Angeles', instant('2026-03-09T12:00:00Z'))).toBe(
      second,
    )
  })

  it('preserves the stored zone when the machine moves', () => {
    const clock = new FakeScheduleClock('2026-10-05T12:00:00Z', 'America/Los_Angeles')
    const plan = fakeSchedule({ trigger: { kind: 'weekdays', times: [{ hour: 9, minute: 0 }] } })
    const before = previewScheduleTimes(plan, clock.now())
    clock.moveToZone('Australia/Sydney')
    expect(previewScheduleTimes(plan, clock.now())).toEqual(before)
    expect(before[0]).toBe(instant('2026-10-05T16:00:00Z'))
  })

  it('finds sparse cron beyond seven days and refuses invalid expressions', () => {
    expect(
      nextTimeFire(
        { kind: 'cron', expression: '0 9 29 2 *' },
        'UTC',
        instant('2026-03-01T00:00:00Z'),
      ),
    ).toBe(instant('2028-02-29T09:00:00Z'))
    expect(
      nextTimeFire(
        { kind: 'cron', expression: '0 9 30 2 1' },
        'UTC',
        instant('2026-02-01T00:00:00Z'),
      ),
    ).toBe(instant('2026-02-02T09:00:00Z'))
    expect(() => nextTimeFire({ kind: 'cron', expression: '61 0 * * *' }, 'UTC', 0)).toThrow(
      'invalidCron',
    )
  })

  it('refuses impossible cron before starting a calendar search', () => {
    const stamp = vi.spyOn(ZonedScheduleCalendar.prototype, 'stamp').mockImplementation(() => {
      throw new Error('Unexpected impossible-cron search')
    })
    try {
      expect(nextTimeFire({ kind: 'cron', expression: '0 9 30 2 *' }, 'UTC', 0)).toBeUndefined()
      expect(stamp).not.toHaveBeenCalled()
    } finally {
      stamp.mockRestore()
    }
  })

  it('explicitly refuses a zone result that cannot bracket a missing civil minute', () => {
    const calendar = new ZonedScheduleCalendar('UTC')
    const stamp = vi.spyOn(calendar, 'stamp').mockReturnValue(0)
    try {
      expect(() => calendar.resolve(instant('2026-10-05T12:00:00Z'))).toThrow('unresolvedZone')
    } finally {
      stamp.mockRestore()
    }
  })

  it('resolves half-hour gaps and folds and an entire skipped date using Intl', () => {
    const trigger: ScheduleTimeTrigger = { kind: 'cron', expression: '15 2 * * *' }
    expect(nextTimeFire(trigger, 'Australia/Lord_Howe', instant('2026-10-03T14:00:00Z'))).toBe(
      instant('2026-10-03T15:30:00Z'),
    )
    const fold: ScheduleTimeTrigger = { kind: 'cron', expression: '45 1 * * *' }
    const first = nextTimeFire(fold, 'Australia/Lord_Howe', instant('2026-04-04T13:00:00Z'))
    expect(first).toBe(instant('2026-04-04T14:45:00Z'))
    expect(nextTimeFire(fold, 'Australia/Lord_Howe', first!)).toBe(instant('2026-04-05T15:15:00Z'))
    expect(
      nextTimeFire(
        { kind: 'cron', expression: '0 9 30 12 *' },
        'Pacific/Apia',
        instant('2011-12-29T12:00:00Z'),
      ),
    ).toBe(instant('2011-12-30T10:00:00Z'))
  })

  it('respects exclusive date ends, run limits and their intersection for every time kind', () => {
    const start = instant('2026-10-05T00:00:00Z')
    const triggers: readonly ScheduleTimeTrigger[] = [
      { kind: 'once', atMs: start + 60_000 },
      { kind: 'interval', everyMs: 60_000, anchorMs: start },
      { kind: 'daily', everyDays: 1, anchorDate: '2026-10-05', times: [{ hour: 9, minute: 0 }] },
      { kind: 'weekdays', times: [{ hour: 9, minute: 0 }] },
      { kind: 'weekly', days: [{ weekday: 1, times: [{ hour: 9, minute: 0 }] }] },
      { kind: 'cron', expression: '0 9 * * *' },
    ]
    for (const trigger of triggers) {
      const plan = fakeSchedule({ trigger, zone: 'UTC', end: { afterRuns: 2 } })
      const preview = previewScheduleTimes(plan, start)
      expect(preview.length).toBe(trigger.kind === 'once' ? 1 : 2)
      expect(previewScheduleTimes({ ...plan, fireCount: 2 }, start)).toEqual([])
      expect(nextScheduleTime({ ...plan, end: { atMs: preview[0]! } }, start)).toBeUndefined()
      expect(
        previewScheduleTimes({ ...plan, end: { atMs: preview[0]! + 1, afterRuns: 2 } }, start),
      ).toEqual([preview[0]])
    }
  })

  it('waits for a matched event then composes exactly one next weekday or elapsed delay', () => {
    const event: ScheduleV2['trigger'] = {
      kind: 'event',
      source: 'github',
      event: 'pullRequestMerged',
      conditions: [],
    }
    const eventAt = instant('2026-03-07T17:00:00Z')
    const plan = fakeSchedule({
      trigger: {
        kind: 'afterEvent',
        event,
        time: { kind: 'weekdays', times: [{ hour: 9, minute: 0 }] },
      },
    })
    expect(previewScheduleTimes(plan, eventAt - 1)).toEqual([])
    const fire = instant('2026-03-09T16:00:00Z')
    expect(previewScheduleTimes(plan, eventAt - 1, eventAt)).toEqual([fire])
    expect(nextScheduleTime(plan, fire, eventAt)).toBeUndefined()
    expect(nextScheduleTime({ ...plan, end: { atMs: fire } }, eventAt - 1, eventAt)).toBeUndefined()
    const interval = {
      ...plan,
      trigger: {
        kind: 'afterEvent',
        event,
        time: { kind: 'interval', everyMs: 60_000, anchorMs: 0 },
      },
    } satisfies ScheduleV2
    expect(previewScheduleTimes(interval, eventAt, eventAt)).toEqual([eventAt + 60_000])
    expect(
      nextScheduleTime({ ...interval, end: { atMs: eventAt + 60_000 } }, eventAt, eventAt),
    ).toBeUndefined()
    expect(previewScheduleTimes({ ...plan, trigger: event }, eventAt - 1, eventAt)).toEqual([
      eventAt,
    ])
    expect(
      nextScheduleTime({ ...plan, trigger: event, end: { atMs: eventAt } }, eventAt - 1, eventAt),
    ).toBeUndefined()
    expect(nextScheduleTime({ ...plan, trigger: event }, eventAt, eventAt)).toBeUndefined()
    const once = {
      ...plan,
      trigger: { kind: 'afterEvent', event, time: { kind: 'once', atMs: eventAt } },
    } satisfies ScheduleV2
    expect(nextScheduleTime(once, eventAt - 1, eventAt)).toBeUndefined()
    const huge = {
      ...plan,
      trigger: {
        kind: 'afterEvent',
        event,
        time: { kind: 'interval', everyMs: Number.MAX_SAFE_INTEGER - 1, anchorMs: 0 },
      },
    } satisfies ScheduleV2
    expect(nextScheduleTime(huge, 0, 1)).toBeUndefined()
    expect(() => nextScheduleTime(plan, 0, NaN)).toThrow()
  })

  it('validates time inputs and avoids unsafe arithmetic for huge intervals', () => {
    const interval: ScheduleTimeTrigger = { kind: 'interval', everyMs: 60_000, anchorMs: 120_000 }
    expect(nextTimeFire(interval, 'UTC', 0)).toBe(120_000)
    expect(nextTimeFire(interval, 'UTC', 150_000)).toBe(180_000)
    expect(nextTimeFire(interval, 'UTC', 0, 0)).toBeUndefined()
    for (const at of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
      expect(() => nextTimeFire(interval, 'UTC', at)).toThrow()
    }
    expect(() => nextTimeFire({ ...interval, everyMs: 1 }, 'UTC', 0)).toThrow()
    expect(() => nextScheduleTime({ ...fakeSchedule(), fireCount: -1 }, 0)).toThrow()
    expect(() => nextScheduleTime({ ...fakeSchedule(), end: {} }, 0)).toThrow()
    expect(() =>
      nextTimeFire({ kind: 'weekdays', times: [{ hour: 9, minute: 0 }] }, 'invalid-zone', 0),
    ).toThrow()
    expect(
      nextTimeFire({ kind: 'interval', everyMs: Number.MAX_SAFE_INTEGER, anchorMs: 1 }, 'UTC', 1),
    ).toBeUndefined()
  })

  it('refuses instants outside the Date range rather than returning an unusable fire', () => {
    expect(() => nextTimeFire({ kind: 'once', atMs: Number.MAX_SAFE_INTEGER }, 'UTC', 0)).toThrow()
    expect(
      nextTimeFire(
        { kind: 'interval', everyMs: Number.MAX_SAFE_INTEGER - 1, anchorMs: 1 },
        'UTC',
        1,
      ),
    ).toBeUndefined()
  })

  it('adapts the unchanged loop grammar with a seven-day default and civil day units', () => {
    const now = instant('2026-03-07T17:00:00Z')
    const zone = 'America/Los_Angeles'
    expect(parseScheduleLoop('/loop inspect', now, zone)).toEqual({
      ok: true,
      command: {
        verb: 'create',
        prompt: 'inspect',
        trigger: { kind: 'interval', everyMs: 600_000, anchorMs: now },
        zone,
        end: { atMs: now + 7 * 86_400_000 },
      },
    })
    expect(parseScheduleLoop('/loop 48h inspect', now, zone)).toMatchObject({
      command: { trigger: { kind: 'interval', everyMs: 48 * 3_600_000 } },
    })
    const days = parseScheduleLoop('/LOOP 2D inspect', now, zone)
    expect(days).toMatchObject({
      command: {
        trigger: {
          kind: 'daily',
          everyDays: 2,
          anchorDate: '2026-03-07',
          times: [{ hour: 9, minute: 0 }],
        },
      },
    })
    if (days?.ok && days.command.verb === 'create') {
      expect(nextTimeFire(days.command.trigger, days.command.zone, now)).toBe(
        instant('2026-03-09T16:00:00Z'),
      )
    } else throw new Error('Expected a loop creation')
    expect(parseScheduleLoop('/loop "0 9 * * 1-5" standup', now, zone)).toMatchObject({
      command: { trigger: { kind: 'cron', expression: '0 9 * * 1-5' } },
    })
    expect(parseScheduleLoop('/loop list', now, zone)).toEqual({
      ok: true,
      command: { verb: 'list' },
    })
    expect(parseScheduleLoop('/loop cancel job_1', now, zone)).toEqual({
      ok: true,
      command: { verb: 'cancel', id: 'job_1' },
    })
    expect(parseScheduleLoop('/loop 8d inspect', now, zone)).toEqual({
      ok: false,
      reason: 'badCadence',
    })
    expect(parseScheduleLoop('/loop 7d inspect', now, 'UTC')).toEqual({
      ok: false,
      reason: 'badCadence',
    })
    expect(parseScheduleLoop('/loop 7d inspect', now, zone)).toMatchObject({ ok: true })
    expect(parseScheduleLoop('inspect', now, zone)).toBeUndefined()
  })
})
