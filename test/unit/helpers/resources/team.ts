import { vi } from 'vitest'
import { ResourceEvents } from '../../../../src/core/resources/events'
import { ResourceGovernor } from '../../../../src/core/resources/governor'
import { ResourceQueue } from '../../../../src/core/resources/queue'
import {
  GovernedTeamSlots,
  type SchedulerSlotPort,
} from '../../../../src/core/team/scheduler/slots'
import { RESOURCE_GIB_BYTES } from '../../../../src/shared/constants'
import { resourceSettingsSchema, type ResourceSample } from '../../../../src/shared/resources'
import { FakeResourceClock, ScriptedResourceSampler } from './fakes'

export function teamResources() {
  const clock = new FakeResourceClock()
  const steps: ResourceSample[] = []
  const errors = vi.fn()
  const events = new ResourceEvents(errors)
  const governor = new ResourceGovernor({
    clock,
    events,
    settings: resourceSettingsSchema.parse({}),
    sampler: new ScriptedResourceSampler(steps),
    hasRelocationTarget: () => true,
    onError: errors,
  })
  const running = { backgroundCount: vi.fn((): number | null => 0) }
  const queue = new ResourceQueue({
    clock,
    events,
    running,
    capacity: (kind) => governor.capacity(kind),
  })
  const release = vi.fn()
  const scheduler = {
    preflight: vi.fn<SchedulerSlotPort['preflight']>(),
    acquire: vi.fn<SchedulerSlotPort['acquire']>(() => Promise.resolve({ release })),
  }
  const slots = new GovernedTeamSlots(queue, scheduler)
  async function read(changes: Partial<ResourceSample>) {
    steps.push({
      atMs: clock.now(),
      cpuPercent: 20,
      memoryUsedPercent: 40,
      memoryAvailableBytes: 8 * RESOURCE_GIB_BYTES,
      memoryTotalBytes: 16 * RESOURCE_GIB_BYTES,
      gpuPercent: null,
      diskBusyPercent: null,
      pressure: null,
      ...changes,
    })
    await governor.refresh()
  }
  async function throttle() {
    await read({ memoryUsedPercent: 95 })
    await read({ memoryUsedPercent: 95 })
    expectLevel('throttle')
  }
  function expectLevel(level: string) {
    if (governor.level() !== level)
      throw new Error(`Unexpected test governor level: ${governor.level()}`)
  }
  return { clock, events, governor, running, queue, scheduler, slots, release, read, throttle }
}
