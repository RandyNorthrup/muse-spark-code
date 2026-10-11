import type { ScheduleRunContext, ScheduleV2 } from '../../shared/scheduleV2'

/** The schedule/context identity every delivery path enforces before dispatch:
 * the run carries this schedule's grant, creator, mode and depth. Callers
 * keep their own checks (workspace hold, action kind, occurrence bounds). */
export function isRunContextOf(schedule: ScheduleV2, context: ScheduleRunContext): boolean {
  return (
    context.scheduleId === schedule.id &&
    context.mode === schedule.mode &&
    context.depth === schedule.depth &&
    context.allowAgentReschedule === schedule.allowAgentReschedule &&
    JSON.stringify(context.grant) === JSON.stringify(schedule.grant) &&
    JSON.stringify(context.creator) === JSON.stringify(schedule.creator)
  )
}
