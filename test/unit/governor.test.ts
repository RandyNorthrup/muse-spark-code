import { describe, expect, it, vi } from 'vitest'
import { ResourceEvents } from '../../src/core/resources/events'
import { ResourceGovernor } from '../../src/core/resources/governor'
import {
  RESOURCE_GIB_BYTES,
  RESOURCE_OVERRIDE_MS,
  RESOURCE_SAMPLE_MS,
} from '../../src/shared/constants'
import {
  resourceSettingsSchema,
  resourceStatusSchema,
  type ResourceEvent,
  type ResourceLevel,
  type ResourceSample,
  type ResourceSampler,
} from '../../src/shared/resources'
import { FakeResourceClock, ScriptedResourceSampler } from './helpers/resources/fakes'

function sample(atMs: number, changes: Partial<ResourceSample> = {}): ResourceSample {
  return {
    atMs,
    cpuPercent: 20,
    memoryUsedPercent: 40,
    memoryAvailableBytes: 8 * RESOURCE_GIB_BYTES,
    memoryTotalBytes: 16 * RESOURCE_GIB_BYTES,
    gpuPercent: null,
    diskBusyPercent: null,
    pressure: null,
    ...changes,
  }
}

function setup(settings = resourceSettingsSchema.parse({}), injected?: ResourceSampler) {
  const clock = new FakeResourceClock()
  const steps: ResourceSample[] = []
  const sampler = new ScriptedResourceSampler(steps)
  const onError = vi.fn()
  const events = new ResourceEvents(onError)
  const seen: ResourceEvent[] = []
  events.subscribe((event) => {
    seen.push(event)
  })
  const target = vi.fn(() => true)
  const governor = new ResourceGovernor({
    clock,
    sampler: injected ?? sampler,
    settings,
    events,
    hasRelocationTarget: target,
    onError,
  })
  const read = async (atMs: number, changes: Partial<ResourceSample> = {}) => {
    clock.advance(atMs - clock.now())
    steps.push(sample(atMs, changes))
    await governor.refresh()
    return governor.level()
  }
  const series = async (until: number, changes: Partial<ResourceSample>) => {
    for (let at = clock.now() + RESOURCE_SAMPLE_MS; at <= until; at += RESOURCE_SAMPLE_MS)
      await read(at, changes)
  }
  return { clock, steps, sampler, onError, events, seen, target, governor, read, series }
}

