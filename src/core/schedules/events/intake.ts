import type { ScheduleEvent, ScheduleEventSource } from '../../../shared/scheduleEvents'
import type { ScheduleStoreV2, ScheduleV2 } from '../../../shared/scheduleV2'
import { type ScheduleEventEngine } from './engine'

export interface ScheduleEventIntakeDeps {
  readonly store: Pick<ScheduleStoreV2, 'list'>
  readonly workspaceKey: string
  /** Production set: local sources plus milestone ports. Manual stays out:
  manual fires travel the scheduler's direct schedules/fire path, immediately. */
  readonly sources: readonly ScheduleEventSource[]
  readonly engine: ScheduleEventEngine
  /** Plain event occurrences reach scheduler.fireEvent; afterEvent ones the
  host's deferral. The callback rechecks the schedule before acting. */
  readonly fire: (schedule: ScheduleV2, event: ScheduleEvent, occurrenceMs: number) => Promise<void>
  readonly now: () => number
  /** A source, claim or fire failure lands here; the intake keeps going. */
  readonly report: (error: unknown) => void
}

const MANUAL_SOURCE_ID = 'manual'

function eventTriggerOf(schedule: ScheduleV2) {
  return schedule.trigger.kind === 'afterEvent' ? schedule.trigger.event : schedule.trigger
}

/**
C-M115-4's production intake: one per workspace. Polling sources are
polled on every engine tick and every run-due; subscribed sources stay
subscribed while the workspace is watched. Matching events enqueue into
E's engine (debounced, claimed durably); matured bursts drain into the
scheduler. A failing source never stops the others.
*/
export class ScheduleEventIntake {
  private readonly subscriptions = new Map<string, { dispose(): void }>()
  private readonly lastPoll = new Map<string, number>()
  private polling = false
  private closed = false

  constructor(private readonly deps: ScheduleEventIntakeDeps) {}

  private subscribeAll(): void {
    for (const source of this.deps.sources) {
      if (
        source.subscribe === undefined ||
        source.id === MANUAL_SOURCE_ID ||
        this.subscriptions.has(source.id) ||
        !source.capability().available
      )
        continue
      try {
        const subscription = source.subscribe((event) => {
          void this.offerSubscribed(event).catch((error: unknown) => {
            this.deps.report(error)
          })
        })
        this.subscriptions.set(source.id, subscription)
      } catch (error: unknown) {
        this.deps.report(error)
      }
    }
  }

  private async offer(schedules: readonly ScheduleV2[], event: ScheduleEvent): Promise<void> {
    for (const schedule of schedules) {
      if (this.closed) return
      const trigger = eventTriggerOf(schedule)
      // A schedule's own settlement is not a new fact for itself: without
      // this a turnFinished trigger refires on its own every settlement.
      // Mutual loops between schedules stay the author's own, visible in
      // the fire record like any grant written too broadly.
      if (
        trigger.kind !== 'event' ||
        trigger.source !== event.source ||
        trigger.event !== event.kind ||
        (event.kind === 'turnFinished' && event.fields['scheduleId'] === schedule.id)
      )
        continue
      try {
        await this.deps.engine.enqueue(schedule.id, trigger, event)
      } catch (error: unknown) {
        this.deps.report(error)
      }
    }
  }

  private async offerSubscribed(event: ScheduleEvent): Promise<void> {
    if (this.closed) return
    await this.offer(await this.deps.store.list(this.deps.workspaceKey), event)
  }

  private async drain(schedules: readonly ScheduleV2[]): Promise<void> {
    let occurrences: Awaited<ReturnType<ScheduleEventEngine['drain']>>
    try {
      occurrences = await this.deps.engine.drain()
    } catch (error: unknown) {
      this.deps.report(error)
      return
    }
    for (const occurrence of occurrences) {
      if (this.closed) return
      const schedule = schedules.find((item) => item.id === occurrence.scheduleId)
      // A removed schedule's claimed burst has nothing to fire.
      if (schedule === undefined) continue
      try {
        await this.deps.fire(schedule, occurrence.event, this.deps.now())
      } catch (error: unknown) {
        this.deps.report(error)
      }
    }
  }

  sources(): readonly ScheduleEventSource[] {
    return this.deps.sources
  }

  /** The engine's own settlements arrive here directly, awaited, so a
  one-shot run-due never misses what its own dispatch published. The hub
  listener may enqueue the same event again; the durable claim admits one. */
  async offerPublished(event: ScheduleEvent): Promise<void> {
    if (this.closed) return
    await this.offer(await this.deps.store.list(this.deps.workspaceKey), event)
  }

  async poll(): Promise<void> {
    if (this.polling || this.closed) return
    this.polling = true
    try {
      this.subscribeAll()
      const schedules = await this.deps.store.list(this.deps.workspaceKey)
      for (const source of this.deps.sources) {
        if (
          source.poll === undefined ||
          source.id === MANUAL_SOURCE_ID ||
          !source.capability().available
        )
          continue
        let events: readonly ScheduleEvent[]
        try {
          events = await source.poll(this.lastPoll.get(source.id) ?? 0)
        } catch (error: unknown) {
          this.deps.report(error)
          continue
        }
        this.lastPoll.set(source.id, this.deps.now())
        for (const event of events) await this.offer(schedules, event)
      }
      await this.drain(schedules)
    } finally {
      this.polling = false
    }
  }

  discard(scheduleId: string): Promise<void> {
    return this.deps.engine.discard(scheduleId)
  }

  close(): void {
    this.closed = true
    for (const subscription of this.subscriptions.values()) subscription.dispose()
    this.subscriptions.clear()
  }
}
