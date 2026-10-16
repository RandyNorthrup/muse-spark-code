import { describe, expect, it } from 'vitest'
import {
  nextScheduleTime,
  nextTimeFire,
  previewScheduleTimes,
  type ScheduleTimePlan,
} from '../../src/core/schedules/time/scheduleTime'
import type { ScheduleTimeTrigger } from '../../src/shared/scheduleV2'

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

describe('stored-zone schedule times through real Intl calendar rules', () => {
  for (const transition of transitions) {
    it(`${transition.zone}: daily, weekly and cron move a spring gap to its first valid minute`, () => {
      for (const trigger of recurringKinds(transition.spring, 2)) {
        const fire = nextTimeFire(trigger, transition.zone, instant(transition.beforeGap))
        expect(fire).toBe(instant(transition.gapFire))
        expect(nextTimeFire(trigger, transition.zone, instant(transition.gapFire))).toBeGreaterThan(
          instant(transition.gapFire),
        )
      }
    })

    it(`${transition.zone}: daily, weekly and cron fire a fold only at its first occurrence`, () => {
      for (const trigger of recurringKinds(transition.autumn, transition.foldHour)) {
        const first = instant(transition.foldFire)
        expect(nextTimeFire(trigger, transition.zone, instant(transition.beforeFold))).toBe(first)
        const next = nextTimeFire(trigger, transition.zone, first)
        expect(next).toBeGreaterThan(instant(transition.secondFold))
        expect(
          nextTimeFire(trigger, transition.zone, instant(transition.secondFold) - 60_000),
        ).toBe(next)
      }
    })
  }

  it('resolves half-hour gaps and folds and a skipped date rather than assuming hour offsets', () => {
    expect(
      nextTimeFire(
        { kind: 'cron', expression: '15 2 * * *' },
        'Australia/Lord_Howe',
        instant('2026-10-03T14:00:00Z'),
      ),
    ).toBe(instant('2026-10-03T15:30:00Z'))
    const fold: ScheduleTimeTrigger = { kind: 'cron', expression: '45 1 * * *' }
    const first = instant('2026-04-04T14:45:00Z')
    expect(nextTimeFire(fold, 'Australia/Lord_Howe', instant('2026-04-04T13:00:00Z'))).toBe(first)
    expect(nextTimeFire(fold, 'Australia/Lord_Howe', first)).toBe(instant('2026-04-05T15:15:00Z'))
    expect(
      nextTimeFire(
        { kind: 'cron', expression: '0 9 30 12 *' },
        'Pacific/Apia',
        instant('2011-12-29T12:00:00Z'),
      ),
    ).toBe(instant('2011-12-30T10:00:00Z'))
  })

  it('finds sparse leap-day cron and refuses impossible dates without a search horizon', () => {
    expect(
      nextTimeFire(
        { kind: 'cron', expression: '0 9 29 2 *' },
        'UTC',
        instant('2026-03-01T00:00:00Z'),
      ),
    ).toBe(instant('2028-02-29T09:00:00Z'))
    expect(nextTimeFire({ kind: 'cron', expression: '0 9 30 2 *' }, 'UTC', 0)).toBeUndefined()
  })

  it('uses the admission computation for previews and respects exclusive ends and run limits', () => {
    const after = instant('2026-03-08T09:00:00Z')
    const end = instant('2026-03-10T09:30:00Z')
    const plan: ScheduleTimePlan = {
      trigger: {
        kind: 'daily',
        everyDays: 1,
        anchorDate: '2026-03-08',
        times: [{ hour: 2, minute: 30 }],
      },
      zone: 'America/Los_Angeles',
      end: { atMs: end, afterRuns: 2 },
      fireCount: 0,
    }
    const fires = previewScheduleTimes(plan, after)
    expect(fires).toEqual([instant('2026-03-08T10:00:00Z'), instant('2026-03-09T09:30:00Z')])
    let cursor = after
    for (const [fireCount, fire] of fires.entries()) {
      expect(nextScheduleTime({ ...plan, fireCount }, cursor)).toBe(fire)
      cursor = fire
    }
    expect(nextScheduleTime({ ...plan, fireCount: 2 }, cursor)).toBeUndefined()
    expect(
      nextScheduleTime({ ...plan, end: { atMs: instant('2026-03-08T10:00:00Z') } }, after),
    ).toBeUndefined()
  })
})
