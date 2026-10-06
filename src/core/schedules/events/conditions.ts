import {
  scheduleEventSchema,
  scheduleEventTriggerSchema,
  type ScheduleEvent,
} from '../../../shared/scheduleEvents'

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
