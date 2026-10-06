import type { ScheduleV2 } from '../../../shared/scheduleV2'
import { nextScheduleTime, previousTimeOccurrences, type ScheduleTimePlan } from './scheduleTime'
import { checkInstant } from './zonedCalendar'

// Lane T owns this bound; move it into shared/constants with lane 0/W at wiring.
export const MISSED_COUNT_MAX = 100

export interface ScheduleMissedTimes {
  readonly dueCount: number
  readonly missedCount: number
  /** Both counts are lower bounds: surfaces must render them as "N or more". */
  readonly isCountLowerBound?: true
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
  checkInstant(afterMs)
  const next = nextScheduleTime(plan, Math.max(afterMs, throughMs), eventAtMs)
  let dueCount = 0
  let latest: number | undefined
  let isCountLowerBound = false
  const trigger = plan.trigger
  switch (trigger.kind) {
    case 'once':
    case 'interval':
    case 'event':
    case 'afterEvent': {
      const first = nextScheduleTime(plan, afterMs, eventAtMs)
      if (first !== undefined && first <= throughMs) {
        const end = Math.min(
          throughMs,
          plan.end?.atMs === undefined ? throughMs : plan.end.atMs - 1,
        )
        dueCount = trigger.kind === 'interval' ? Math.floor((end - first) / trigger.everyMs) + 1 : 1
        latest = trigger.kind === 'interval' ? first + (dueCount - 1) * trigger.everyMs : first
      }
      break
    }
    default: {
      if (plan.end?.afterRuns !== undefined && plan.fireCount >= plan.end.afterRuns) break
      const through = Math.min(
        throughMs,
        plan.end?.atMs === undefined ? throughMs : plan.end.atMs - 1,
      )
      if (through > afterMs) {
        for (const fire of previousTimeOccurrences(trigger, plan.zone, afterMs, through)) {
          latest ??= fire
          dueCount++
          if (dueCount === MISSED_COUNT_MAX) {
            isCountLowerBound = true
            break
          }
        }
      }
    }
  }
  const catchUpAtMs = latest === throughMs || plan.catchUp === 'runOnce' ? latest : undefined
  return {
    dueCount,
    missedCount: dueCount - (catchUpAtMs === undefined ? 0 : 1),
    ...(isCountLowerBound && { isCountLowerBound: true }),
    ...(catchUpAtMs !== undefined && { catchUpAtMs }),
    ...(next !== undefined && { nextFireAtMs: next }),
  }
}
