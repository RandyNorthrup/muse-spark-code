import { Usd } from '../../src/shared/usd'
import { describe, expect, it } from 'vitest'
import { isRunContextOf } from '../../src/core/schedules/runIdentity'
import { fakeRunContext, fakeSchedule } from './helpers/schedules/fixtures'

// D100 G22: after any unattended delivery the run is checked where it
// landed, and a run id's kind is checked before use. The run carries its
// schedule's identity; delivery refuses anything else before dispatch.
describe('schedule run identity (D100 G22)', () => {
  it('accepts the run carrying this schedule’s grant, creator, mode and depth', () => {
    const schedule = fakeSchedule()
    expect(isRunContextOf(schedule, fakeRunContext(schedule))).toBe(true)
  })

  it('refuses a run of another kind before use', () => {
    const schedule = fakeSchedule()
    const context = fakeRunContext(schedule)
    const others = [
      { ...context, scheduleId: 'other-schedule' },
      { ...context, mode: 'plan' as const },
      { ...context, depth: context.depth + 1 },
      { ...context, allowAgentReschedule: !context.allowAgentReschedule },
      {
        ...context,
        grant: {
          ...context.grant,
          paidCapUsd: Usd.from(context.grant.paidCapUsd).add(Usd.from(1)).toAmount(),
        },
      },
      {
        ...context,
        creator: { kind: 'agent', agentId: 'a', sessionId: 's', orchestratorId: 'o' } as const,
      },
    ]
    for (const other of others) expect(isRunContextOf(schedule, other)).toBe(false)
  })
})
