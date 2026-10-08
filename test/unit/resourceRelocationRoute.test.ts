// FIX0160RVB: no paired-device or runner route is bound on this release, so
// both shipped governor factories must never enter relocate and must say why.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResourceGovernor } from '../../src/core/resources/governor'
import type * as governorModule from '../../src/core/resources/governor'
import type { ResourceLaunchHost } from '../../src/core/resources/launchHost'
import { createResources } from '../../src/runtime/resources/entry'
import type { RuntimeResources } from '../../src/runtime/resources/port'
import { resourceStatusText } from '../../src/runtime/resources/text'
import { RESOURCE_GIB_BYTES, RESOURCE_SAMPLE_MS, UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import {
  resourceSettingsSchema,
  resourceStatusSchema,
  type ResourceLevel,
  type ResourceSample,
  type ResourceSettings,
} from '../../src/shared/resources'
import { FakeResourceMachine } from './helpers/resources/runtime'

const machine = vi.hoisted(() => ({
  reading: undefined as ResourceSample | undefined,
  governors: [] as ResourceGovernor[],
}))

// The OS sampler is the only substitute: everything else is the shipped factory.
vi.mock('../../src/core/resources/sampler/system', () => ({
  createMachineResourceSampler: () => ({
    sample: () =>
      machine.reading === undefined
        ? Promise.reject(new Error('No scripted machine reading'))
        : Promise.resolve({ ...machine.reading, atMs: Date.now() }),
  }),
}))
// Records each governor a factory constructs, without changing its behaviour.
vi.mock('../../src/core/resources/governor', async (importOriginal) => {
  const actual = await importOriginal<typeof governorModule>()
  class RecordedGovernor extends actual.ResourceGovernor {
    constructor(options: governorModule.ResourceGovernorOptions) {
      super(options)
      machine.governors.push(this)
    }
  }
  return { ...actual, ResourceGovernor: RecordedGovernor }
})

const busy: ResourceSample = {
  atMs: 0,
  cpuPercent: 20,
  memoryUsedPercent: 92,
  memoryAvailableBytes: 8 * RESOURCE_GIB_BYTES,
  memoryTotalBytes: 16 * RESOURCE_GIB_BYTES,
  gpuPercent: null,
  diskBusyPercent: null,
  pressure: null,
}
const settingValues: readonly ResourceSettings['relocate'][] = ['paired', 'ask', 'off']
const disposals: (() => void)[] = []

beforeEach(() => {
  setUiText(EN, 'en')
  vi.useFakeTimers({ toFake: ['Date'], now: 0 })
  machine.reading = busy
})
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
  vi.useRealTimers()
  machine.reading = undefined
})

/** Sustained memory pressure, sampled every five seconds for just over two minutes. */
async function sustainPressure(read: () => Promise<ResourceLevel>): Promise<ResourceLevel[]> {
  const levels: ResourceLevel[] = []
  for (let atMs = 0; atMs <= 125_000; atMs += RESOURCE_SAMPLE_MS) {
    vi.setSystemTime(atMs)
    levels.push(await read())
  }
  return levels
}

function expectThrottleThenPause(levels: readonly ResourceLevel[]): void {
  expect(levels).not.toContain('relocate')
  expect(levels[1]).toBe('throttle')
  expect(levels.indexOf('pause')).toBe(65_000 / RESOURCE_SAMPLE_MS)
  expect(levels.at(-1)).toBe('pause')
}

function expectedRelocation(relocate: ResourceSettings['relocate']) {
  return relocate === 'off' ? 'off' : 'noRoute'
}

describe('production governor factories without a relocation route', () => {
  it.each(settingValues)(
    'the window factory reports %s honestly and escalates throttle to pause',
    async (relocate) => {
      // The window factory is one per bundle instance; load a fresh instance per setting.
      vi.resetModules()
      const { resourceGovernorHost } =
        await import('../../src/core/resources/resourceGovernorEntry')
      const before = machine.governors.length
      const host: ResourceLaunchHost = resourceGovernorHost({
        inspect: (key) => (key === 'resourceRelocate' ? { globalValue: relocate } : undefined),
        onError: vi.fn(),
      })
      disposals.push(() => {
        host.dispose()
      })
      expect(machine.governors).toHaveLength(before + 1)
      const governor = machine.governors.at(-1)
      if (governor === undefined) throw new Error('The factory constructed no governor')
      const initial = governor.status([])
      expect(initial.settings.relocate).toBe(relocate)
      expect(initial.relocation).toBe(expectedRelocation(relocate))
      expect(resourceStatusText(initial).includes(UI_TEXT.resourceRelocationNoRoute)).toBe(
        relocate !== 'off',
      )
      expectThrottleThenPause(
        await sustainPressure(async () => {
          await governor.refresh()
          return governor.level()
        }),
      )
      expect(governor.status([]).relocation).toBe(expectedRelocation(relocate))
    },
  )

  it.each(settingValues)(
    'the runtime factory reports %s in status, text and JSON and escalates throttle to pause',
    async (relocate) => {
      const store = new FakeResourceMachine()
      store.settings = resourceSettingsSchema.parse({ relocate })
      const host: RuntimeResources = await createResources(
        {
          machineDir: process.cwd(),
          machine: store,
          sleep: () => Promise.resolve(),
          onError: vi.fn(),
        },
        EN,
        'en',
      )
      disposals.push(() => {
        host.dispose()
      })
      const levels = await sustainPressure(async () => {
        const reading = await host.status()
        return reading.level
      })
      expectThrottleThenPause(levels)
      const status = await host.status()
      expect(status.relocation).toBe(expectedRelocation(relocate))
      const json = resourceStatusSchema.parse(JSON.parse(await host.command('status', true)))
      expect(json.relocation).toBe(expectedRelocation(relocate))
      const text = await host.command('status', false)
      expect(text.includes(UI_TEXT.resourceRelocationNoRoute)).toBe(relocate !== 'off')
      expect(text.split('\n', 1)[0]).toBe(`${UI_TEXT.resourceTitle}: ${UI_TEXT.resourcePause}`)
    },
  )
})
