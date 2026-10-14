import { type ScheduleEvent } from '../../shared/scheduleEvents'
import {
  type ScheduleV2,
  type ScheduleRunContext,
  type ScheduleDeliveryResult,
} from '../../shared/scheduleV2'

export interface ScheduleReportDeliveryPort {
  run(
    schedule: ScheduleV2,
    context: ScheduleRunContext,
    occurrenceMs: number,
    event?: ScheduleEvent,
  ): Promise<ScheduleDeliveryResult>
}
