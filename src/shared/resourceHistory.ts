import * as z from 'zod/mini'
import { UI_TEXT } from './constants'
import { fill, formatDateTime } from './l10n/text'
import {
  resourceEventSchema,
  resourceKindSchema,
  resourceRecordSchema,
  type ResourceEvent,
  type ResourceLevel,
  type ResourceRecord,
} from './resources'

const count = z.number().check(z.int(), z.gte(0))
/** M102 sends this view through its validated usage bridge to every editor. */
export const resourceHistorySchema = z.strictObject({
  minutes: z.array(resourceRecordSchema.check(z.refine((record) => record.minute !== null))),
  events: z.array(resourceEventSchema),
  counts: z.array(
    z.strictObject({
      type: z.enum(['levelChanged', 'deferred', 'relocated', 'paused', 'override']),
      kind: z.nullable(resourceKindSchema),
      count,
    }),
  ),
  work: z.array(
    z.strictObject({
      kind: resourceKindSchema,
      cpuSeconds: z.number().check(z.gte(0)),
      peakMemoryBytes: count,
    }),
  ),
})
export type ResourceHistory = z.infer<typeof resourceHistorySchema>

export function resourceHistoryLevel(level: ResourceLevel): string {
  return {
    normal: UI_TEXT.resourceNormal,
    throttle: UI_TEXT.resourceThrottle,
    relocate: UI_TEXT.resourceRelocate,
    pause: UI_TEXT.resourcePause,
  }[level]
}

export function resourceHistoryBucket(
  bucket: NonNullable<ResourceRecord['minute']>['availableMemory'],
): string {
  return {
    unknown: UI_TEXT.resourceUnknown,
    belowFloor: UI_TEXT.resourceMemoryBelowFloor,
    low: UI_TEXT.resourceMemoryLow,
    ample: UI_TEXT.resourceMemoryAmple,
  }[bucket]
}

export function resourceHistoryEventName(type: ResourceEvent['type']): string {
  return {
    levelChanged: UI_TEXT.resourceHistoryLevelChanged,
    deferred: UI_TEXT.resourceHistoryDeferred,
    relocated: UI_TEXT.resourceHistoryRelocated,
    paused: UI_TEXT.resourceHistoryPaused,
    override: UI_TEXT.resourceHistoryOverrides,
  }[type]
}

export function resourceHistoryEventDetail(event: ResourceEvent): string {
  switch (event.type) {
    case 'levelChanged': {
      return `${resourceHistoryLevel(event.from)} → ${resourceHistoryLevel(event.to)} (${event.reason})`
    }
    case 'override': {
      return fill(UI_TEXT.resourceOverrideNotice, { time: formatDateTime(event.untilMs) })
    }
    case 'deferred': {
      return `${event.kind} (${event.class})`
    }
    case 'relocated': {
      return `${event.kind} (${resourceHistoryLevel(event.level)})`
    }
    case 'paused': {
      return event.kind
    }
  }
}
