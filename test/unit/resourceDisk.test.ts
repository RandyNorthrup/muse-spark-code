import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  ResourceDiskSampler,
  hasDeviceDiskHeadroom,
  diskPressure,
  resourceDiskFloorBytes,
} from '../../src/core/resources/disk'
import { ResourceGovernor } from '../../src/core/resources/governor'
import { ResourceEvents } from '../../src/core/resources/events'
import { RESOURCE_GIB_BYTES as GiB, RESOURCE_MIN_DWELL_MS } from '../../src/shared/constants'
import {
  deviceResourceSchema,
  readResourceSettings,
  resourceSettingsSchema,
  type ResourceSample,
  type ResourceDiskVolume,
} from '../../src/shared/resources'
import { FakeResourceClock, ScriptedResourceSampler } from './helpers/resources/fakes'

const settings = resourceSettingsSchema.parse({})
function volume(freeGiB: number | null, atMs = 0): ResourceDiskVolume {
  return {
    role: 'workspace',
    atMs,
    freeBytes: freeGiB === null ? null : freeGiB * GiB,
    totalBytes: 100 * GiB,
    etaMs: null,
  }
}
function setup() {
  const clock = new FakeResourceClock()
  const steps: ResourceSample[] = []
  const events = new ResourceEvents(vi.fn())
  const governor = new ResourceGovernor({
    clock,
    events,
    settings,
    sampler: new ScriptedResourceSampler(steps),
    hasRelocationTarget: () => false,
    onError: vi.fn(),
  })
  const read = async (disk: ResourceDiskVolume) => {
    steps.push({
      atMs: clock.now(),
      cpuPercent: 20,
      memoryUsedPercent: 40,
      memoryAvailableBytes: 8 * GiB,
      memoryTotalBytes: 16 * GiB,
      gpuPercent: null,
      diskBusyPercent: null,
      pressure: null,
      diskVolumes: [disk],
    })
    await governor.refresh()
  }
  return { clock, governor, read }
}

