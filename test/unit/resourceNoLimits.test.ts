// NOGOVLIMITS: with no person-set limit the governor measures and shows the
// machine's state but pauses, holds or relocates nothing. The real governor
// and the real queue run here against the real production sampler reading
// this machine (os counters, pressure files, statfs on this checkout), with
// only the clock held manually so windows and recovery stay deterministic.
import { statfs } from 'node:fs/promises'
import * as os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ResourceDiskSampler,
  diskPressure,
  resourceDiskFloorBytes,
} from '../../src/core/resources/disk'
import { ResourceEvents } from '../../src/core/resources/events'
import { ResourceGovernor } from '../../src/core/resources/governor'
import { ResourceQueue } from '../../src/core/resources/queue'
import { createMachineResourceSampler } from '../../src/core/resources/sampler/system'
import {
  resourceDiskVolumeSchema,
  resourceMemoryFloorBytes,
  resourceSettingsSchema,
  type ResourceClock,
  type ResourceSettings,
} from '../../src/shared/resources'
import { RESOURCE_GIB_BYTES } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { resourceStatusText } from '../../src/runtime/resources/text'

setUiText(EN, 'en')

const PROBE_LIMITS = { timeoutMs: 1000, maxOutputBytes: 64 * 1024 }

function manualClock() {
  let nowMs = 0
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const clock: ResourceClock = {
    now: () => nowMs,
    setTimeout: (callback, delayMs) => {
      const timer = setTimeout(callback, delayMs)
      timers.add(timer)
      return () => {
        clearTimeout(timer)
        timers.delete(timer)
      }
    },
  }
  return {
    clock,
    advance: (ms: number) => {
      nowMs += ms
    },
    clear: () => {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    },
  }
}

function liveSampler(settings: () => ResourceSettings, disks?: ResourceDiskSampler) {
  return createMachineResourceSampler(settings, PROBE_LIMITS, disks)
}

function granted<T>(promise: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error(`resource ${what} was held with no limit set`))
      }, 2000)
    }),
  ])
}

