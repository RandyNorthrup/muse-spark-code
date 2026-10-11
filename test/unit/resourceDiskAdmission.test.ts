import { mkdir, mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { nativeCreated, useCreatedNative } from './helpers/createdNative'
import { CreatedRegistry } from '../../src/core/resources/createdRegistry'
import { TreeTempRoots } from '../../src/host/resources/tempRoots'
import type { ResourceTempRoot, ResourceLease } from '../../src/core/resources/launch'
import type { ResourceLaunchHostOptions } from '../../src/core/resources/launchHost'
import { describe, expect, it, vi } from 'vitest'
import { ResourceGovernor } from '../../src/core/resources/governor'
import { ResourceLaunchHost } from '../../src/core/resources/launchHost'
import { ResourceQueue } from '../../src/core/resources/queue'
import { ResourceEvents } from '../../src/core/resources/events'
import { resourceEnvironment } from '../../src/core/resources/launch'
import { assertResourceWrite } from '../../src/core/resources/admission'
import { ResourceDiskSampler } from '../../src/core/resources/disk'
import {
  RESOURCE_DISK_READ_TIMEOUT_MS,
  RESOURCE_FOREGROUND_WAIT_MS,
  RESOURCE_GIB_BYTES as GiB,
  RESOURCE_MIN_DWELL_MS,
  RESOURCE_TEMP_KEEP_MS,
} from '../../src/shared/constants'
import { resourceSettingsSchema, type ResourceSample } from '../../src/shared/resources'
import { FakeResourceClock } from './helpers/resources/fakes'

useCreatedNative()

function setup(extra: Partial<ResourceLaunchHostOptions> = {}, clock = new FakeResourceClock()) {
  let current: ResourceSample = {
    atMs: 0,
    cpuPercent: 20,
    memoryUsedPercent: 40,
    memoryAvailableBytes: 8 * GiB,
    memoryTotalBytes: 16 * GiB,
    gpuPercent: null,
    diskBusyPercent: null,
    pressure: null,
  }
  const errors = vi.fn()
  const events = new ResourceEvents(errors)
  const settings = resourceSettingsSchema.parse({})
  const governor = new ResourceGovernor({
    clock,
    events,
    settings,
    sampler: { sample: () => Promise.resolve(current) },
    hasRelocationTarget: () => false,
    onError: errors,
  })
  const host = new ResourceLaunchHost({
    clock,
    events,
    governor,
    settings: () => settings,
    bindTree: () => Promise.resolve(null),
    onError: errors,
    ...extra,
  })
  const read = async (free: number) => {
    current = {
      atMs: clock.now(),
      cpuPercent: 20,
      memoryUsedPercent: 40,
      memoryAvailableBytes: 8 * GiB,
      memoryTotalBytes: 16 * GiB,
      gpuPercent: null,
      diskBusyPercent: null,
      pressure: null,
      diskVolumes: [
        {
          role: 'workspace',
          atMs: clock.now(),
          freeBytes: free * GiB,
          totalBytes: 100 * GiB,
          etaMs: null,
        },
      ],
    }
    await governor.refresh()
  }
  return { host, governor, clock, read, events, settings }
}

describe('DK admission, safe points and spawn environment', () => {
  it('refuses a write when the resource guard has no installed host', async () => {
    await expect(assertResourceWrite(process.cwd())).rejects.toThrow('guard unavailable')
  })
  it('holds new tests at disk throttle, lets a running test finish, and admits FIFO after recovery', async () => {
    const h = setup()
    const running = await h.host.admit('check', undefined, 'foreground')
    await h.read(9)
    const admitted: number[] = []
    const first = (async () => {
      const lease = await h.host.admit('check', undefined, 'foreground')
      admitted.push(1)
      return lease
    })()
    const second = (async () => {
      const lease = await h.host.admit('check', undefined, 'foreground')
      admitted.push(2)
      return lease
    })()
    h.clock.advance(RESOURCE_FOREGROUND_WAIT_MS)
    await Promise.resolve()
    expect(admitted).toEqual([])
    await h.governor.refresh()
    running.complete(true)
    expect(admitted).toEqual([])
    await h.read(13)
    h.clock.advance(RESOURCE_MIN_DWELL_MS)
    await h.read(13)
    expect(h.governor.level()).toBe('normal')
    const leases = await Promise.all([first, second])
    expect(admitted).toEqual([1, 2])
    for (const lease of leases) lease.complete(true)
    h.host.dispose()
  })
  it('wakes on disk recovery during normal-level dwell without requiring a level event', async () => {
    const h = setup()
    await h.read(9)
    h.governor.updateSettings({ ...h.settings, enabled: false })
    h.governor.updateSettings(h.settings)
    await h.read(9)
    expect(h.governor.level()).toBe('normal')
    let wasGranted = false
    const pending = (async () => {
      const lease = await h.host.admit('check')
      wasGranted = true
      return lease
    })()
    await h.read(13)
    await Promise.resolve()
    await Promise.resolve()
    expect(wasGranted).toBe(true)
    const lease = await pending
    lease.complete(true)
    h.host.dispose()
  })
  it('does not let Run now bypass disk-heavy admission, including install/build/worktree/download work', async () => {
    const clock = new FakeResourceClock()
    const events = new ResourceEvents(vi.fn())
    let isBlocked = true
    const queue = new ResourceQueue({
      clock,
      events,
      capacity: () => null,
      running: { backgroundCount: () => 0 },
      diskBlocked: () => isBlocked,
    })
    for (const operation of ['install', 'build', 'worktree', 'download']) {
      const stop = new AbortController()
      const request = queue.request(
        { kind: 'other', class: 'foreground', priority: 0, diskHeavy: true },
        stop.signal,
      )
      expect(request.runNow(), operation).toBe(false)
      clock.advance(RESOURCE_FOREGROUND_WAIT_MS)
      expect(queue.counts()).toHaveLength(1)
      const rejected = expect(request.ready).rejects.toMatchObject({ name: 'AbortError' })
      stop.abort()
      await rejected
    }
    const request = queue.request({
      kind: 'other',
      class: 'foreground',
      priority: 0,
      diskHeavy: true,
    })
    isBlocked = false
    queue.wake()
    const permit = await request.ready
    permit.release()
    queue.dispose()
  })
  it('pauses a lane at a safe point, resumes on an override, and cancel/disposal do not wait', async () => {
    const h = setup()
    await h.read(1)
    let hasPassed = false
    const paused = (async () => {
      await h.host.safePoint('worker')
      hasPassed = true
    })()
    await Promise.resolve()
    expect(hasPassed).toBe(false)
    const stop = new AbortController()
    const cancelled = h.host.safePoint('worker', stop.signal)
    const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    stop.abort()
    await rejected
    h.governor.resumeNow()
    await paused
    expect(hasPassed).toBe(true)
    h.host.dispose()
    await expect(h.host.safePoint('worker')).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('keeps cancellation fast at critical and ordinary foreground retains its bounded wait', async () => {
    const h = setup()
    await h.read(1)
    const stop = new AbortController()
    const cancelled = h.host.admit('check', stop.signal)
    const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    stop.abort()
    await rejected
    const checkpoint = h.host.admit('other', undefined, 'foreground', false)
    await Promise.resolve()
    h.clock.advance(RESOURCE_FOREGROUND_WAIT_MS)
    const lease = await checkpoint
    lease.complete(true)
    h.host.dispose()
  })
  it('replaces every case variant of temp variables while preserving other allowed environment values', () => {
    const finish = vi.fn(() => Promise.resolve())
    const env = { temp: '/old', TMP: '/old', tmpdir: '/old', PATH: '/allowed', SAMPLE: 'keep' }
    const lease = {
      register: vi.fn(),
      complete: vi.fn(),
      background: vi.fn(),
      temp: {
        root: '/tree',
        profile: '/tree/profile',
        cache: '/tree/cache',
        environment: { TMPDIR: '/tree', TEMP: '/tree', TMP: '/tree' },
        finish,
      },
    }
    expect(resourceEnvironment(env, lease)).toEqual({
      PATH: '/allowed',
      SAMPLE: 'keep',
      TMPDIR: '/tree',
      TEMP: '/tree',
      TMP: '/tree',
    })
    expect(env.temp).toBe('/old')
    expect(resourceEnvironment(env, undefined)).toEqual(env)
  })
  it.each(['disposal', 'cancellation'])(
    'cleans an unspawned temp root when %s wins its creation race',
    async (action) => {
      const pendingRoot = Promise.withResolvers<ResourceTempRoot>()
      const create = vi.fn(() => pendingRoot.promise)
      const finish = vi.fn(() => Promise.resolve())
      const root: ResourceTempRoot = {
        root: '/tree',
        profile: '/tree/profile',
        cache: '/tree/cache',
        environment: { TMPDIR: '/tree', TEMP: '/tree', TMP: '/tree' },
        finish,
      }
      const h = setup({ tempRoots: { create } })
      const stop = new AbortController()
      let outcome: unknown
      const pending = (async () => {
        try {
          await h.host.admit('other', stop.signal)
        } catch (error: unknown) {
          outcome = error
        }
      })()
      await Promise.resolve()
      expect(create).toHaveBeenCalledOnce()
      try {
        if (action === 'disposal') h.host.dispose()
        else stop.abort()
        await vi.waitFor(() => {
          expect(outcome).toMatchObject({ name: 'AbortError' })
        })
        expect(finish).not.toHaveBeenCalled()
      } finally {
        pendingRoot.resolve(root)
        await pending
        await vi.waitFor(() => {
          expect(finish).toHaveBeenCalledWith(false)
        })
        h.host.dispose()
      }
    },
  )
  it('keeps live registered temp roots on disposal and marks failed completed runs separately', async () => {
    const finish = vi.fn(() => Promise.resolve())
    const create = vi.fn(() =>
      Promise.resolve({
        root: '/tree',
        profile: '/tree/profile',
        cache: '/tree/cache',
        environment: { TMPDIR: '/tree', TEMP: '/tree', TMP: '/tree' },
        finish,
      }),
    )
    const h = setup({ tempRoots: { create } })
    const live = await h.host.admit('other')
    live.register({ pid: 700, group: true })
    live.complete(false)
    h.host.dispose()
    expect(finish).not.toHaveBeenCalled()
    const completed = setup({ tempRoots: { create } })
    const failed = await completed.host.admit('other')
    failed.failed?.()
    failed.complete(true)
    expect(finish).toHaveBeenCalledWith(true)
    completed.host.dispose()
  })
  it('runs only the registered cleaner on a disk-pressure level change', async () => {
    const clean = vi.fn(() => Promise.resolve({ removed: 1, freedBytes: 100 }))
    const onCleanup = vi.fn()
    const h = setup({ created: { finish: vi.fn(() => Promise.resolve()), clean }, onCleanup })
    await h.read(9)
    await Promise.resolve()
    expect(clean).toHaveBeenCalledOnce()
    expect(onCleanup).toHaveBeenCalledWith({ removed: 1, freedBytes: 100 })
    h.host.dispose()
  })
  it('automatically cleans failed temp roots at the retention deadline', async () => {
    const scratch = path.join(process.cwd(), 'temp')
    await mkdir(scratch, { recursive: true })
    const root = await mkdtemp(path.join(scratch, 'm107-dk-lifecycle-'))
    const clock = new FakeResourceClock()
    const schedule = vi.spyOn(clock, 'setTimeout')
    const registry = await CreatedRegistry.open(
      path.join(root, 'registry.json'),
      () => clock.now(),
      {
        directories: process.platform === 'linux' ? undefined : nativeCreated,
        files: nativeCreated,
        exited: (owner) => Promise.resolve(host.hasRetired(owner)),
        archivedAndClean: () => Promise.resolve(false),
        freeBytes: () => Promise.resolve(null),
      },
    )
    const onCleanup = vi.fn()
    const h = setup(
      {
        created: registry,
        tempRoots: new TreeTempRoots(path.join(root, 'trees'), registry),
        onCleanup,
      },
      clock,
    )
    const host = h.host
    try {
      const lease = await h.host.admit('other')
      const ownedRoot = lease.temp?.root
      if (ownedRoot === undefined) throw new Error('Missing temp root')
      lease.failed?.()
      lease.complete(true)
      expect(await registry.clean()).toMatchObject({ removed: 0 })
      await vi.waitFor(() => {
        expect(schedule).toHaveBeenCalledWith(expect.any(Function), RESOURCE_TEMP_KEEP_MS)
      })
      clock.advance(RESOURCE_TEMP_KEEP_MS - 1)
      expect(await registry.clean()).toMatchObject({ removed: 0 })
      clock.advance(1)
      await vi.waitFor(() => {
        expect(onCleanup).toHaveBeenCalledWith({ removed: 1, freedBytes: null })
      })
      await expect(readFile(ownedRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      h.host.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
  it('never lets Resume now bypass the fresh critical write refusal', async () => {
    const h = setup()
    const disks = new ResourceDiskSampler(
      [{ role: 'temp', path: process.cwd() }],
      () => h.settings,
      {
        now: () => h.clock.now(),
        read: () => Promise.resolve({ bsize: BigInt(GiB), blocks: 100n, bavail: 1n }),
      },
    )
    const guarded = new ResourceLaunchHost({
      clock: h.clock,
      events: h.events,
      governor: h.governor,
      settings: () => h.settings,
      disks,
      bindTree: () => Promise.resolve(null),
      onError: vi.fn(),
    })
    h.governor.resumeNow()
    await expect(guarded.assertWrite(process.cwd())).rejects.toThrow('Cannot write to')
    guarded.dispose()
    h.host.dispose()
  })
  it('admits checkpoints on a healthy destination at critical temp pressure without allocating a temp root', async () => {
    const scratch = path.join(process.cwd(), 'temp')
    await mkdir(scratch, { recursive: true })
    const root = await mkdtemp(path.join(scratch, 'm107-dk-checkpoint-'))
    const destination = path.join(root, 'checkpoint-destination')
    const settings = resourceSettingsSchema.parse({})
    const read = vi.fn((file: string) =>
      Promise.resolve({
        bsize: BigInt(GiB),
        blocks: 100n,
        bavail: file === destination ? 50n : 1n,
      }),
    )
    const disks = new ResourceDiskSampler([{ role: 'temp', path: root }], () => settings, {
      now: () => 0,
      read,
    })
    const registry = await CreatedRegistry.open(path.join(root, 'registry.json'), () => 0, {
      directories: process.platform === 'linux' ? undefined : nativeCreated,
      files: nativeCreated,
      exited: () => Promise.resolve(true),
      archivedAndClean: () => Promise.resolve(false),
      freeBytes: () => Promise.resolve(null),
    })
    const roots = new TreeTempRoots(registry.base, registry, disks)
    const create = vi.spyOn(roots, 'create')
    const finish = vi.spyOn(registry, 'finish')
    const h = setup({ disks, created: registry, tempRoots: roots })
    let admission: Promise<void> | undefined
    let checkpoint: ResourceLease | undefined
    let admissionError: unknown
    try {
      await h.read(1)
      expect(h.governor.level()).toBe('pause')
      admission = (async () => {
        try {
          checkpoint = await h.host.admit('other', undefined, 'checkpoint', false, destination)
        } catch (error: unknown) {
          admissionError = error
        }
      })()
      await vi.waitFor(() => {
        expect(admissionError).toBeUndefined()
        expect(checkpoint).toBeDefined()
      })
      await admission
      if (checkpoint === undefined) throw new Error('Missing checkpoint lease')
      expect(checkpoint.temp).toBeUndefined()
      expect(create).not.toHaveBeenCalled()
      expect(await readdir(registry.base)).toEqual([])
      expect(read).toHaveBeenCalledWith(destination)
      checkpoint.complete(true)
      expect(finish).not.toHaveBeenCalled()
      await expect(
        h.host.admit('other', undefined, 'checkpoint', false, root),
      ).rejects.toMatchObject({ code: 'resourceDiskCritical' })
      await expect(h.host.admit('other', undefined, 'checkpoint')).rejects.toThrow(
        'destination unavailable',
      )
    } finally {
      h.host.dispose()
      await admission
      await registry.clean()
      await rm(root, { recursive: true, force: true })
    }
  })
  it('rejects deferred sampling admission promptly on abort or disposal without waiting for the sampler', async () => {
    for (const action of ['abort', 'dispose']) {
      const pending = Promise.withResolvers<ResourceSample>()
      const h = setup()
      const governor = new ResourceGovernor({
        clock: h.clock,
        events: h.events,
        settings: h.settings,
        sampler: { sample: () => pending.promise },
        hasRelocationTarget: () => false,
        onError: vi.fn(),
      })
      const disks = new ResourceDiskSampler([], () => h.settings)
      const host = new ResourceLaunchHost({
        governor,
        events: h.events,
        clock: h.clock,
        settings: () => h.settings,
        disks,
        bindTree: () => Promise.resolve(null),
        onError: vi.fn(),
      })
      const stop = new AbortController()
      let outcome: unknown
      const sampling = governor.refresh()
      const result = (async () => {
        try {
          await host.admit('other', stop.signal)
        } catch (error: unknown) {
          outcome = error
        }
      })()
      try {
        await Promise.resolve()
        if (action === 'abort') stop.abort()
        else host.dispose()
        await vi.waitFor(() => {
          expect(outcome).toMatchObject({ name: 'AbortError' })
        })
        await result
      } finally {
        host.dispose()
        h.host.dispose()
        pending.resolve({
          atMs: 0,
          cpuPercent: null,
          memoryUsedPercent: null,
          memoryAvailableBytes: null,
          memoryTotalBytes: null,
          gpuPercent: null,
          diskBusyPercent: null,
          pressure: null,
        })
        await sampling
      }
    }
  })
  it('reports a stalled statfs volume unknown within its named timeout and bounds fresh destination checks', async () => {
    vi.useFakeTimers()
    const pending = Promise.withResolvers<{ bsize: bigint; blocks: bigint; bavail: bigint }>()
    const settings = resourceSettingsSchema.parse({})
    const disks = new ResourceDiskSampler([{ role: 'temp', path: process.cwd() }], () => settings, {
      now: () => 0,
      read: () => pending.promise,
    })
    try {
      const sampling = disks.sample()
      await vi.advanceTimersByTimeAsync(RESOURCE_DISK_READ_TIMEOUT_MS)
      expect(await sampling).toEqual([
        { role: 'temp', atMs: 0, freeBytes: null, totalBytes: null, etaMs: null },
      ])
      const writing = expect(disks.assertWrite(process.cwd())).rejects.toMatchObject({
        code: 'resourceDiskUnknown',
      })
      await vi.advanceTimersByTimeAsync(RESOURCE_DISK_READ_TIMEOUT_MS)
      await writing
    } finally {
      pending.resolve({ bsize: 1n, blocks: 100n, bavail: 50n })
      vi.useRealTimers()
    }
  })
})
