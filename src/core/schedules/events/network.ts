import * as z from 'zod/mini'
import { SCHEDULE_EVENT_FIELD_MAX_CHARS } from '../../../shared/constants'
import {
  scheduleEventSchema,
  type ScheduleEvent,
  type ScheduleEventKind,
  type SchedulePollingEventSource,
  type ScheduleHistoryRange,
  type ScheduleSourceCapability,
  type ScheduleEventHistory,
} from '../../../shared/scheduleEvents'
import { sourceEvent } from './registry'
import { uniqueEvents } from './conditions'
import { unavailableSource, type ScheduleNetworkPort } from './ports'

const responseSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unchanged') }),
  z.strictObject({
    kind: z.literal('events'),
    events: z.array(scheduleEventSchema),
    etag: z.optional(z.string().check(z.maxLength(SCHEDULE_EVENT_FIELD_MAX_CHARS))),
  }),
])
/** M113 supplies full resource projections; ETags are not tied to a poll cursor. */
export class ScheduleNetworkSource implements SchedulePollingEventSource {
  private etag: string | undefined
  private cached: readonly ScheduleEvent[] = []
  private reading: Promise<readonly ScheduleEvent[]> | undefined
  constructor(
    readonly id: string,
    readonly kinds: readonly ScheduleEventKind[],
    private readonly port: ScheduleNetworkPort | undefined,
  ) {}
  private async read(): Promise<readonly ScheduleEvent[]> {
    const port = this.port
    if (!port) throw new Error(unavailableSource('M113 network').reason)
    const response = responseSchema.parse(await port.read(this.etag))
    if (response.kind === 'unchanged' && this.etag === undefined)
      throw new Error(unavailableSource('etagWithoutSnapshot').reason)
    const capability = this.capability()
    if (!capability.available) {
      this.etag = undefined
      this.cached = []
      throw new Error(capability.reason)
    }
    if (response.kind === 'events') {
      this.cached = uniqueEvents(response.events.map((event) => sourceEvent(this, event)))
      this.etag = response.etag
    }
    return this.cached
  }
  capability(): ScheduleSourceCapability {
    if (!this.port) return unavailableSource('M113 network')
    return this.port.isNetworkEnabled()
      ? this.port.capability()
      : unavailableSource('reports.network')
  }
  async poll(since: number): Promise<readonly ScheduleEvent[]> {
    const capability = this.capability()
    if (!capability.available) {
      this.etag = undefined
      this.cached = []
      throw new Error(capability.reason)
    }
    this.reading ??= this.read()
    const reading = this.reading
    try {
      const events = await reading
      return events
        .filter((event) => event.observedAt >= since)
        .map((event) => structuredClone(event))
    } finally {
      if (this.reading === reading) this.reading = undefined
    }
  }
  async history(range: ScheduleHistoryRange): Promise<ScheduleEventHistory> {
    const capability = this.capability()
    const port = this.port
    if (!port || !capability.available)
      return capability.available ? unavailableSource('M113 network') : capability
    const history = await port.history(range)
    const current = this.capability()
    return current.available ? history : current
  }
}
