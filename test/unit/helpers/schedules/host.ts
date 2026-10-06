import type { ScheduleEvent } from '../../../../src/shared/scheduleEvents'
import type {
  ScheduleDeliveryResult,
  ScheduleHostPort,
  ScheduleRunContext,
  ScheduleV2,
} from '../../../../src/shared/scheduleV2'
import type { FakeScheduleClock } from './clock'

export class FakeScheduleHost implements ScheduleHostPort {
  readonly workspaces = new Set<string>()
  readonly deliveries: {
    schedule: ScheduleV2
    context: ScheduleRunContext
    occurrenceMs: number
    event?: ScheduleEvent
  }[] = []
  result: ScheduleDeliveryResult = { outcome: 'ran' }
  now = (): number => this.clock.now()
  monotonicNow = (): number => this.clock.monotonicNow()
  constructor(readonly clock: FakeScheduleClock) {}
  holds(workspace: string): boolean {
    return this.workspaces.has(workspace)
  }
  deliver(
    schedule: ScheduleV2,
    context: ScheduleRunContext,
    occurrenceMs: number,
    event?: ScheduleEvent,
  ): Promise<ScheduleDeliveryResult> {
    this.deliveries.push(
      structuredClone({ schedule, context, occurrenceMs, ...(event !== undefined && { event }) }),
    )
    return Promise.resolve(this.result)
  }
}
