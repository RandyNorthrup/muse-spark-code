import { UI_TEXT } from '../../../shared/constants'
import {
  scheduleEventSchema,
  type ScheduleEvent,
  type ScheduleEventSource,
} from '../../../shared/scheduleEvents'
import { scheduleRequestSchema, scheduleResponseSchema } from '../../../shared/scheduleV2'
import { isEventMatch, uniqueEvents } from './conditions'
import type { ScheduleEventPrivacy } from './privacy'

type ScheduleResponse = ReturnType<typeof scheduleResponseSchema.parse>

export function sourceEvent(
  source: Pick<ScheduleEventSource, 'id' | 'kinds'>,
  input: unknown,
): ScheduleEvent {
  const event = scheduleEventSchema.parse(input)
  if (event.source !== source.id || !source.kinds.includes(event.kind))
    throw new Error(`${UI_TEXT.scheduleV2.labels.unavailable}: sourceMismatch`)
  return event
}

export class ScheduleEventRegistry {
  private readonly sources = new Map<string, ScheduleEventSource>()
  constructor(
    private readonly workspaceKey: string,
    sources: readonly ScheduleEventSource[],
    private readonly privacy: ScheduleEventPrivacy,
  ) {
    for (const source of sources) {
      if (this.sources.has(source.id))
        throw new Error(`${UI_TEXT.scheduleV2.labels.unavailable}: duplicateSource`)
      this.sources.set(source.id, source)
    }
    this.list()
  }

  list(): Extract<ScheduleResponse, { kind: 'eventSources' }> {
    const result = scheduleResponseSchema.parse({
      kind: 'eventSources',
      sources: Array.from(this.sources.values(), (source) => ({
        id: source.id,
        kinds: source.kinds,
        capability: source.capability(),
      })),
    })
    if (result.kind !== 'eventSources') throw new Error(UI_TEXT.scheduleV2.labels.unavailable)
    return result
  }

  async preview(input: unknown): Promise<Extract<ScheduleResponse, { kind: 'historyPreview' }>> {
    const request = scheduleRequestSchema.parse(input)
    if (request.method !== 'schedules/historyPreview' || request.workspaceKey !== this.workspaceKey)
      throw new Error(`${UI_TEXT.scheduleV2.labels.unavailable}: workspaceMismatch`)
    const source = this.sources.get(request.trigger.source)
    const capability = source?.capability()
    let preview: unknown
    if (!source || !capability?.available || !source.kinds.includes(request.trigger.event)) {
      preview = {
        available: false,
        reason:
          capability && !capability.available
            ? capability.reason
            : UI_TEXT.scheduleV2.messages.historyUnavailable,
      }
    } else {
      const history = await source.history(request.range)
      const current = source.capability()
      if (current.available && history.available) {
        const matches = uniqueEvents(
          history.events.map((event) => sourceEvent(source, event)),
        ).filter(
          (event) =>
            event.observedAt >= request.range.fromMs &&
            event.observedAt < request.range.toMs &&
            isEventMatch(request.trigger, event),
        )
        preview = {
          available: true,
          matchedCount: matches.length,
          events: await Promise.all(matches.map((event) => this.privacy.scrub(event))),
        }
      } else preview = current.available ? history : current
    }
    const finalCapability = source?.capability()
    if (finalCapability && !finalCapability.available) preview = finalCapability
    const result = scheduleResponseSchema.parse({
      kind: 'historyPreview',
      trigger: request.trigger,
      range: request.range,
      preview,
    })
    if (result.kind !== 'historyPreview') throw new Error(UI_TEXT.scheduleV2.labels.unavailable)
    return result
  }
}
