import { vi } from 'vitest'
import { createRuntimeResourceHost } from '../../../../src/runtime/resources/host'
import type { ResourceMachineStore } from '../../../../src/runtime/resources/port'
import {
  resourceSettingsSchema,
  type ResourceSample,
  type ResourceSettings,
} from '../../../../src/shared/resources'
import { RESOURCE_GIB_BYTES } from '../../../../src/shared/constants'
import { FakeResourceClock } from './fakes'

export class FakeResourceMachine implements ResourceMachineStore {
  settings = resourceSettingsSchema.parse({})
  until: number | null = null
  readSettings = vi.fn(() => Promise.resolve(this.settings))
  readResumeUntil = vi.fn(() => Promise.resolve(this.until))
  writeResumeUntil = vi.fn((until: number) => {
    this.until = until
    return Promise.resolve()
  })
}

export async function runtimeResources(
  overrides: Partial<ResourceSettings> = {},
  machine = new FakeResourceMachine(),
) {
  const clock = new FakeResourceClock()
  const reading: Partial<ResourceSample> = {}
  const sampler = {
    sample: vi.fn(() =>
      Promise.resolve({
        atMs: clock.now(),
        cpuPercent: 20,
        memoryUsedPercent: 40,
        memoryAvailableBytes: 8 * RESOURCE_GIB_BYTES,
        memoryTotalBytes: 16 * RESOURCE_GIB_BYTES,
        gpuPercent: null,
        diskBusyPercent: null,
        pressure: null,
        ...reading,
      }),
    ),
  }
  const onError = vi.fn()
  const running = { backgroundCount: vi.fn((): number | null => 0) }
  const host = await createRuntimeResourceHost({
    clock,
    sampler,
    machine,
    running,
    overrides,
    onError,
  })
  return { host, clock, reading, sampler, machine, onError, running }
}
