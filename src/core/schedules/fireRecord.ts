import { scheduleEventSchema, type ScheduleEvent } from '../../shared/scheduleEvents'
import {
  scheduleFireRecordSchema,
  scheduleRunContextSchema,
  type ScheduleFireRecord,
  type ScheduleRunContext,
  type ScheduleV2,
} from '../../shared/scheduleV2'

export function scheduleRunContextOf(schedule: ScheduleV2, runId: string): ScheduleRunContext {
  return scheduleRunContextSchema.parse({
    unattended: true,
    scheduleId: schedule.id,
    runId,
    grant: schedule.grant,
    creator: schedule.creator,
    mode: schedule.mode,
    depth: schedule.depth,
    allowAgentReschedule: schedule.allowAgentReschedule,
  })
}

/** Parse final settlement and reject facts belonging to any other fire. */
export function validateScheduleSettlement(
  schedule: ScheduleV2,
  runId: string,
  occurrenceMs: number,
  input: unknown,
  event?: ScheduleEvent,
): ScheduleFireRecord {
  const fire = scheduleFireRecordSchema.parse(input)
  if (
    fire.runId !== runId ||
    fire.scheduleId !== schedule.id ||
    fire.workspaceKey !== schedule.workspaceKey ||
    fire.occurrenceMs !== occurrenceMs ||
    fire.delivery !== schedule.delivery ||
    JSON.stringify(fire.target) !== JSON.stringify(schedule.target) ||
    JSON.stringify(fire.event) !==
      JSON.stringify(event === undefined ? undefined : scheduleEventSchema.parse(event))
  )
    throw new Error('scheduleSettlementIdentityMismatch')
  return fire
}
