import { describe, expect, it } from 'vitest'
import { nextScheduleFire, parseLoopPrompt } from '../../src/core/backends/modelapi/schedules'
import { MILLISECONDS_PER_DAY, SCHEDULE_DEFAULT_INTERVAL_MS } from '../../src/shared/constants'

describe('/loop parser (M52)', () => {
  it('takes an interval, an exact local five-field cron, and the default cadence', () => {
    expect(parseLoopPrompt('/loop 10m /run-tests')).toEqual({
      ok: true,
      command: {
        verb: 'create',
        cadence: { kind: 'interval', everyMs: 10 * 60 * 1000 },
        prompt: '/run-tests',
      },
    })
    expect(parseLoopPrompt('/loop "0 9 * * 1-5" standup')).toEqual({
      ok: true,
      command: {
        verb: 'create',
        cadence: { kind: 'cron', expression: '0 9 * * 1-5' },
        prompt: 'standup',
      },
    })
    expect(parseLoopPrompt('/loop review the build')).toEqual({
      ok: true,
      command: {
        verb: 'create',
        cadence: { kind: 'interval', everyMs: SCHEDULE_DEFAULT_INTERVAL_MS },
        prompt: 'review the build',
      },
    })
  })

  it('lists and cancels without treating ordinary prompts as commands', () => {
    expect(parseLoopPrompt('/loop list')).toEqual({ ok: true, command: { verb: 'list' } })
    expect(parseLoopPrompt('/loop cancel job_1')).toEqual({
      ok: true,
      command: { verb: 'cancel', id: 'job_1' },
    })
    expect(parseLoopPrompt('please /loop 5m tests')).toBeUndefined()
  })

  it('rejects malformed cron, unsafe ids, missing prompts and out-of-range intervals', () => {
    expect(parseLoopPrompt('/loop')).toEqual({ ok: false, reason: 'empty' })
    expect(parseLoopPrompt('/loop 10m')).toEqual({ ok: false, reason: 'badPrompt' })
    expect(parseLoopPrompt('/loop 0m tests')).toEqual({ ok: false, reason: 'badCadence' })
    expect(parseLoopPrompt('/loop 8d tests')).toEqual({ ok: false, reason: 'badCadence' })
    expect(parseLoopPrompt('/loop "61 9 * * *" tests')).toEqual({
      ok: false,
      reason: 'badCadence',
    })
    expect(parseLoopPrompt('/loop "0 24 * * *" tests')).toEqual({
      ok: false,
      reason: 'badCadence',
    })
    expect(parseLoopPrompt('/loop cancel ../other')).toEqual({ ok: false, reason: 'badId' })
  })

  it('keeps lists, ranges, steps and Sunday aliases in the extracted cron grammar', () => {
    for (const expression of ['*/15 8-17 * * 1-5', '0,30 9 * * 0,7', '5/10 * * * *']) {
      expect(parseLoopPrompt(`/loop "${expression}" inspect`)).toMatchObject({ ok: true })
    }
    for (const expression of [
      '* * * *',
      '* * * * * *',
      '1,,2 * * * *',
      '*/0 * * * *',
      '*/1/2 * * * *',
      '2-1 * * * *',
      '0 0 0 * *',
      '0 0 * 13 *',
      '0 0 * * 8',
      '0 0 * * MON',
    ]) {
      expect(parseLoopPrompt(`/loop "${expression}" inspect`)).toEqual({
        ok: false,
        reason: 'badCadence',
      })
    }
    expect(parseLoopPrompt('/loop 2h inspect')).toMatchObject({
      command: { cadence: { kind: 'interval', everyMs: 7_200_000 } },
    })
    expect(parseLoopPrompt('/loop 2d inspect')).toMatchObject({
      command: { cadence: { kind: 'interval', everyMs: 2 * MILLISECONDS_PER_DAY } },
    })
  })
})