describe('resource governor levels', () => {
  it('backs off two independent harnesses together from the same machine readings', async () => {
    const left = setup()
    const right = setup()
    for (let atMs = 0; atMs <= 150_000; atMs += RESOURCE_SAMPLE_MS) {
      const machine = { memoryUsedPercent: 92 }
      await left.read(atMs, machine)
      await right.read(atMs, machine)
      let expected: ResourceLevel = 'pause'
      if (atMs < 5000) expected = 'normal'
      else if (atMs < 65_000) expected = 'throttle'
      else if (atMs < 125_000) expected = 'relocate'
      expect(left.governor.level()).toBe(expected)
      expect(right.governor.level()).toBe(expected)
      expect(left.governor.capacity('worker')).toBe(right.governor.capacity('worker'))
    }
    expect(left.seen).toEqual(right.seen)
    left.governor.resumeNow()
    expect(left.governor.level()).toBe('normal')
    expect(right.governor.level()).toBe('pause')
  })

  it('starts no sampling or timer at construction and enters only after 30 seconds of CPU pressure', async () => {
    const f = setup()
    f.clock.advance(120_000)
    await Promise.resolve()
    expect(f.sampler.calls).toBe(0)
    expect(f.governor.level()).toBe('normal')
    await f.read(120_000, { cpuPercent: 85 })
    await f.series(145_000, { cpuPercent: 85 })
    expect(f.governor.level()).toBe('normal')
    await f.read(150_000, { cpuPercent: 85 })
    expect(f.governor.level()).toBe('throttle')
    expect(f.seen).toEqual([
      { type: 'levelChanged', atMs: 150_000, from: 'normal', to: 'throttle', reason: 'cpu' },
    ])
    expect(f.governor.capacity('check')).toBe(1)
  })

  it('requires two consecutive known memory readings and caps the free-memory floor on small machines', async () => {
    const f = setup()
    const low = {
      memoryAvailableBytes: RESOURCE_GIB_BYTES,
      memoryTotalBytes: 8 * RESOURCE_GIB_BYTES,
    }
    await f.read(0, low)
    await f.read(5000, { ...low, memoryAvailableBytes: null })
    await f.read(10_000, low)
    expect(f.governor.level()).toBe('normal')
    await f.read(15_000, low)
    expect(f.governor.level()).toBe('throttle')
    expect(f.seen.at(-1)).toMatchObject({ reason: 'memoryFree' })
    const used = setup()
    await used.read(0, { memoryUsedPercent: 90 })
    expect(used.governor.level()).toBe('normal')
    await used.read(5000, { memoryUsedPercent: 90 })
    expect(used.governor.level()).toBe('throttle')
    const small = setup()
    await small.read(0, { ...low, memoryAvailableBytes: Math.floor(1.3 * RESOURCE_GIB_BYTES) })
    await small.read(5000, { ...low, memoryAvailableBytes: Math.floor(1.3 * RESOURCE_GIB_BYTES) })
    expect(small.governor.level()).toBe('normal')
  })

  it('escalates at 60 seconds, skips relocation without a target, and never asks for a target when off', async () => {
    const f = setup()
    await f.read(0, { memoryUsedPercent: 92 })
    await f.read(5000, { memoryUsedPercent: 92 })
    await f.series(60_000, { memoryUsedPercent: 92 })
    expect(f.governor.level()).toBe('throttle')
    await f.read(65_000, { memoryUsedPercent: 92 })
    expect(f.governor.level()).toBe('relocate')
    await f.series(125_000, { memoryUsedPercent: 92 })
    expect(f.governor.level()).toBe('pause')
    expect(f.governor.capacity('check')).toBe(0)
    const unavailable = setup()
    unavailable.target.mockReturnValue(false)
    await unavailable.read(0, { memoryUsedPercent: 92 })
    await unavailable.read(5000, { memoryUsedPercent: 92 })
    await unavailable.series(65_000, { memoryUsedPercent: 92 })
    expect(unavailable.governor.level()).toBe('pause')
    const off = setup(resourceSettingsSchema.parse({ relocate: 'off' }))
    await off.read(0, { memoryUsedPercent: 92 })
    await off.read(5000, { memoryUsedPercent: 92 })
    await off.series(65_000, { memoryUsedPercent: 92 })
    expect(off.governor.level()).toBe('pause')
    expect(off.target).not.toHaveBeenCalled()
  })

  it('takes critical memory directly to pause even during dwell, and critical CPU needs a full minute', async () => {
    const f = setup()
    await f.read(0, { memoryAvailableBytes: RESOURCE_GIB_BYTES })
    await f.read(5000, { memoryAvailableBytes: RESOURCE_GIB_BYTES })
    await f.read(10_000, { memoryAvailableBytes: RESOURCE_GIB_BYTES - 1 })
    expect(f.governor.level()).toBe('pause')
    expect(f.seen.at(-1)).toMatchObject({ reason: 'critical' })
    const cpu = setup()
    await cpu.read(0, { cpuPercent: 97 })
    await cpu.series(55_000, { cpuPercent: 97 })
    expect(cpu.governor.level()).toBe('throttle')
    await cpu.read(60_000, { cpuPercent: 97 })
    expect(cpu.governor.level()).toBe('pause')
    expect(cpu.seen.at(-1)).toMatchObject({ reason: 'critical' })
  })

  it('emits only one transition for repeated critical readings, then observes recovery from the actual transition', async () => {
    const f = setup()
    await f.read(0, { memoryAvailableBytes: 0 })
    await f.series(60_000, { memoryAvailableBytes: 0 })
    expect(f.seen).toEqual([
      { type: 'levelChanged', atMs: 0, from: 'normal', to: 'pause', reason: 'critical' },
    ])
    await f.series(125_000, {})
    expect(f.governor.level()).toBe('relocate')
  })

  it('breaks sustained CPU and critical windows on unknown or recovered readings', async () => {
    const f = setup()
    await f.read(0, { cpuPercent: 97 })
    await f.series(25_000, { cpuPercent: 97 })
    await f.read(30_000, { cpuPercent: null })
    await f.series(55_000, { cpuPercent: 97 })
    expect(f.governor.level()).toBe('normal')
    await f.read(60_000, { cpuPercent: 97 })
    expect(f.governor.level()).toBe('normal')
    await f.read(65_000, { cpuPercent: 97 })
    expect(f.governor.level()).toBe('throttle')
    await f.read(70_000, { cpuPercent: 96 })
    await f.series(125_000, { cpuPercent: 97 })
    expect(f.governor.level()).toBe('relocate')
    await f.read(130_000, { cpuPercent: 97 })
    expect(f.governor.level()).toBe('relocate')
    await f.read(135_000, { cpuPercent: 97 })
    expect(f.governor.level()).toBe('pause')
  })

  it('exits one level per full recovery window and skips unavailable relocation on the way down', async () => {
    const f = setup()
    await f.read(0, { memoryAvailableBytes: 0 })
    await f.read(5000)
    await f.series(60_000, {})
    expect(f.governor.level()).toBe('pause')
    await f.read(65_000)
    expect(f.governor.level()).toBe('relocate')
    await f.series(125_000, {})
    expect(f.governor.level()).toBe('throttle')
    await f.series(185_000, {})
    expect(f.governor.level()).toBe('normal')
    expect(f.governor.capacity('worker')).toBeNull()
    const absent = setup()
    absent.target.mockReturnValue(false)
    await absent.read(0, { memoryAvailableBytes: 0 })
    await absent.read(5000)
    await absent.series(65_000, {})
    expect(absent.governor.level()).toBe('throttle')
  })

  it('does not flap near thresholds; each normal or throttled level observes its minimum dwell', async () => {
    const f = setup()
    await f.read(0, { memoryUsedPercent: 90 })
    await f.read(5000, { memoryUsedPercent: 90 })
    for (let at = 10_000; at <= 180_000; at += 5000)
      await f.read(at, { cpuPercent: at % 10_000 === 0 ? 74 : 84, memoryUsedPercent: 85 })
    expect(f.governor.level()).toBe('throttle')
    await f.read(185_000)
    await f.series(245_000, {})
    expect(f.governor.level()).toBe('normal')
    await f.read(250_000, { memoryUsedPercent: 90 })
    await f.read(255_000, { memoryUsedPercent: 90 })
    expect(f.governor.level()).toBe('normal')
    await f.series(305_000, { memoryUsedPercent: 90 })
    expect(f.governor.level()).toBe('throttle')
    const changes = f.seen.filter((event) => event.type === 'levelChanged')
    for (let index = 1; index < changes.length; index++)
      expect(changes[index]!.atMs - changes[index - 1]!.atMs).toBeGreaterThanOrEqual(60_000)
  })

  it('requires all enabled readings below the hysteresis band; unknown cannot clear or escalate', async () => {
    const f = setup(resourceSettingsSchema.parse({ gpuMaxPercent: 70, diskBusyMaxPercent: 80 }))
    await f.read(0, { memoryAvailableBytes: 0 })
    await f.read(5000, { gpuPercent: 10, diskBusyPercent: 10 })
    await f.series(65_000, { gpuPercent: null, diskBusyPercent: 10 })
    expect(f.governor.level()).toBe('pause')
    await f.series(125_000, { gpuPercent: 63, diskBusyPercent: 10 })
    expect(f.governor.level()).toBe('pause')
    await f.series(185_000, { gpuPercent: 62, diskBusyPercent: 72 })
    expect(f.governor.level()).toBe('pause')
    await f.series(245_000, {
      gpuPercent: 62,
      diskBusyPercent: 71,
      memoryAvailableBytes: 2.5 * RESOURCE_GIB_BYTES,
    })
    expect(f.governor.level()).toBe('pause')
    await f.series(310_000, { gpuPercent: 62, diskBusyPercent: 71 })
    expect(f.governor.level()).toBe('relocate')
    await f.series(375_000, { cpuPercent: null, gpuPercent: null, diskBusyPercent: null })
    expect(f.governor.level()).toBe('relocate')
  })

  it('uses sustained GPU/disk thresholds only when set and resets evidence when settings change', async () => {
    const f = setup()
    await f.read(0, { gpuPercent: 100, diskBusyPercent: 100 })
    await f.series(60_000, { gpuPercent: 100, diskBusyPercent: 100 })
    expect(f.governor.level()).toBe('normal')
    f.governor.updateSettings(resourceSettingsSchema.parse({ gpuMaxPercent: 70 }))
    await f.read(65_000, { gpuPercent: 70 })
    await f.series(90_000, { gpuPercent: 70 })
    expect(f.governor.level()).toBe('normal')
    await f.read(95_000, { gpuPercent: 70 })
    expect(f.governor.level()).toBe('throttle')
    expect(f.seen.at(-1)).toMatchObject({ reason: 'gpu' })
    const disk = setup(resourceSettingsSchema.parse({ diskBusyMaxPercent: 80 }))
    await disk.read(0, { diskBusyPercent: 80 })
    await disk.series(30_000, { diskBusyPercent: 80 })
    expect(disk.governor.level()).toBe('throttle')
    expect(disk.seen.at(-1)).toMatchObject({ reason: 'disk' })
  })

  it.each(['gpuPercent', 'diskBusyPercent'] as const)(
    'recovers from sustained %s overload at limits from 1 to 10 percent',
    async (metric) => {
      for (const limit of [1, 1.5, 5, 10]) {
        const settings = resourceSettingsSchema.parse({
          [metric === 'gpuPercent' ? 'gpuMaxPercent' : 'diskBusyMaxPercent']: limit,
          relocate: 'off',
        })
        const f = setup(settings)
        await f.read(0, { [metric]: limit })
        await f.series(90_000, { [metric]: limit })
        expect(f.governor.level(), `${metric} limit ${String(limit)}`).toBe('pause')
        await f.series(215_000, { [metric]: 0 })
        expect(f.governor.level(), `${metric} limit ${String(limit)}`).toBe('normal')
      }
    },
  )

  it('has a reachable percentage recovery band across the full valid settings ranges', async () => {
    for (let limit = 1; limit <= 100; limit += 0.25) {
      const settings = resourceSettingsSchema.parse({
        cpuMaxPercent: Math.max(30, limit),
        memoryMaxPercent: Math.min(98, Math.max(40, limit)),
        gpuMaxPercent: limit,
        diskBusyMaxPercent: limit,
        relocate: 'off',
      })
      const f = setup(settings)
      const idle = { cpuPercent: 0, memoryUsedPercent: 0, gpuPercent: 0, diskBusyPercent: 0 }
      await f.read(0, { ...idle, memoryAvailableBytes: 0 })
      expect(f.governor.level()).toBe('pause')
      await f.series(125_000, idle)
      expect(f.governor.level(), `settings at limit ${String(limit)}`).toBe('normal')
    }
  })

  it.each([
    [1, 0.5],
    [2, 1.5],
    [5, 4.5],
    [10, 9],
    [100, 90],
  ])(
    'holds the relative recovery boundary %s → %s with a half-point margin floor',
    async (limit, boundary) => {
      const f = setup(resourceSettingsSchema.parse({ gpuMaxPercent: limit, relocate: 'off' }))
      await f.read(0, { gpuPercent: 0, memoryAvailableBytes: 0 })
      await f.series(65_000, { gpuPercent: boundary })
      expect(f.governor.level()).toBe('pause')
      await f.series(130_000, { gpuPercent: boundary - 0.25 })
      expect(f.governor.level()).toBe('throttle')
    },
  )

  it('recovers on a 512 MiB container with default memory settings', async () => {
    const f = setup()
    const total = RESOURCE_GIB_BYTES / 2
    await f.read(0, { memoryAvailableBytes: 0, memoryTotalBytes: total })
    expect(f.governor.level()).toBe('pause')
    await f.series(185_000, {
      memoryUsedPercent: 0,
      memoryAvailableBytes: total,
      memoryTotalBytes: total,
    })
    expect(f.governor.level()).toBe('normal')
    expect(f.onError).not.toHaveBeenCalled()
  })

  it('has a reachable free-memory recovery band across all valid floor settings and machine sizes', async () => {
    for (let floorGiB = 0.5; floorGiB <= 64; floorGiB += 0.5) {
      for (const total of [
        1,
        2,
        1024,
        RESOURCE_GIB_BYTES / 2,
        8 * RESOURCE_GIB_BYTES,
        1024 * RESOURCE_GIB_BYTES,
      ]) {
        const f = setup(
          resourceSettingsSchema.parse({ memoryMinFreeGiB: floorGiB, relocate: 'off' }),
        )
        await f.read(0, { memoryAvailableBytes: 0, memoryTotalBytes: total })
        expect(f.governor.level()).toBe('pause')
        await f.series(125_000, {
          memoryUsedPercent: 0,
          memoryAvailableBytes: total,
          memoryTotalBytes: total,
        })
        expect(f.governor.level(), `${String(floorGiB)} GiB floor on ${String(total)} bytes`).toBe(
          'normal',
        )
        expect(f.onError).not.toHaveBeenCalled()
      }
    }
  })

  it('keeps the free-memory margin floor below the tiny-machine headroom', async () => {
    const f = setup(resourceSettingsSchema.parse({ relocate: 'off' }))
    await f.read(0, { memoryAvailableBytes: 0, memoryTotalBytes: 2 })
    await f.series(65_000, { memoryUsedPercent: 0, memoryAvailableBytes: 1, memoryTotalBytes: 2 })
    expect(f.governor.level()).toBe('pause')
    await f.series(190_000, { memoryUsedPercent: 0, memoryAvailableBytes: 2, memoryTotalBytes: 2 })
    expect(f.governor.level()).toBe('normal')
  })

  it.each([
    [RESOURCE_GIB_BYTES / 2, RESOURCE_GIB_BYTES / 8],
    [16 * RESOURCE_GIB_BYTES, 2.5 * RESOURCE_GIB_BYTES],
  ])(
    'holds the scaled/capped memory recovery boundary on a %s-byte machine',
    async (total, boundary) => {
      const f = setup(resourceSettingsSchema.parse({ relocate: 'off' }))
      await f.read(0, { memoryAvailableBytes: 0, memoryTotalBytes: total })
      await f.series(65_000, {
        memoryUsedPercent: 0,
        memoryAvailableBytes: boundary,
        memoryTotalBytes: total,
      })
      expect(f.governor.level()).toBe('pause')
      await f.series(130_000, {
        memoryUsedPercent: 0,
        memoryAvailableBytes: boundary + 1,
        memoryTotalBytes: total,
      })
      expect(f.governor.level()).toBe('throttle')
    },
  )

  it.each([
    ['cpu band', { cpuPercent: 76.5 }],
    ['memory-used band', { memoryUsedPercent: 81 }],
    ['free-memory band', { memoryAvailableBytes: 2.5 * RESOURCE_GIB_BYTES }],
    ['GPU band', { gpuPercent: 63 }],
    ['disk band', { diskBusyPercent: 72 }],
    ['unknown CPU', { cpuPercent: null }],
    ['unknown used memory', { memoryUsedPercent: null }],
    ['unknown available memory', { memoryAvailableBytes: null }],
    ['unknown total memory', { memoryTotalBytes: null }],
    ['unknown GPU', { gpuPercent: null }],
    ['unknown disk', { diskBusyPercent: null }],
  ] satisfies [string, Partial<ResourceSample>][])(
    'holds the level for %s until a full known recovery window',
    async (_label, reading) => {
      const f = setup(resourceSettingsSchema.parse({ gpuMaxPercent: 70, diskBusyMaxPercent: 80 }))
      const good = { gpuPercent: 10, diskBusyPercent: 10 }
      await f.read(0, { ...good, memoryAvailableBytes: 0 })
      await f.series(65_000, { ...good, ...reading })
      expect(f.governor.level()).toBe('pause')
      await f.series(130_000, good)
      expect(f.governor.level()).toBe('relocate')
    },
  )

  it('resets sustained evidence on settings changes and refuses invalid settings without losing the current policy', async () => {
    const f = setup()
    await f.read(0, { cpuPercent: 86 })
    await f.series(25_000, { cpuPercent: 86 })
    f.governor.updateSettings(resourceSettingsSchema.parse({}))
    await f.series(55_000, { cpuPercent: 86 })
    expect(f.governor.level()).toBe('normal')
    await f.read(60_000, { cpuPercent: 86 })
    expect(f.governor.level()).toBe('throttle')
    const invalid = resourceSettingsSchema.parse({})
    invalid.cpuMaxPercent = 29
    expect(() => {
      f.governor.updateSettings(invalid)
    }).toThrow()
    expect(f.governor.status([]).settings.cpuMaxPercent).toBe(85)
    expect(f.governor.level()).toBe('throttle')
    expect(() => setup(invalid)).toThrow()
  })

  it('resume holds normal for 15 minutes through critical load, then uses a fresh reading', async () => {
    const f = setup()
    await f.read(0, { memoryAvailableBytes: 0 })
    f.governor.resumeNow()
    expect(f.governor.level()).toBe('normal')
    expect(f.seen.at(-1)).toEqual({ type: 'override', atMs: 0, untilMs: 900_000 })
    await f.series(RESOURCE_OVERRIDE_MS - RESOURCE_SAMPLE_MS, { memoryAvailableBytes: 0 })
    expect(f.governor.level()).toBe('normal')
    f.steps.push(sample(RESOURCE_OVERRIDE_MS, { memoryAvailableBytes: 0 }))
    f.clock.advance(RESOURCE_SAMPLE_MS)
    await Promise.resolve()
    expect(f.sampler.calls).toBe(181)
    await f.governor.refresh()
    expect(f.governor.level()).toBe('pause')
    expect(f.governor.status([]).overrideUntilMs).toBeNull()
    const recovered = setup()
    await recovered.read(0, { memoryAvailableBytes: 0 })
    recovered.governor.resumeNow()
    recovered.steps.push(sample(RESOURCE_OVERRIDE_MS))
    recovered.clock.advance(RESOURCE_OVERRIDE_MS)
    await recovered.governor.refresh()
    expect(recovered.governor.level()).toBe('normal')
  })

  it('extends an override, respects disabled settings, and validates detached status snapshots', async () => {
    const f = setup()
    await f.read(0, { memoryAvailableBytes: 0 })
    f.governor.resumeNow()
    f.clock.advance(5000)
    f.governor.resumeNow()
    f.clock.advance(RESOURCE_OVERRIDE_MS - 5000)
    await Promise.resolve()
    expect(f.sampler.calls).toBe(1)
    f.governor.updateSettings(resourceSettingsSchema.parse({ enabled: false }))
    await f.read(RESOURCE_OVERRIDE_MS, { memoryAvailableBytes: 0 })
    expect(f.governor.level()).toBe('normal')
    expect(f.governor.status([]).overrideUntilMs).toBeNull()
    const status = f.governor.status([{ kind: 'check', class: 'background', count: 2 }])
    expect(resourceStatusSchema.safeParse(status).success).toBe(true)
    status.settings.enabled = true
    status.sample!.cpuPercent = 100
    expect(f.governor.status([]).settings.enabled).toBe(false)
    expect(f.governor.status([]).sample!.cpuPercent).toBe(20)
    f.governor.updateSettings(resourceSettingsSchema.parse({}))
    await f.read(905_000, { memoryAvailableBytes: 0 })
    expect(f.governor.level()).toBe('pause')
    f.governor.updateSettings(resourceSettingsSchema.parse({ enabled: false }))
    expect(f.governor.level()).toBe('normal')
    expect(f.seen.at(-1)).toMatchObject({ reason: 'disabled' })
  })

  it.each([
    [false, RESOURCE_OVERRIDE_MS - 1000],
    [true, RESOURCE_OVERRIDE_MS - 1000],
    [false, RESOURCE_OVERRIDE_MS],
    [true, RESOURCE_OVERRIDE_MS],
  ] as const)(
    'waits for a serial post-expiry sample when an older read is pending (fresh critical: %s, older time: %s)',
    async (freshCritical, olderAt) => {
      const older = Promise.withResolvers<ResourceSample>()
      const fresh = Promise.withResolvers<ResourceSample>()
      const sampler = {
        sample: vi
          .fn<() => Promise<ResourceSample>>()
          .mockResolvedValueOnce(sample(0, { memoryAvailableBytes: 0 }))
          .mockReturnValueOnce(older.promise)
          .mockReturnValueOnce(fresh.promise),
      }
      const f = setup(undefined, sampler)
      await f.governor.refresh()
      f.governor.resumeNow()
      f.clock.advance(RESOURCE_OVERRIDE_MS - 1000)
      const pending = f.governor.refresh()
      await Promise.resolve()
      expect(sampler.sample).toHaveBeenCalledTimes(2)
      f.clock.advance(1000)
      expect(f.governor.status([]).overrideUntilMs).toBeNull()
      expect(sampler.sample).toHaveBeenCalledTimes(2)
      older.resolve(
        sample(olderAt, {
          memoryAvailableBytes: freshCritical ? 8 * RESOURCE_GIB_BYTES : 0,
        }),
      )
      await Promise.resolve()
      expect(sampler.sample).toHaveBeenCalledTimes(3)
      expect(f.governor.refresh()).toBe(pending)
      expect(f.governor.status([]).sample!.atMs).toBe(0)
      expect(f.governor.level()).toBe('normal')
      fresh.resolve(
        sample(RESOURCE_OVERRIDE_MS, {
          memoryAvailableBytes: freshCritical ? 0 : 8 * RESOURCE_GIB_BYTES,
        }),
      )
      await pending
      expect(f.governor.level()).toBe(freshCritical ? 'pause' : 'normal')
      expect(f.governor.status([]).sample!.atMs).toBe(RESOURCE_OVERRIDE_MS)
      expect(f.onError).not.toHaveBeenCalled()
    },
  )

  it('requests the post-expiry sample even when the older read rejects', async () => {
    const older = Promise.withResolvers<ResourceSample>()
    const fresh = Promise.withResolvers<ResourceSample>()
    const sampler = {
      sample: vi
        .fn<() => Promise<ResourceSample>>()
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(fresh.promise),
    }
    const f = setup(undefined, sampler)
    f.governor.resumeNow()
    f.clock.advance(RESOURCE_OVERRIDE_MS - 1000)
    f.governor.start()
    f.clock.advance(0)
    const pending = f.governor.refresh()
    await Promise.resolve()
    f.clock.advance(1000)
    older.reject(new Error('Pre-expiry read failed'))
    await Promise.resolve()
    expect(sampler.sample).toHaveBeenCalledTimes(2)
    fresh.resolve(sample(RESOURCE_OVERRIDE_MS, { memoryAvailableBytes: 0 }))
    await pending
    expect(f.governor.level()).toBe('pause')
    expect(f.onError).not.toHaveBeenCalled()
  })

  it('refuses a pre-expiry timestamp returned by the newly requested sample and can retry', async () => {
    const sampler = {
      sample: vi
        .fn<() => Promise<ResourceSample>>()
        .mockRejectedValueOnce(new Error('Fresh read failed'))
        .mockResolvedValueOnce(sample(RESOURCE_OVERRIDE_MS - 1, { memoryAvailableBytes: 0 }))
        .mockResolvedValueOnce(
          sample(RESOURCE_OVERRIDE_MS + RESOURCE_SAMPLE_MS, { memoryAvailableBytes: 0 }),
        ),
    }
    const f = setup(undefined, sampler)
    f.governor.resumeNow()
    f.clock.advance(RESOURCE_OVERRIDE_MS)
    await f.governor.refresh()
    expect(f.governor.level()).toBe('normal')
    expect(f.governor.status([]).sample).toMatchObject({
      atMs: RESOURCE_OVERRIDE_MS,
      memoryAvailableBytes: null,
    })
    expect(f.onError).toHaveBeenCalledTimes(1)
    f.clock.advance(RESOURCE_SAMPLE_MS)
    await f.governor.refresh()
    expect(f.governor.level()).toBe('normal')
    expect(f.onError).toHaveBeenCalledTimes(2)
    await f.governor.refresh()
    expect(f.governor.level()).toBe('pause')
  })

  it.each(['renew', 'disable', 'dispose'] as const)(
    'cancels pending expiry freshness on %s without starting another read',
    async (action) => {
      const older = Promise.withResolvers<ResourceSample>()
      const sampler = {
        sample: vi.fn<() => Promise<ResourceSample>>().mockReturnValue(older.promise),
      }
      const f = setup(undefined, sampler)
      f.governor.resumeNow()
      f.clock.advance(RESOURCE_OVERRIDE_MS - 1000)
      const pending = f.governor.refresh()
      await Promise.resolve()
      f.clock.advance(1000)
      if (action === 'renew') f.governor.resumeNow()
      else if (action === 'disable')
        f.governor.updateSettings(resourceSettingsSchema.parse({ enabled: false }))
      else f.governor.dispose()
      older.resolve(sample(RESOURCE_OVERRIDE_MS - 1000, { memoryAvailableBytes: 0 }))
      await pending
      expect(sampler.sample).toHaveBeenCalledTimes(1)
      expect(f.governor.level()).toBe('normal')
      expect(f.onError).not.toHaveBeenCalled()
    },
  )

  it('starts sustained and critical CPU evidence again from the fresh expiry sample', async () => {
    const f = setup()
    f.governor.resumeNow()
    await f.read(0, { cpuPercent: 97 })
    await f.series(RESOURCE_OVERRIDE_MS - RESOURCE_SAMPLE_MS, { cpuPercent: 97 })
    f.steps.push(sample(RESOURCE_OVERRIDE_MS, { cpuPercent: 97 }))
    f.clock.advance(RESOURCE_SAMPLE_MS)
    await f.governor.refresh()
    expect(f.governor.level()).toBe('normal')
    await f.series(RESOURCE_OVERRIDE_MS + 30_000, { cpuPercent: 97 })
    expect(f.governor.level()).toBe('throttle')
    await f.series(RESOURCE_OVERRIDE_MS + 60_000, { cpuPercent: 97 })
    expect(f.governor.level()).toBe('pause')
  })

  it('shares pending samples, starts one serial timer, and discards a sample after disposal', async () => {
    const first = Promise.withResolvers<ResourceSample>()
    const second = Promise.withResolvers<ResourceSample>()
    const sampler = {
      sample: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    }
    const f = setup(undefined, sampler)
    const timers = vi.spyOn(f.clock, 'setTimeout')
    f.governor.start()
    f.governor.start()
    expect(timers).toHaveBeenCalledTimes(1)
    f.clock.advance(0)
    const pending = f.governor.refresh()
    expect(f.governor.refresh()).toBe(pending)
    await Promise.resolve()
    expect(sampler.sample).toHaveBeenCalledTimes(1)
    first.resolve(sample(0))
    await pending
    await Promise.resolve()
    f.clock.advance(5000)
    await Promise.resolve()
    expect(sampler.sample).toHaveBeenCalledTimes(2)
    f.governor.dispose()
    second.resolve(sample(5000, { memoryAvailableBytes: 0 }))
    await Promise.resolve()
    await Promise.resolve()
    f.clock.advance(60_000)
    expect(f.governor.level()).toBe('normal')
    expect(sampler.sample).toHaveBeenCalledTimes(2)
    await expect(f.governor.refresh()).rejects.toThrow('disposed')
    expect(() => {
      f.governor.start()
    }).toThrow('disposed')
    expect(() => {
      f.governor.resumeNow()
    }).toThrow('disposed')
  })

  it('cancels disabled overrides and all disposal timers without further reads', async () => {
    const f = setup()
    await f.read(0)
    f.governor.resumeNow()
    f.governor.updateSettings(resourceSettingsSchema.parse({ enabled: false }))
    f.clock.advance(RESOURCE_OVERRIDE_MS)
    await Promise.resolve()
    expect(f.sampler.calls).toBe(1)
    f.governor.start()
    f.steps.push(sample(f.clock.now()))
    f.clock.advance(0)
    await f.governor.refresh()
    await Promise.resolve()
    f.governor.resumeNow()
    const refresh = vi.spyOn(f.governor, 'refresh')
    f.governor.dispose()
    f.clock.advance(RESOURCE_OVERRIDE_MS)
    await Promise.resolve()
    expect(refresh).not.toHaveBeenCalled()
    expect(f.sampler.calls).toBe(2)
  })

  it('discards a failed in-flight sample after disposal without notifying or changing status', async () => {
    const failed = Promise.withResolvers<ResourceSample>()
    const f = setup(undefined, { sample: () => failed.promise })
    const pending = f.governor.refresh()
    await Promise.resolve()
    f.governor.dispose()
    failed.reject(new Error('Late sampler failure'))
    await pending
    expect(f.onError).not.toHaveBeenCalled()
    expect(f.governor.status([]).sample).toBeNull()
    expect(f.seen).toEqual([])
  })

  it('treats rejected, throwing or invalid sampler outputs as unknown and can retry', async () => {
    const sampler = {
      sample: vi
        .fn<() => Promise<ResourceSample>>()
        .mockResolvedValueOnce(sample(0, { memoryAvailableBytes: 0 }))
        .mockRejectedValueOnce(new Error('Probe failed'))
        .mockImplementationOnce(() => {
          throw new Error('Synchronous probe failure')
        })
        .mockResolvedValueOnce(sample(15_000, { cpuPercent: -1 }))
        .mockResolvedValue(sample(20_000)),
    }
    const f = setup(undefined, sampler)
    await f.governor.refresh()
    for (let at = 5000; at <= 15_000; at += 5000) {
      f.clock.advance(5000)
      await f.governor.refresh()
      expect(f.governor.status([]).sample!.cpuPercent).toBeNull()
      expect(f.governor.level()).toBe('pause')
    }
    expect(f.onError).toHaveBeenCalledTimes(3)
    f.clock.advance(5000)
    await f.governor.refresh()
    expect(f.governor.status([]).sample!.cpuPercent).toBe(20)
  })
})

describe('resource event subscriptions', () => {
  it('validates privacy, isolates listener mutation and errors, and unsubscribes', () => {
    const onError = vi.fn()
    const events = new ResourceEvents(onError)
    const broken = events.subscribe((event) => {
      event.atMs = 99
      throw new Error('Observer failed')
    })
    const observer = vi.fn()
    const unsubscribe = events.subscribe(observer)
    const event: ResourceEvent = { type: 'override', atMs: 0, untilMs: 900_000 }
    events.publish(event)
    expect(observer).toHaveBeenCalledWith(event)
    expect(onError).toHaveBeenCalledTimes(1)
    broken()
    unsubscribe()
    events.publish(event)
    expect(observer).toHaveBeenCalledTimes(1)
    const privateEvent = { ...event, pid: 1234, command: 'private-canary', path: '/private-canary' }
    expect(() => {
      events.publish(privateEvent)
    }).toThrow()
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
