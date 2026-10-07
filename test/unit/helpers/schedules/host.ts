import type { ScheduleEvent } from '../../../../src/shared/scheduleEvents'
import { scheduleFireRecordSchema } from '../../../../src/shared/scheduleV2'
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
  result: ScheduleDeliveryResult | undefined
  deferSettlements = false
  readonly pending = new Map<string, (record: ScheduleDeliveryResult) => void>()
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
    if (this.pending.has(context.runId)) return Promise.reject(new Error('Run already pending'))
    this.deliveries.push(
      structuredClone({ schedule, context, occurrenceMs, ...(event !== undefined && { event }) }),
    )
    if (this.deferSettlements)
      return new Promise((resolve) => {
        this.pending.set(context.runId, resolve)
      })
    return Promise.resolve(
      scheduleFireRecordSchema.parse(
        structuredClone(
          this.result ?? {
            runId: context.runId,
            scheduleId: schedule.id,
            workspaceKey: schedule.workspaceKey,
            occurrenceMs,
            observedAtMs: this.now(),
            target: schedule.target,
            delivery: schedule.delivery,
            outcome: 'ran',
            refusedActions: [],
            cost: { usd: 0, certainty: 'exact', retainedLiabilityUsd: 0 },
            ...(event !== undefined && { event }),
          },
        ),
      ),
    )
  }
  settle(record: ScheduleDeliveryResult): void {
    const parsed = scheduleFireRecordSchema.parse(structuredClone(record))
    const resolve = this.pending.get(parsed.runId)
    if (resolve === undefined) throw new Error('No pending run for settlement')
    this.pending.delete(parsed.runId)
    resolve(parsed)
  }
}
