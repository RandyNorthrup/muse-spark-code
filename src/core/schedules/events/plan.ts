import * as z from 'zod/mini'
import { createHash } from 'node:crypto'
import { SCHEDULE_EVENT_FIELD_MAX_CHARS } from '../../../shared/constants'
import {
  scheduleEventSchema,
  type ScheduleEvent,
  type ScheduleHistoryRange,
  type SchedulePollingEventSource,
  type ScheduleSourceCapability,
} from '../../../shared/scheduleEvents'
import { noEventHistory, unavailableSource, type ScheduleSnapshotPort } from './ports'
import { retainedPollEvents } from './conditions'

// M113 P's internal projection, not a second parser for PLAN prose.
const milestoneSchema = z.strictObject({
  milestoneId: z.string().check(z.minLength(1), z.maxLength(SCHEDULE_EVENT_FIELD_MAX_CHARS)),
  status: z.string().check(z.maxLength(SCHEDULE_EVENT_FIELD_MAX_CHARS)),
  certified: z.boolean(),
  revision: z.string().check(z.minLength(1), z.maxLength(SCHEDULE_EVENT_FIELD_MAX_CHARS)),
})
type Milestone = z.infer<typeof milestoneSchema>
export class SchedulePlanSource implements SchedulePollingEventSource {
  private previous: Map<string, Milestone> | undefined
  private cached: readonly ScheduleEvent[] = []
  readonly id = 'plan'
  readonly kinds = ['milestoneStatusChanged', 'milestoneCertified'] as const
  constructor(
    private readonly port: ScheduleSnapshotPort | undefined,
    private readonly now: () => number,
  ) {}
  capability(): ScheduleSourceCapability {
    return this.port?.capability() ?? unavailableSource('M113 plan')
  }
  history(range: ScheduleHistoryRange) {
    const capability = this.capability()
    return capability.available
      ? (this.port?.history?.(range) ?? noEventHistory())
      : Promise.resolve(capability)
  }
  async poll(since: number): Promise<readonly ScheduleEvent[]> {
    const capability = this.capability()
    if (!capability.available || !this.port)
      throw new Error(capability.available ? 'M113 plan' : capability.reason)
    const milestones = z.array(milestoneSchema).parse(await this.port.read())
    const current = this.capability()
    if (!current.available) throw new Error(current.reason)
    const next = new Map(milestones.map((row) => [row.milestoneId, row]))
    const events: ScheduleEvent[] = []
    for (const row of next.values()) {
      const old = this.previous?.get(row.milestoneId)
      if (!old) continue
      const isChanged = old.status !== row.status
      const isCertified = !old.certified && row.certified
      for (const kind of this.kinds) {
        if (
          (kind === 'milestoneStatusChanged' && !isChanged) ||
          (kind === 'milestoneCertified' && !isCertified)
        )
          continue
        events.push(
          scheduleEventSchema.parse({
            source: this.id,
            kind,
            eventKey: createHash('sha256')
              .update(JSON.stringify([row.milestoneId, row.revision, kind]))
              .digest('hex'),
            observedAt: this.now(),
            fields: { milestoneId: row.milestoneId, status: row.status },
          }),
        )
      }
    }
    this.previous = next
    this.cached = retainedPollEvents(this.cached, events, since)
    return this.cached.map((event) => structuredClone(event))
  }
}
