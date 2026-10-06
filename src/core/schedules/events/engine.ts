import { SCHEDULE_EVENT_DEBOUNCE_MS } from '../../../shared/constants'
import {
  scheduleEventRunId,
  scheduleEventTriggerSchema,
  type ScheduleEvent,
  type ScheduleEventBlock,
} from '../../../shared/scheduleEvents'
import { isEventMatch } from './conditions'
import type { ScheduleEventPrivacy } from './privacy'

export interface ScheduleEventOccurrence {
  readonly scheduleId: string
  readonly runId: string
  readonly event: ScheduleEvent
  readonly block: ScheduleEventBlock
  readonly text: string
  readonly coalescedCount: number
}
interface PendingEvent {
  event: ScheduleEvent
  readyAt: number
  count: number
}
/** S supplies permanent cross-process claims; the clock is monotonic. */
export class ScheduleEventEngine {
  private readonly pending = new Map<string, PendingEvent>()
  private readonly generations = new Map<string, symbol>()
  constructor(
    private readonly now: () => number,
    private readonly canClaim: (runId: string) => Promise<boolean>,
    private readonly privacy: ScheduleEventPrivacy,
  ) {}

  async enqueue(scheduleId: string, trigger: unknown, input: ScheduleEvent): Promise<boolean> {
    const rule = scheduleEventTriggerSchema.parse(trigger)
    // Validate the schedule identity with the source identifier's frozen schema.
    scheduleEventTriggerSchema.parse({
      kind: 'event',
      source: scheduleId,
      event: rule.event,
      conditions: [],
    })
    if (
      !isEventMatch(rule, input) ||
      (input.kind === 'manual' && input.fields['scheduleId'] !== scheduleId)
    )
      return false
    const generation = this.generations.get(scheduleId) ?? Symbol()
    this.generations.set(scheduleId, generation)
    const event = await this.privacy.scrub(input)
    if (this.generations.get(scheduleId) !== generation) return false
    const runId = scheduleEventRunId(scheduleId, event)
    if (!(await this.canClaim(runId)) || this.generations.get(scheduleId) !== generation)
      return false
    const current = this.pending.get(scheduleId)
    const readyAt = this.now() + SCHEDULE_EVENT_DEBOUNCE_MS
    if (current) {
      // All members are claimed, even those suppressed by the debounce. Keep
      // the earliest identity as representative; never splice another's fields.
      if (
        event.observedAt < current.event.observedAt ||
        (event.observedAt === current.event.observedAt && event.eventKey < current.event.eventKey)
      )
        current.event = event
      current.readyAt = readyAt
      current.count += 1
    } else this.pending.set(scheduleId, { event, readyAt, count: 1 })
    return true
  }

  drain(): ScheduleEventOccurrence[] {
    const occurrences: ScheduleEventOccurrence[] = []
    for (const [scheduleId, pending] of this.pending) {
      if (this.now() < pending.readyAt) continue
      this.pending.delete(scheduleId)
      const safe = this.privacy.block(pending.event)
      occurrences.push({
        scheduleId,
        runId: scheduleEventRunId(scheduleId, pending.event),
        event: pending.event,
        ...safe,
        coalescedCount: pending.count,
      })
    }
    return occurrences
  }

  /** S calls this on pause, removal, authority edits and trigger replacement. */
  discard(scheduleId: string): void {
    this.pending.delete(scheduleId)
    this.generations.delete(scheduleId)
  }
}