describe('next local cron fire (M52)', () => {
  it('finds a weekday 9 AM boundary in local time', () => {
    const monday = new Date(2026, 8, 21, 8, 59, 30).getTime()
    const next = nextScheduleFire(
      { kind: 'cron', expression: '0 9 * * 1-5' },
      monday,
      monday + MILLISECONDS_PER_DAY,
    )
    expect(next).toBe(new Date(2026, 8, 21, 9, 0).getTime())
  })

  it('follows cron day-of-month OR weekday semantics and the seven-day lifetime', () => {
    const before = new Date(2026, 8, 20, 8, 0).getTime()
    const next = nextScheduleFire(
      { kind: 'cron', expression: '0 9 1 * 0' },
      before,
      before + MILLISECONDS_PER_DAY,
    )
    expect(next).toBe(new Date(2026, 8, 20, 9, 0).getTime())
    expect(
      nextScheduleFire(
        { kind: 'cron', expression: '0 9 1 2 *' },
        before,
        before + MILLISECONDS_PER_DAY,
      ),
    ).toBeUndefined()
  })

  it('requires both date fields when a star-step is present, without dropping the step', () => {
    const tuesday = new Date(2026, 8, 22, 8, 59).getTime()
    expect(
      nextScheduleFire(
        { kind: 'cron', expression: '0 9 */1 * 1' },
        tuesday,
        tuesday + MILLISECONDS_PER_DAY,
      ),
    ).toBeUndefined()
    const evenMonday = new Date(2026, 8, 28, 8, 59).getTime()
    expect(
      nextScheduleFire(
        { kind: 'cron', expression: '0 9 */2 * 1' },
        evenMonday,
        evenMonday + MILLISECONDS_PER_DAY,
      ),
    ).toBeUndefined()
  })

  it('keeps an explicit full day-of-month range restricted for OR semantics', () => {
    const tuesday = new Date(2026, 8, 22, 8, 59).getTime()
    expect(
      nextScheduleFire(
        { kind: 'cron', expression: '0 9 1-31 * 1' },
        tuesday,
        tuesday + MILLISECONDS_PER_DAY,
      ),
    ).toBe(new Date(2026, 8, 22, 9, 0).getTime())
  })

  it('advances an interval from the admitted time, so missed fires do not queue', () => {
    const cadence = { kind: 'interval', everyMs: 60 * 1000 } as const
    expect(nextScheduleFire(cadence, 10 * 60 * 1000, 12 * 60 * 1000)).toBe(11 * 60 * 1000)
    expect(nextScheduleFire(cadence, 12 * 60 * 1000, 12 * 60 * 1000)).toBeUndefined()
  })

  it('requires the first fire before the seven-day expiry', () => {
    const expires = 7 * MILLISECONDS_PER_DAY
    expect(nextScheduleFire({ kind: 'interval', everyMs: expires }, 0, expires)).toBeUndefined()
    expect(
      nextScheduleFire({ kind: 'interval', everyMs: 60 * 1000 }, expires - 60 * 1000, expires),
    ).toBeUndefined()
    expect(
      nextScheduleFire({ kind: 'interval', everyMs: 60 * 1000 }, expires - 2 * 60 * 1000, expires),
    ).toBe(expires - 60 * 1000)
    const beforeCron = new Date(2026, 8, 21, 8, 59).getTime()
    expect(
      nextScheduleFire(
        { kind: 'cron', expression: '0 9 * * *' },
        beforeCron,
        beforeCron + 60 * 1000,
      ),
    ).toBeUndefined()
  })

  it('matches numeric Sunday 7 and minute steps without replaying the current minute', () => {
    const sunday = new Date(2026, 8, 20, 9, 5).getTime()
    expect(
      nextScheduleFire(
        { kind: 'cron', expression: '5/10 9 * * 7' },
        sunday,
        sunday + MILLISECONDS_PER_DAY,
      ),
    ).toBe(new Date(2026, 8, 20, 9, 15).getTime())
    expect(
      nextScheduleFire(
        { kind: 'cron', expression: 'invalid' },
        sunday,
        sunday + MILLISECONDS_PER_DAY,
      ),
    ).toBeUndefined()
  })
})
