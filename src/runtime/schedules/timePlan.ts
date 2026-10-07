import type { ScheduleClockReading, ScheduleTimePlan } from '../../core/schedules/scheduler'
import { nextScheduleTime } from '../../core/schedules/time/scheduleTime'
import type { ScheduleV2 } from '../../shared/scheduleV2'

/** T's occurrence computation behind the scheduler's plan port. */
export function scheduleTimePlan(
  schedule: ScheduleV2,
  clock: ScheduleClockReading,
): ScheduleTimePlan {
  if (schedule.trigger.kind === 'event' || schedule.trigger.kind === 'afterEvent')
    return { missed: false }
  const cursor = schedule.lastFireAtMs ?? schedule.createdAtMs
  const due = nextScheduleTime(
    {
      trigger: schedule.trigger,
      zone: schedule.zone,
      ...(schedule.end !== undefined && { end: schedule.end }),
      fireCount: schedule.fireCount,
    },
    cursor,
  )
  if (due === undefined || due > clock.nowMs) return { missed: false }
  const next = nextScheduleTime(
    {
      trigger: schedule.trigger,
      zone: schedule.zone,
      ...(schedule.end !== undefined && { end: schedule.end }),
      fireCount: schedule.fireCount,
    },
    Math.max(due, clock.nowMs),
  )
  return {
    occurrenceMs: due,
    ...(next !== undefined && { nextFireAtMs: next }),
    missed: clock.isStartup || due < clock.nowMs - clock.wallDeltaMs,
  }
}
