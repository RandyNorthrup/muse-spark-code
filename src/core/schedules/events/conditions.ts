import {
  scheduleEventSchema,
  scheduleEventTriggerSchema,
  type ScheduleEvent,
} from '../../../shared/scheduleEvents'
import { SCHEDULE_EVENT_DEBOUNCE_MS } from '../../../shared/constants'

export function isEventMatch(trigger: unknown, input: unknown): boolean {
  const rule = scheduleEventTriggerSchema.parse(trigger)
  const event = scheduleEventSchema.parse(input)
  return (
    event.source === rule.source &&
    event.kind === rule.event &&
    rule.conditions.every((condition) => event.fields[condition.field] === condition.equals)
  )
}

/** The inclusive poll cursor and repeated history pages may repeat an identity. */
export function uniqueEvents(events: readonly ScheduleEvent[]): ScheduleEvent[] {
  const seen = new Set<string>()
  return events.filter((event) => {
    const identity = JSON.stringify([event.source, event.eventKey])
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

/** Historical matches use the same trailing debounce window as live admission. */
export function coalescedEventCount(events: readonly ScheduleEvent[]): number {
  let count = 0
  let previous: number | undefined
  const ordered = events.toSorted((a, b) => a.observedAt - b.observedAt)
  for (const event of ordered) {
    if (previous === undefined || event.observedAt - previous >= SCHEDULE_EVENT_DEBOUNCE_MS)
      count += 1
    previous = event.observedAt
  }
  return count
}

export function retainedPollEvents(
  previous: readonly ScheduleEvent[],
  incoming: readonly ScheduleEvent[],
  since: number,
): ScheduleEvent[] {
  return [...previous, ...incoming].filter((event) => event.observedAt >= since)
}
