// One real governor and queue over a caller-built sampler, for the tests
// that admit work against live readings.
import type { ResourceEvents } from '../../../src/core/resources/events'
import { ResourceGovernor } from '../../../src/core/resources/governor'
import { ResourceQueue } from '../../../src/core/resources/queue'
import type {
  ResourceClock,
  ResourceSampler,
  ResourceSettings,
} from '../../../src/shared/resources'

export function resourceGovernorAndQueue(input: {
  readonly clock: ResourceClock
  readonly sampler: ResourceSampler
  readonly settings: ResourceSettings
  readonly events: ResourceEvents
  readonly backgroundCount: () => number | null
  readonly onError: (error: unknown) => void
}): { readonly governor: ResourceGovernor; readonly queue: ResourceQueue } {
  const governor = new ResourceGovernor({
    clock: input.clock,
    sampler: input.sampler,
    settings: input.settings,
    events: input.events,
    hasRelocationTarget: null,
    onError: input.onError,
  })
  const queue = new ResourceQueue({
    clock: input.clock,
    events: input.events,
    capacity: (kind) => governor.capacity(kind),
    running: { backgroundCount: input.backgroundCount },
  })
  return { governor, queue }
}
