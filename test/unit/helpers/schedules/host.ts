import type { ScheduleEvent } from '../../../../src/shared/scheduleEvents'
import { scheduleFireRecordSchema } from '../../../../src/shared/scheduleV2'
import type {
  ScheduleDeliveryResult,
  ScheduleHostPort,
  ScheduleRunContext,
  ScheduleV2,
  ScheduleDeliveryState,
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
  readonly ledger = new Map<string, ScheduleDeliveryState>()
  lookupRun = (runId: string): Promise<ScheduleDeliveryState> =>
    Promise.resolve(structuredClone(this.ledger.get(runId) ?? { status: 'absent' }))
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
    const previous = this.ledger.get(context.runId)
    if (previous?.status === 'settled' || previous?.status === 'uncertain')
      return Promise.resolve(previous.fire)
    if (previous?.status === 'admitted') return Promise.reject(new Error('Run already pending'))
    this.ledger.set(context.runId, { status: 'admitted' })
    this.deliveries.push(
      structuredClone({ schedule, context, occurrenceMs, ...(event !== undefined && { event }) }),
    )
    if (this.deferSettlements)
      return new Promise((resolve) => {
        this.pending.set(context.runId, resolve)
      })
    const fire = scheduleFireRecordSchema.parse(
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
    )
    this.ledger.set(context.runId, { status: 'settled', fire })
    return Promise.resolve(fire)
  }
  settle(record: ScheduleDeliveryResult): void {
    const parsed = scheduleFireRecordSchema.parse(structuredClone(record))
    const resolve = this.pending.get(parsed.runId)
    if (resolve === undefined) throw new Error('No pending run for settlement')
    this.pending.delete(parsed.runId)
    this.ledger.set(parsed.runId, { status: 'settled', fire: parsed })
    resolve(parsed)
  }
}