describe('D87.14 disk policy', () => {
  it('uses volume-scaled defaults, a 2 GiB minimum and machine-only explicit settings', () => {
    expect(resourceDiskFloorBytes(settings, 1000 * GiB)).toBe(10 * GiB)
    expect(resourceDiskFloorBytes(settings, 50 * GiB)).toBe(5 * GiB)
    expect(resourceDiskFloorBytes(settings, 8 * GiB)).toBe(2 * GiB)
    const configured = readResourceSettings((key) =>
      key === 'resourceDiskMinFreeGiB' ? { globalValue: 20, workspaceValue: 2 } : undefined,
    )
    expect(resourceDiskFloorBytes(configured, 50 * GiB)).toBe(20 * GiB)
    expect(readResourceSettings(() => ({ workspaceValue: 2 })).diskMinFreeGiB).toBeNull()
    expect(resourceSettingsSchema.safeParse({ diskMinFreeGiB: 1 }).success).toBe(false)
  })
  it('uses G transitions, retains unknown pressure and recovers stepwise with dwell and the disk margin', async () => {
    const h = setup()
    await h.read(volume(10))
    expect(h.governor.level()).toBe('throttle')
    expect(h.governor.diskBlocked()).toBe(true)
    h.clock.advance(RESOURCE_MIN_DWELL_MS)
    await h.read(volume(null))
    expect(h.governor.level()).toBe('throttle')
    expect(h.governor.diskBlocked()).toBe(true)
    h.clock.advance(RESOURCE_MIN_DWELL_MS)
    await h.read(volume(null))
    expect(h.governor.level()).toBe('throttle')
    await h.read(volume(12))
    h.clock.advance(RESOURCE_MIN_DWELL_MS)
    await h.read(volume(12))
    expect(h.governor.level()).toBe('throttle')
    await h.read(volume(13))
    h.clock.advance(RESOURCE_MIN_DWELL_MS)
    await h.read(volume(13))
    expect(h.governor.level()).toBe('normal')
    expect(h.governor.diskBlocked()).toBe(false)
  })
  it('pauses directly at half the floor and critical uses the larger 1 GiB or 1% value', async () => {
    const h = setup()
    await h.read(volume(5))
    expect(h.governor.level()).toBe('pause')
    expect(diskPressure([volume(1)], settings).isCritical).toBe(true)
    expect(diskPressure([{ ...volume(3), totalBytes: 500 * GiB }], settings).isCritical).toBe(true)
    expect(diskPressure([volume(2)], settings).isCritical).toBe(false)
  })
  it('steps early for a filling volume, without a second state machine', async () => {
    const h = setup()
    await h.read({ ...volume(15), etaMs: 5 * 60_000 })
    expect(h.governor.level()).toBe('throttle')
  })
  it('samples all write locations at 30 seconds, then 5 seconds below twice the floor', async () => {
    const clock = new FakeResourceClock()
    let free = 25n
    const read = vi.fn(() => Promise.resolve({ bsize: BigInt(GiB), blocks: 100n, bavail: free }))
    const roles = ['workspace', 'worktrees', 'temp', 'data', 'logs', 'nodeState'] as const
    const sampler = new ResourceDiskSampler(
      roles.map((role) => ({ role, path: `/${role}` })),
      () => settings,
      { now: () => clock.now(), read },
    )
    expect(await sampler.sample()).toHaveLength(6)
    clock.advance(5000)
    await sampler.sample()
    expect(read).toHaveBeenCalledTimes(6)
    free = 19n
    clock.advance(25_000)
    await sampler.sample()
    expect(read).toHaveBeenCalledTimes(12)
    clock.advance(5000)
    await sampler.sample()
    expect(read).toHaveBeenCalledTimes(18)
  })
  it('calculates the five-minute fill rate and forgets it after an unknown read', async () => {
    const clock = new FakeResourceClock()
    const read = vi.fn().mockResolvedValue({ bsize: BigInt(GiB), blocks: 100n, bavail: 20n })
    const sampler = new ResourceDiskSampler([{ role: 'temp', path: '/tmp' }], () => settings, {
      now: () => clock.now(),
      read,
    })
    await sampler.sample()
    clock.advance(5 * 60_000)
    read.mockResolvedValue({ bsize: BigInt(GiB), blocks: 100n, bavail: 15n })
    const filling = await sampler.sample()
    expect(filling[0]?.etaMs).toBe(5 * 60_000)
    clock.advance(5000)
    read.mockRejectedValue(new Error('read failed'))
    const failed = await sampler.sample()
    expect(failed[0]).toMatchObject({
      freeBytes: null,
      totalBytes: null,
      etaMs: null,
    })
    expect(sampler.headroom()).toEqual({ freeBytes: null, floorBytes: null })
    clock.advance(30_000)
    read.mockResolvedValue({ bsize: BigInt(GiB), blocks: 100n, bavail: 14n })
    const restored = await sampler.sample()
    expect(restored[0]?.etaMs).toBeNull()
  })
  it('refuses a critical write with its destination volume named and checks new file ancestors freshly', async () => {
    const workspace = path.resolve('temp/workspace')
    const newFile = path.join(workspace, 'new')
    const read = vi.fn((file: string) =>
      file === newFile
        ? Promise.reject(Object.assign(new Error('absent'), { code: 'ENOENT' }))
        : Promise.resolve({ bsize: BigInt(GiB), blocks: 100n, bavail: 1n }),
    )
    const sampler = new ResourceDiskSampler(
      [{ role: 'workspace', path: workspace }],
      () => settings,
      { now: () => 0, read },
    )
    await expect(sampler.assertWrite(newFile)).rejects.toThrow(`Cannot write to ${workspace}:`)
    expect(read.mock.calls.map(([file]) => file)).toEqual([newFile, workspace])
    read.mockRejectedValue(new Error('inaccessible'))
    await expect(sampler.assertWrite(workspace)).rejects.toThrow('inaccessible')
  })
  it('refuses relative and duplicate watch targets', () => {
    expect(
      () => new ResourceDiskSampler([{ role: 'temp', path: 'relative' }], () => settings),
    ).toThrow('Invalid')
    expect(
      () =>
        new ResourceDiskSampler(
          [
            { role: 'temp', path: '/temp' },
            { role: 'temp', path: '/other' },
          ],
          () => settings,
        ),
    ).toThrow('Invalid')
  })
  it('rejects impossible counters and unknown or below-floor device admission', async () => {
    const sampler = new ResourceDiskSampler([{ role: 'data', path: '/data' }], () => settings, {
      now: () => 0,
      read: () => Promise.resolve({ bsize: 1n, blocks: 100n, bavail: 101n }),
    })
    const invalid = await sampler.sample()
    expect(invalid[0]?.freeBytes).toBeNull()
    expect(hasDeviceDiskHeadroom({ level: 'normal', headroom: 'ample' })).toBe(false)
    expect(
      hasDeviceDiskHeadroom({
        level: 'normal',
        headroom: 'ample',
        diskFree: { freeBytes: 9 * GiB, floorBytes: 10 * GiB },
      }),
    ).toBe(false)
    expect(
      hasDeviceDiskHeadroom({
        level: 'normal',
        headroom: 'ample',
        diskFree: { freeBytes: 11 * GiB, floorBytes: 10 * GiB },
      }),
    ).toBe(true)
    expect(
      deviceResourceSchema.safeParse({
        level: 'normal',
        headroom: 'ample',
        diskFree: { freeBytes: -1, floorBytes: 10 },
      }).success,
    ).toBe(false)
  })
})
