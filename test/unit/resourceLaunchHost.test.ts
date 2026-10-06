import { describe, expect, it, vi } from 'vitest'
import { ResourceLaunchHost } from '../../src/core/resources/launchHost'
import { ResourceGovernor } from '../../src/core/resources/governor'
import { ResourceEvents } from '../../src/core/resources/events'
import type { ResourceTreeBinding } from '../../src/core/resources/launch'
import { RESOURCE_FOREGROUND_WAIT_MS, RESOURCE_GIB_BYTES } from '../../src/shared/constants'
import { resourceSettingsSchema, type ResourceSample } from '../../src/shared/resources'
import { FakeResourceClock, ScriptedResourceSampler } from './helpers/resources/fakes'

function setup() {
  const clock = new FakeResourceClock()
  const steps: ResourceSample[] = []
  const errors = vi.fn()
  const events = new ResourceEvents(errors)
  const settings = resourceSettingsSchema.parse({})
  const governor = new ResourceGovernor({
    clock,
    events,
    settings,
    sampler: new ScriptedResourceSampler(steps),
    hasRelocationTarget: () => false,
    onError: errors,
  })
  let isGone = false
  let isUnknown = false
  const root = { pid: 700, startTime: '1000' }
  const binding: ResourceTreeBinding = {
    root,
    scope: { type: 'group', pgid: root.pid },
    reader: {
      members: () => Promise.resolve([root]),
      contains: vi.fn(() => Promise.resolve(true)),
      usage: vi.fn(() => Promise.resolve(isUnknown ? null : { cpuSeconds: 1, residentBytes: 100 })),
      forget: vi.fn(),
    },
    gone: vi.fn(() => Promise.resolve(isGone)),
  }
  const bindTree = vi.fn(() => Promise.resolve(binding))
  const host = new ResourceLaunchHost({
    governor,
    events,
    clock,
    settings: () => settings,
    bindTree,
    onError: errors,
  })
  const read = async (changes: Partial<ResourceSample>) => {
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
  const throttle = async () => {
    await read({ memoryUsedPercent: 95 })
    await read({ memoryUsedPercent: 95 })
  }
  return {
    host,
    governor,
    clock,
    binding,
    bindTree,
    read,
    throttle,
    setGone: () => {
      isGone = true
    },
    setUnknown: () => {
      isUnknown = true
    },
  }
}

describe('C1 process admission and registration', () => {
  it('keeps an SDK root exit unknown while exact identity registration is still pending', async () => {
    const h = setup()
    await h.throttle()
    const root = await h.host.admit('museServe', undefined, 'background')
    root.complete(false)
    const stop = new AbortController()
    let isAdmitted = false
    const pending = (async () => {
      const lease = await h.host.admit('museServe', stop.signal, 'background')
      isAdmitted = true
      return lease
    })()
    await h.host.refreshTrees()
    expect(isAdmitted).toBe(false)
    root.register({ pid: 700, group: true })
    await h.host.refreshTrees()
    expect(h.host.tickets()).toHaveLength(1)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    stop.abort()
    await rejected
    root.complete(true)
    h.host.dispose()
  })
  it('does no work at construction and registers the exact kind, class and identity at launch', async () => {
    const h = setup()
    expect(h.bindTree).not.toHaveBeenCalled()
    const lease = await h.host.admit('check')
    lease.register({ pid: 700, group: true })
    await h.host.refreshTrees()
    expect(h.host.tickets()).toEqual([
      expect.objectContaining({
        kind: 'check',
        class: 'foreground',
        root: h.binding.root,
        sessionId: null,
      }),
    ])
    lease.complete(true)
    expect(h.host.tickets()).toEqual([])
    h.host.dispose()
  })

  it('keeps an exited root and unknown readings occupied until whole-tree retirement is proved', async () => {
    const h = setup()
    await h.throttle()
    const first = await h.host.admit('mcpServer', undefined, 'background')
    first.register({ pid: 700, group: true })
    await h.host.refreshTrees()
    first.complete(false)
    h.setUnknown()
    await h.host.refreshTrees()
    let isAdmitted = false
    const next = (async () => {
      const lease = await h.host.admit('mcpServer', undefined, 'background')
      isAdmitted = true
      return lease
    })()
    await h.host.refreshTrees()
    expect(isAdmitted).toBe(false)
    h.setGone()
    await h.host.refreshTrees()
    const second = await next
    expect(isAdmitted).toBe(true)
    second.complete(true)
    h.host.dispose()
  })

  it('keeps failed registration unknown and lets foreground work run at throttle', async () => {
    const h = setup()
    await h.throttle()
    h.bindTree.mockRejectedValue(new Error('unavailable'))
    const first = await h.host.admit('hook', undefined, 'background')
    first.register({ pid: 700, group: true })
    await h.host.refreshTrees()
    const stop = new AbortController()
    const waiting = h.host.admit('hook', stop.signal, 'background')
    const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    const foreground = await h.host.admit('hook', undefined, 'foreground')
    foreground.complete(true)
    stop.abort()
    await rejected
    first.complete(true)
    h.host.dispose()
  })

  it('bounds foreground waiting at pause while cancellation bypasses the queue', async () => {
    const h = setup()
    await h.read({ memoryAvailableBytes: 0 })
    expect(h.governor.level()).toBe('pause')
    const stop = new AbortController()
    const cancelled = h.host.admit('toolShell', stop.signal)
    const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    stop.abort()
    await rejected
    let isLaunched = false
    const pending = (async () => {
      const lease = await h.host.admit('toolShell')
      isLaunched = true
      return lease
    })()
    await Promise.resolve()
    expect(isLaunched).toBe(false)
    h.clock.advance(RESOURCE_FOREGROUND_WAIT_MS)
    const lease = await pending
    expect(isLaunched).toBe(true)
    lease.complete(true)
    h.host.dispose()
  })

  it('changes moved shell work to backgroundTask and holds its capacity', async () => {
    const h = setup()
    await h.throttle()
    const shell = await h.host.admit('toolShell')
    shell.register({ pid: 700, group: true })
    await h.host.refreshTrees()
    shell.background()
    await h.host.refreshTrees()
    expect(h.host.tickets()[0]).toMatchObject({ kind: 'backgroundTask', class: 'background' })
    h.setUnknown()
    await h.host.refreshTrees()
    const stop = new AbortController()
    let isAdmitted = false
    const waiting = (async () => {
      const lease = await h.host.admit('backgroundTask', stop.signal, 'background')
      isAdmitted = true
      return lease
    })()
    await h.host.refreshTrees()
    expect(isAdmitted).toBe(false)
    const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    stop.abort()
    await rejected
    shell.complete(true)
    h.host.dispose()
  })

  it('does not restore a ticket when registration completes after cancellation or disposal', async () => {
    const h = setup()
    const proof = Promise.withResolvers<boolean>()
    vi.mocked(h.binding.reader.contains).mockReturnValue(proof.promise)
    const lease = await h.host.admit('browserCheck')
    lease.register({ pid: 700, group: true })
    await Promise.resolve()
    await Promise.resolve()
    lease.complete(true)
    proof.resolve(true)
    await h.host.refreshTrees()
    expect(h.host.tickets()).toEqual([])
    h.host.dispose()
    await expect(h.host.admit('toolShell')).rejects.toThrow('disposed')
  })

  it('keeps logical background work held and classifies its child processes as background', async () => {
    const h = setup()
    await h.throttle()
    await h.host.run('schedule', async () => {
      const shell = await h.host.admit('toolShell')
      shell.register({ pid: 700, group: true })
      await h.host.refreshTrees()
      expect(h.host.tickets()[0]).toMatchObject({ kind: 'toolShell', class: 'background' })
      shell.complete(true)
    })
    const next = await h.host.admit('schedule', undefined, 'background')
    next.complete(true)
    h.host.dispose()
  })
})
