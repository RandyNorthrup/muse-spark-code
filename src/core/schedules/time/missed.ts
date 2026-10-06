import type { ScheduleV2 } from '../../../shared/scheduleV2'
import { nextScheduleTime, scheduleTimeOccurrences, type ScheduleTimePlan } from './scheduleTime'
import { checkInstant } from './zonedCalendar'

export interface ScheduleMissedTimes {
  readonly dueCount: number
  readonly missedCount: number
  readonly catchUpAtMs?: number
  readonly nextFireAtMs?: number
}

/** Recovery window (afterMs, throughMs], not normal polling admission.
 * Run once selects the most recent due occurrence, with its original id.
 * Skip suppresses past fires; a fire exactly at throughMs is still on time.
 * The caller owns the durable high-water cursor and the permanent claim.
 * Skipped occurrences do not count as runs toward end.afterRuns. */
export function missedScheduleTimes(
  plan: ScheduleTimePlan & Pick<ScheduleV2, 'catchUp'>,
  afterMs: number,
  throughMs: number,
  eventAtMs?: number,
): ScheduleMissedTimes {
  checkInstant(throughMs)
  let next = nextScheduleTime(plan, afterMs, eventAtMs)
  let dueCount = 0
  let latest: number | undefined
  if (next !== undefined && next <= throughMs && plan.trigger.kind === 'interval') {
    const end = Math.min(throughMs, plan.end?.atMs === undefined ? throughMs : plan.end.atMs - 1)
    dueCount = Math.floor((end - next) / plan.trigger.everyMs) + 1
    latest = next + (dueCount - 1) * plan.trigger.everyMs
    next = nextScheduleTime(plan, latest)
  } else {
    for (const fire of scheduleTimeOccurrences(plan, afterMs, eventAtMs)) {
      if (fire > throughMs) {
        next = fire
        break
      }
      latest = fire
      dueCount++
      next = undefined
    }
  }
  const catchUpAtMs = latest === throughMs || plan.catchUp === 'runOnce' ? latest : undefined
  return {
    dueCount,
    missedCount: dueCount - (catchUpAtMs === undefined ? 0 : 1),
    ...(catchUpAtMs !== undefined && { catchUpAtMs }),
    ...(next !== undefined && { nextFireAtMs: next }),
  }
}
