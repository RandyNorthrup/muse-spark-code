import type {
  ScheduleEventClaimState,
  ScheduleEventClaimStore,
} from '../../../../src/core/schedules/events/engine'
import {
  scheduleEventSchema,
  type ScheduleEvent,
  type ScheduleEventHistory,
  type ScheduleEventKind,
  type SchedulePollingEventSource,
  type ScheduleHistoryRange,
  type ScheduleSourceCapability,
} from '../../../../src/shared/scheduleEvents'

export class FakeScheduleEventSource implements SchedulePollingEventSource {
  readonly kinds: readonly ScheduleEventKind[]
  readonly events: ScheduleEvent[] = []
  readonly polls: number[] = []
  availability: ScheduleSourceCapability = { available: true }
  keepsHistory = true
  constructor(
    readonly id: string,
    kind: ScheduleEventKind,
  ) {
    this.kinds = [kind]
  }
  capability(): ScheduleSourceCapability {
    return this.availability
  }
  emit(eventKey: string, observedAt: number, fields: ScheduleEvent['fields'] = {}): ScheduleEvent {
    const event = scheduleEventSchema.parse({
      source: this.id,
      eventKey,
      kind: this.kinds[0],
      fields,
      observedAt,
    })
    this.events.push(structuredClone(event))
    return event
  }
  poll(since: number): Promise<readonly ScheduleEvent[]> {
    this.polls.push(since)
    return this.availability.available
      ? Promise.resolve(
          this.events
            .filter((event) => event.observedAt >= since)
            .map((event) => structuredClone(event)),
        )
      : Promise.reject(new Error(this.availability.reason))
  }
  history(range: ScheduleHistoryRange): Promise<ScheduleEventHistory> {
    if (!this.keepsHistory || !this.availability.available)
      return Promise.resolve({ available: false, reason: 'No history available' })
    return Promise.resolve({
      available: true,
      events: this.events
        .filter((event) => event.observedAt >= range.fromMs && event.observedAt < range.toMs)
        .map((event) => structuredClone(event)),
    })
  }
}

/** Atomic fake persistence: fresh clients/objects share committed state only. */
export class FakeScheduleEventClaims {
  private readonly states = new Map<string, ScheduleEventClaimState>()
  readonly receipts = new Set<string>()
  readonly legacyReceipts = new Set<string>()
  client(): ScheduleEventClaimStore {
    return {
      schedules: () => Promise.resolve(Array.from(this.states, ([id]) => id)),
      transact: (scheduleId, update) => {
        const state = {
          ...structuredClone(this.states.get(scheduleId) ?? { ready: [] }),
          receipts: new Set(this.receipts),
          legacyReceipts: new Set(this.legacyReceipts),
        }
        const result = update(state)
        for (const id of state.receipts) this.receipts.add(id)
        this.states.set(scheduleId, structuredClone(state))
        return Promise.resolve(structuredClone(result))
      },
    }
  }
}
