// Internal event contracts, not guessed provider/MSP wire frames. Each source
// adapter validates its own captured wire shape before producing these values.
import * as z from 'zod/mini'
import {
  SCHEDULE_EVENT_FIELD_MAX_CHARS,
  SCHEDULE_EVENT_MAX_FIELDS,
  SCHEDULE_ID_MAX_CHARS,
} from './constants'

export const SCHEDULE_EVENT_KINDS = [
  'pullRequestOpened',
  'pullRequestClosed',
  'pullRequestMerged',
  'reviewRequested',
  'ciFinished',
  'releasePublished',
  'issueLabelled',
  'issueOpened',
  'issueReplied',
  'branchUpdated',
  'tagCreated',
  'milestoneStatusChanged',
  'milestoneCertified',
  'turnFinished',
  'laneFinished',
  'taskFinished',
  'teamFinished',
  'questionAnswered',
  'usageThresholdCrossed',
  'resourceLevelChanged',
  'filesChanged',
  'versionPublished',
  'manual',
] as const
export type ScheduleEventKind = (typeof SCHEDULE_EVENT_KINDS)[number]

const identifier = z
  .string()
  .check(z.minLength(1), z.maxLength(SCHEDULE_ID_MAX_CHARS), z.regex(/^[\w-][\w.-]*$/))
const eventValue = z.union([
  z.string().check(z.maxLength(SCHEDULE_EVENT_FIELD_MAX_CHARS)),
  z.number(),
  z.boolean(),
])
const eventKeySchema = z.string().check(
  z.minLength(1),
  z.maxLength(SCHEDULE_EVENT_FIELD_MAX_CHARS),
  // In Unicode mode paired surrogates are one code point; lone ones fail.
  z.refine((value) => !/[\uD800-\uDFFF]/u.test(value)),
)
export const scheduleEventSchema = z.strictObject({
  source: identifier,
  eventKey: eventKeySchema,
  kind: z.enum(SCHEDULE_EVENT_KINDS),
  fields: z
    .record(identifier, eventValue)
    .check(z.refine((fields) => Object.keys(fields).length <= SCHEDULE_EVENT_MAX_FIELDS)),
  observedAt: z.int().check(z.gte(0)),
})
export type ScheduleEvent = z.infer<typeof scheduleEventSchema>

export const scheduleEventFilterSchema = z.strictObject({
  field: z.enum(['repository', 'branch', 'author', 'label', 'milestoneId', 'status']),
  equals: eventValue,
})
export const scheduleEventTriggerSchema = z.strictObject({
  kind: z.literal('event'),
  source: identifier,
  event: z.enum(SCHEDULE_EVENT_KINDS),
  conditions: z.array(scheduleEventFilterSchema).check(z.maxLength(SCHEDULE_EVENT_MAX_FIELDS)),
})

/** The fenced payload is data with fixed taint; it contains no grant or target. */
export const scheduleEventBlockSchema = z.strictObject({
  type: z.literal('scheduleEvent'),
  trust: z.literal('untrusted'),
  event: scheduleEventSchema,
})
export type ScheduleEventBlock = z.infer<typeof scheduleEventBlockSchema>

export type ScheduleSourceCapability =
  { readonly available: true } | { readonly available: false; readonly reason: string }
export interface ScheduleHistoryRange {
  readonly fromMs: number
  readonly toMs: number
}
export type ScheduleEventHistory =
  | { readonly available: true; readonly events: readonly ScheduleEvent[] }
  | { readonly available: false; readonly reason: string }
interface ScheduleEventSourceBase {
  readonly id: string
  readonly kinds: readonly ScheduleEventKind[]
  capability(): ScheduleSourceCapability
  history(range: ScheduleHistoryRange): Promise<ScheduleEventHistory>
}
export interface SchedulePollingEventSource extends ScheduleEventSourceBase {
  poll(since: number): Promise<readonly ScheduleEvent[]>
  subscribe?: never
}
export interface ScheduleSubscribedEventSource extends ScheduleEventSourceBase {
  subscribe(listener: (event: ScheduleEvent) => void): { dispose(): void }
  poll?: never
}
export type ScheduleEventSource = SchedulePollingEventSource | ScheduleSubscribedEventSource

/** Event keys are opaque: encode separators so distinct tuples cannot collide. */
export function scheduleEventRunId(
  scheduleId: string,
  event: Pick<ScheduleEvent, 'source' | 'eventKey'>,
): string {
  eventKeySchema.parse(event.eventKey)
  return `${encodeURIComponent(scheduleId)}:${encodeURIComponent(event.source)}:${encodeURIComponent(event.eventKey)}`
}