describe('resource governor without person-set limits', () => {
  it('defaults every threshold to no limit', () => {
    expect(resourceSettingsSchema.parse({})).toEqual({
      enabled: true,
      cpuMaxPercent: null,
      memoryMaxPercent: null,
      memoryMinFreeGiB: null,
      gpuMaxPercent: null,
      diskBusyMaxPercent: null,
      diskMinFreeGiB: null,
      relocate: 'paired',
    })
  })

  it('accepts an explicit null for every threshold and still bounds a person’s values', () => {
    for (const key of [
      'cpuMaxPercent',
      'memoryMaxPercent',
      'memoryMinFreeGiB',
      'gpuMaxPercent',
      'diskBusyMaxPercent',
      'diskMinFreeGiB',
    ] as const)
      expect(resourceSettingsSchema.parse({ [key]: null })[key]).toBeNull()
    expect(resourceSettingsSchema.parse({ cpuMaxPercent: 30 }).cpuMaxPercent).toBe(30)
    expect(resourceSettingsSchema.parse({ memoryMaxPercent: 98 }).memoryMaxPercent).toBe(98)
    expect(resourceSettingsSchema.parse({ memoryMinFreeGiB: 0.5 }).memoryMinFreeGiB).toBe(0.5)
    expect(resourceSettingsSchema.safeParse({ cpuMaxPercent: 29 }).success).toBe(false)
    expect(resourceSettingsSchema.safeParse({ memoryMaxPercent: 99 }).success).toBe(false)
    expect(resourceSettingsSchema.safeParse({ memoryMinFreeGiB: 0.4 }).success).toBe(false)
    expect(resourceSettingsSchema.safeParse({ diskMinFreeGiB: 1.9 }).success).toBe(false)
  })

  it('computes no memory or disk floor without a person’s floor, on this machine’s real totals', () => {
    const settings = resourceSettingsSchema.parse({})
    expect(resourceMemoryFloorBytes(settings, os.totalmem())).toBeNull()
    expect(
      resourceMemoryFloorBytes(
        resourceSettingsSchema.parse({ memoryMinFreeGiB: 2 }),
        8 * RESOURCE_GIB_BYTES,
      ),
    ).toBeCloseTo(1.2 * RESOURCE_GIB_BYTES)
    expect(resourceDiskFloorBytes(settings)).toBeNull()
    expect(resourceDiskFloorBytes(resourceSettingsSchema.parse({ diskMinFreeGiB: 2 }))).toBe(
      2 * RESOURCE_GIB_BYTES,
    )
  })

  it('holds nothing back on the machine’s live reports with no limits set', async () => {
    const { clock, advance, clear } = manualClock()
    const errors: unknown[] = []
    const events = new ResourceEvents((error) => {
      errors.push(error)
    })
    const settings = resourceSettingsSchema.parse({})
    const disks = new ResourceDiskSampler(
      [{ role: 'workspace', path: path.resolve(process.cwd()) }],
      () => settings,
    )
    const sampler = liveSampler(() => settings, disks)
    const governor = new ResourceGovernor({
      clock,
      sampler,
      settings,
      events,
      hasRelocationTarget: null,
      onError: (error) => {
        errors.push(error)
      },
    })
    const queue = new ResourceQueue({
      clock,
      events,
      capacity: (kind) => governor.capacity(kind),
      running: { backgroundCount: () => 0 },
    })
    try {
      await governor.refresh()
      advance(6000)
      await governor.refresh()
      expect(governor.level()).toBe('normal')
      expect(governor.capacity('check')).toBeNull()
      expect(governor.capacity('worker')).toBeNull()
      expect(governor.diskBlocked()).toBe(false)
      const background = queue.request({ kind: 'check', class: 'background', priority: 0 })
      await granted(background.ready, 'background admission')
      const foreground = queue.request({ kind: 'check', class: 'foreground', priority: 0 })
      await granted(foreground.ready, 'foreground admission')
      // The status shows readings with no limit behind them.
      expect(resourceStatusText(governor.status(queue.counts()))).not.toContain('(')
      expect(errors).toEqual([])
    } finally {
      queue.dispose()
      governor.dispose()
      clear()
    }
  })

  it('names no critical level of ours on a nearly full volume with no floor set', () => {
    const settings = resourceSettingsSchema.parse({})
    const volume = resourceDiskVolumeSchema.parse({
      role: 'workspace',
      atMs: Date.now(),
      freeBytes: 512,
      totalBytes: 10 ** 12,
      etaMs: null,
    })
    const pressure = diskPressure([volume], settings)
    expect('isCritical' in pressure).toBe(false)
    expect(pressure.isPaused).toBe(false)
    expect(pressure.high).toBe(false)
  })

  it('refuses writes only at the person’s floor, never with no floor set', async () => {
    const stats = await statfs(process.cwd(), { bigint: true })
    const freeGiB = Number(stats.bsize * stats.bavail) / RESOURCE_GIB_BYTES
    const open = new ResourceDiskSampler(
      [{ role: 'workspace', path: path.resolve(process.cwd()) }],
      () => resourceSettingsSchema.parse({}),
    )
    // The live volume admits writes with no floor set, however little is free.
    await open.assertWrite(path.resolve(process.cwd()))
    // A floor past twice the live free space refuses at the person's level.
    const held = new ResourceDiskSampler(
      [{ role: 'workspace', path: path.resolve(process.cwd()) }],
      () => resourceSettingsSchema.parse({ diskMinFreeGiB: 2 * Math.ceil(freeGiB) + 2 }),
    )
    await expect(held.assertWrite(path.resolve(process.cwd()))).rejects.toMatchObject({
      code: 'resourceDiskFloor',
    })
  })

  it('still pauses and resumes on a person-set disk floor against the live volume', async () => {
    const { clock, advance, clear } = manualClock()
    const errors: unknown[] = []
    const events = new ResourceEvents((error) => {
      errors.push(error)
    })
    const stats = await statfs(process.cwd(), { bigint: true })
    const freeGiB = Number(stats.bsize * stats.bavail) / RESOURCE_GIB_BYTES
    const live = { current: resourceSettingsSchema.parse({}) }
    const disks = new ResourceDiskSampler(
      [{ role: 'workspace', path: path.resolve(process.cwd()) }],
      () => live.current,
    )
    const sampler = liveSampler(() => live.current, disks)
    live.current = resourceSettingsSchema.parse({
      diskMinFreeGiB: Math.ceil(freeGiB) + 10,
    })
    const governor = new ResourceGovernor({
      clock,
      sampler,
      settings: live.current,
      events,
      hasRelocationTarget: null,
      onError: (error) => {
        errors.push(error)
      },
    })
    try {
      await governor.refresh()
      expect(governor.level()).toBe('throttle')
      // Clearing the person’s floor resumes once the recovery window passes.
      live.current = resourceSettingsSchema.parse({})
      governor.updateSettings(live.current)
      advance(61_000)
      await governor.refresh()
      advance(61_000)
      await governor.refresh()
      expect(governor.level()).toBe('normal')
      expect(governor.capacity('check')).toBeNull()
      expect(errors).toEqual([])
    } finally {
      governor.dispose()
      clear()
    }
  })
})
