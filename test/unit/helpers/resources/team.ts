import { vi } from 'vitest'
import { ResourceEvents } from '../../../../src/core/resources/events'
import { ResourceGovernor } from '../../../../src/core/resources/governor'
import { ResourceQueue, type ResourceLaunchRequest } from '../../../../src/core/resources/queue'
import {
  GovernedTeamSlots,
  type SchedulerSlotPort,
  type TeamCapacityPort,
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
  const localSlots = new Set<{ kind: ResourceLaunchRequest['kind'] }>()
  function localSlot(kind: ResourceLaunchRequest['kind']) {
    const entry = { kind }
    localSlots.add(entry)
    return {
      release: () => {
        localSlots.delete(entry)
        release()
      },
    }
  }
  const capacity: TeamCapacityPort = {
    governor,
    running,
    configured: vi.fn(() => 2),
    occupied: vi.fn((kind) => [...localSlots].filter((entry) => entry.kind === kind).length),
  }
  const scheduler = {
    preflight: vi.fn<SchedulerSlotPort['preflight']>(),
    acquire: vi.fn<SchedulerSlotPort['acquire']>((request) =>
      Promise.resolve(localSlot(request.kind)),
    ),
  }
  const slots = new GovernedTeamSlots(queue, scheduler, capacity)
  async function read(changes: Partial<ResourceSample>) {
    steps.push({
      atMs: clock.now(),
      // Capacity drills need only scripted memory readings; other metrics stay unknown.
      cpuPercent: null,
      memoryUsedPercent: null,
      memoryAvailableBytes: null,
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
  return {
    clock,
    events,
    governor,
    running,
    queue,
    scheduler,
    slots,
    release,
    capacity,
    localSlot,
    read,
    throttle,
  }
}
