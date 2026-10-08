import { describe, expect, it, vi } from 'vitest'
import { ResourceEvents } from '../../src/core/resources/events'
import { ResourceGovernor } from '../../src/core/resources/governor'
import {
  ResourceQueue,
  type ResourceLaunchRequest,
  type ResourcePermit,
} from '../../src/core/resources/queue'
import { RESOURCE_GIB_BYTES } from '../../src/shared/constants'
import {
  resourceEventSchema,
  resourceSettingsSchema,
  resourceStatusSchema,
  type ResourceEvent,
  type ResourceKind,
  type ResourceLevel,
  type ResourceSample,
} from '../../src/shared/resources'
import { FakeResourceClock, ScriptedResourceSampler } from './helpers/resources/fakes'

const kinds: readonly ResourceKind[] = [
  'toolShell',
  'backgroundTask',
  'check',
  'mcpServer',
  'worker',
  'subagent',
  'bestOfN',
  'schedule',
  'browserCheck',
  'hook',
  'museServe',
  'other',
]

function setup(initial: ResourceLevel = 'throttle') {
  let level = initial
  const clock = new FakeResourceClock()
  const events = new ResourceEvents((error) => {
    throw error
  })
  const seen: ResourceEvent[] = []
  events.subscribe((event) => {
    seen.push(event)
  })
  const capacity = vi.fn((_kind: ResourceKind): number | null => {
    if (level === 'normal') return null
    return level === 'pause' ? 0 : 1
  })
  const counts = new Map<ResourceKind, number | null>()
  const running = {
    backgroundCount: vi.fn((kind: ResourceKind) => {
      const count = counts.get(kind)
      return count === undefined ? 0 : count
    }),
  }
  const queue = new ResourceQueue({ clock, events, capacity, running })
  const change = (next: ResourceLevel) => {
    const from = level
    level = next
    events.publish({ type: 'levelChanged', atMs: clock.now(), from, to: next, reason: 'cpu' })
  }
  const background = (kind: ResourceKind = 'check', priority = 0, parent?: ResourcePermit) =>
    queue.request({
      kind,
      class: 'background',
      priority,
      ...(parent !== undefined && { parent }),
    })
  const foreground = (kind: ResourceKind = 'toolShell') =>
    queue.request({ kind, class: 'foreground', priority: 0 })
  return { clock, events, seen, capacity, running, counts, queue, change, background, foreground }
}

async function release(ready: Promise<ResourcePermit>): Promise<void> {
  const permit = await ready
  permit.release()
}

describe('resource launch queue', () => {
  it('limits all twelve kinds independently to one background reservation at throttle or relocate', async () => {
    const f = setup()
    const first = await Promise.all(kinds.map((kind) => f.background(kind).ready))
    const next = kinds.map((kind) => f.background(kind))
    expect(f.queue.counts()).toEqual(kinds.map((kind) => ({ kind, class: 'background', count: 1 })))
    expect(first.map((permit) => permit.kind)).toEqual(kinds)
    f.change('relocate')
    expect(f.queue.counts()).toHaveLength(12)
    for (const permit of first) permit.release()
    const second = await Promise.all(next.map((entry) => entry.ready))
    expect(f.queue.counts()).toEqual([])
    for (const permit of second) permit.release()
  })

  it('reserves before registration; registry work, unknown counts and unretired work keep slots occupied', async () => {
    const f = setup()
    f.counts.set('check', 1)
    const waiting = f.background()
    expect(f.queue.counts()).toHaveLength(1)
    f.counts.set('check', 0)
    f.queue.wake()
    const permit = await waiting.ready
    // Neither a missing tree snapshot nor cancellation can release a reservation.
    f.counts.set('check', 0)
    const second = f.background()
    expect(second.runNow()).toBe(false)
    waiting.cancel()
    f.queue.wake()
    expect(f.queue.counts()).toHaveLength(1)
    f.counts.set('check', 1)
    permit.release()
    expect(f.queue.counts()).toHaveLength(1)
    f.running.backgroundCount.mockReturnValue(null)
    f.queue.wake()
    expect(f.queue.counts()).toHaveLength(1)
    f.running.backgroundCount.mockReturnValue(0)
    f.queue.wake()
    await release(second.ready)
    expect(f.queue.counts()).toEqual([])
  })

  it('starts no new background work at pause and starts FIFO per kind under scheduler priorities', async () => {
    const f = setup('pause')
    const start: string[] = []
    const low = f.background('check', 2)
    const first = f.background('check', 0)
    const second = f.background('check', 0)
    const worker = f.background('worker', 0)
    void low.ready.then(() => {
      start.push('low')
    })
    void first.ready.then(() => {
      start.push('first')
    })
    void second.ready.then(() => {
      start.push('second')
    })
    void worker.ready.then(() => {
      start.push('worker')
    })
    f.clock.advance(120_000)
    expect(start).toEqual([])
    expect(f.running.backgroundCount).not.toHaveBeenCalled()
    expect(f.queue.counts()).toEqual([
      { kind: 'check', class: 'background', count: 3 },
      { kind: 'worker', class: 'background', count: 1 },
    ])
    expect(first.runNow()).toBe(false)
    f.change('throttle')
    await Promise.resolve()
    expect(start).toEqual(['first', 'worker'])
    const firstPermit = await first.ready
    const workerPermit = await worker.ready
    expect(start).toEqual(['first', 'worker'])
    firstPermit.release()
    await release(second.ready)
    await release(low.ready)
    workerPermit.release()
    expect(start).toEqual(['first', 'worker', 'second', 'low'])
  })

  it('allows all normal work without widening callers slot caps or changing existing running work', async () => {
    const f = setup('normal')
    f.running.backgroundCount.mockReturnValue(100)
    const permits = await Promise.all(Array.from({ length: 15 }, () => f.background().ready))
    expect(f.running.backgroundCount).not.toHaveBeenCalled()
    f.change('throttle')
    const waiting = f.background()
    expect(f.queue.counts()).toHaveLength(1)
    for (const permit of permits) permit.release()
    expect(f.queue.counts()).toHaveLength(1)
    f.change('normal')
    await release(waiting.ready)
    expect(f.queue.counts()).toEqual([])
  })

  it('never defers foreground work at throttle or relocate even when the same kind is occupied', async () => {
    const f = setup()
    f.counts.set('toolShell', 10)
    const background = f.background('toolShell')
    const firstAdmission = f.foreground()
    expect(f.queue.counts()).toEqual([{ kind: 'toolShell', class: 'background', count: 1 }])
    const first = await firstAdmission.ready
    f.change('relocate')
    const secondAdmission = f.foreground()
    expect(f.queue.counts()).toEqual([{ kind: 'toolShell', class: 'background', count: 1 }])
    const second = await secondAdmission.ready
    expect(f.queue.counts()).toEqual([{ kind: 'toolShell', class: 'background', count: 1 }])
    expect(f.seen.some((event) => event.type === 'deferred' && event.class === 'foreground')).toBe(
      false,
    )
    first.release()
    second.release()
    const rejection = expect(background.ready).rejects.toMatchObject({ name: 'AbortError' })
    background.cancel()
    expect(f.queue.counts()).toEqual([])
    await rejection
  })

  it('bounds foreground wait at pause to twenty seconds and exposes Run now without admitting backgrounds', async () => {
    const f = setup('pause')
    const first = f.foreground()
    const second = f.foreground()
    const background = f.background('toolShell')
    const admitted = vi.fn()
    void first.ready.then(admitted)
    expect(f.queue.counts()).toEqual([
      { kind: 'toolShell', class: 'foreground', count: 2 },
      { kind: 'toolShell', class: 'background', count: 1 },
    ])
    f.clock.advance(19_999)
    await Promise.resolve()
    expect(admitted).not.toHaveBeenCalled()
    expect(second.runNow()).toBe(true)
    expect(second.runNow()).toBe(false)
    const secondPermit = await second.ready
    expect(background.runNow()).toBe(false)
    f.clock.advance(1)
    await Promise.resolve()
    expect(admitted).toHaveBeenCalledTimes(1)
    const firstPermit = await first.ready
    expect(admitted).toHaveBeenCalledTimes(1)
    expect(f.queue.counts()).toEqual([{ kind: 'toolShell', class: 'background', count: 1 }])
    firstPermit.release()
    secondPermit.release()
    expect(f.queue.counts()).toHaveLength(1)
    f.change('normal')
    await release(background.ready)
  })

  it('recovery ends a foreground wait immediately and cancels its timer', async () => {
    const f = setup('pause')
    const waiting = f.foreground()
    f.clock.advance(5000)
    f.change('throttle')
    expect(f.queue.counts()).toEqual([])
    const permit = await waiting.ready
    f.clock.advance(20_000)
    expect(waiting.runNow()).toBe(false)
    expect(f.queue.counts()).toEqual([])
    permit.release()
  })

  it('foreground at pause still runs on its deadline when the registry is unavailable', async () => {
    const f = setup('pause')
    f.running.backgroundCount.mockImplementation(() => {
      throw new Error('Registry unavailable')
    })
    const waiting = f.foreground()
    expect(f.running.backgroundCount).not.toHaveBeenCalled()
    f.clock.advance(20_000)
    expect(f.queue.counts()).toEqual([])
    const permit = await waiting.ready
    expect(f.queue.counts()).toEqual([])
    permit.release()
  })

  it('refuses a same-kind child waiting on its active parent; foreground parents do not consume background capacity', async () => {
    const f = setup()
    const parent = await f.background('worker').ready
    const child = f.background('worker', 0, parent)
    const childRejection = expect(child.ready).rejects.toThrow('parent slot')
    expect(f.queue.counts()).toEqual([])
    await childRejection
    const check = await f.background('check', 0, parent).ready
    check.release()
    const foregroundAdmission = f.foreground('worker')
    expect(f.queue.counts()).toEqual([])
    const foreground = await foregroundAdmission.ready
    parent.release()
    const background = await f.background('worker', 0, foreground).ready
    background.release()
    f.change('pause')
    const foregroundChild = f.queue.request({
      kind: 'worker',
      class: 'foreground',
      priority: 0,
      parent: foreground,
    })
    expect(foregroundChild.runNow()).toBe(true)
    await release(foregroundChild.ready)
    foreground.release()
    await expect(f.background('worker', 0, parent).ready).rejects.toThrow('not active')
  })

  it('Stop/cancel stays synchronous at every level and never releases a running permit or waits for admission', async () => {
    for (const level of ['normal', 'throttle', 'relocate', 'pause'] as const) {
      const f = setup('normal')
      const running = await f.background().ready
      f.change(level)
      const controller = new AbortController()
      const queued = f.queue.request(
        { kind: 'check', class: 'background', priority: 0 },
        controller.signal,
      )
      if (level === 'normal') {
        const permit = await queued.ready
        controller.abort()
        permit.release()
      } else {
        const rejection = expect(queued.ready).rejects.toMatchObject({ name: 'AbortError' })
        controller.abort()
        expect(f.queue.counts()).toEqual([])
        await rejection
        const next = f.background()
        const nextRejection = expect(next.ready).rejects.toMatchObject({ name: 'AbortError' })
        f.queue.wake()
        expect(f.queue.counts()).toHaveLength(1)
        next.cancel()
        expect(f.queue.counts()).toEqual([])
        await nextRejection
      }
      running.release()
    }
  })

  it('handles pre-aborted and disposed requests, removes foreground timers and keeps admitted leases until release', async () => {
    const f = setup('pause')
    const pre = new AbortController()
    pre.abort()
    const preAborted = f.queue.request(
      { kind: 'check', class: 'background', priority: 0 },
      pre.signal,
    )
    const preRejection = expect(preAborted.ready).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.queue.counts()).toEqual([])
    await preRejection
    expect(f.seen).toEqual([])
    const waiting = f.foreground()
    const rejection = expect(waiting.ready).rejects.toMatchObject({ name: 'AbortError' })
    waiting.cancel()
    await rejection
    f.clock.advance(20_000)
    expect(waiting.runNow()).toBe(false)
    f.change('normal')
    const running = await f.background().ready
    expect(() => Object.defineProperty(running, 'kind', { value: 'worker' })).toThrow()
    f.change('pause')
    const pending = f.background()
    const disposed = expect(pending.ready).rejects.toMatchObject({ name: 'AbortError' })
    f.queue.dispose()
    await disposed
    expect(f.queue.counts()).toEqual([])
    f.change('normal')
    f.queue.wake()
    running.release()
    running.release()
    expect(() => f.background()).toThrow('disposed')
  })

  it('validates requests, capacity and registry counts without treating failures as available slots', async () => {
    const f = setup()
    expect(() => f.background('check', NaN)).toThrow('priority')
    expect(() => f.background('check', 0.5)).toThrow('priority')
    expect(() => f.background('check', Number.MAX_SAFE_INTEGER + 1)).toThrow('priority')
    f.capacity.mockReturnValue(2)
    await expect(f.background().ready).rejects.toThrow('capacity')
    f.capacity.mockReturnValue(1)
    for (const count of [-1, NaN, Infinity, 0.5]) {
      f.running.backgroundCount.mockReturnValue(count)
      await expect(f.background().ready).rejects.toThrow('running count')
    }
    f.running.backgroundCount.mockImplementation(() => {
      throw new Error('Registry failed')
    })
    await expect(f.background().ready).rejects.toThrow('Registry failed')
    expect(f.queue.counts()).toEqual([])
    const invalid: ResourceLaunchRequest = { kind: 'check', class: 'background', priority: 0 }
    Object.defineProperty(invalid, 'kind', { value: 'stop' })
    expect(() => f.queue.request(invalid)).toThrow()
    Object.defineProperties(invalid, { kind: { value: 'check' }, class: { value: 'control' } })
    expect(() => f.queue.request(invalid)).toThrow()
  })

  it.each([false, true])(
    'keeps cancellation final if a registry callback aborts its own admission (then throws: %s)',
    async (shouldThrow) => {
      const f = setup()
      const controller = new AbortController()
      const remove = vi.spyOn(controller.signal, 'removeEventListener')
      f.running.backgroundCount.mockImplementationOnce(() => {
        controller.abort()
        if (shouldThrow) throw new Error('Registry failed after cancellation')
        return 0
      })
      const admission = f.queue.request(
        { kind: 'check', class: 'background', priority: 0 },
        controller.signal,
      )
      await expect(admission.ready).rejects.toMatchObject({ name: 'AbortError' })
      expect(remove).toHaveBeenCalledTimes(1)
      const next = f.background()
      expect(f.queue.counts()).toEqual([])
      await release(next.ready)
    },
  )

  it('reports deferral/pause and private-free queue counts once, without retaining caller mutations', async () => {
    const f = setup('pause')
    const request: ResourceLaunchRequest = Object.assign(
      { kind: 'check', class: 'background', priority: 0 } satisfies ResourceLaunchRequest,
      {
        pid: 1234,
        command: 'command-canary',
        path: '/path-canary',
        sessionId: 'session-canary',
        environment: 'env-canary',
      },
    )
    const admission = f.queue.request(request)
    request.kind = 'worker'
    f.queue.wake()
    f.queue.wake()
    const snapshot = f.queue.counts()
    expect(snapshot).toEqual([{ kind: 'check', class: 'background', count: 1 }])
    snapshot[0]!.count = 100
    expect(f.queue.counts()[0]!.count).toBe(1)
    expect(f.seen.filter((event) => event.type === 'paused')).toHaveLength(1)
    expect(f.seen.filter((event) => event.type === 'deferred')).toEqual([
      { type: 'deferred', atMs: 0, kind: 'check', class: 'background' },
    ])
    for (const event of f.seen) expect(resourceEventSchema.safeParse(event).success).toBe(true)
    expect(JSON.stringify(f.seen)).not.toMatch(/pid|command|path|session|environment/)
    f.change('throttle')
    await release(admission.ready)
  })

  it('cleans up timer/signal subscriptions on admission and cancellation and unsubscribes on disposal', async () => {
    const f = setup('pause')
    const original = f.clock.setTimeout.bind(f.clock)
    const cancellations: ReturnType<typeof vi.fn<() => void>>[] = []
    vi.spyOn(f.clock, 'setTimeout').mockImplementation((callback, delay) => {
      const cancel = vi.fn(original(callback, delay))
      cancellations.push(cancel)
      return cancel
    })
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const queued = f.queue.request(
      { kind: 'toolShell', class: 'foreground', priority: 0 },
      controller.signal,
    )
    expect(queued.runNow()).toBe(true)
    expect(cancellations[0]).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledTimes(1)
    const permit = await queued.ready
    const wake = vi.spyOn(f.queue, 'wake')
    permit.release()
    permit.release()
    expect(wake).toHaveBeenCalledTimes(1)
    const aborted = f.foreground()
    const rejection = expect(aborted.ready).rejects.toMatchObject({ name: 'AbortError' })
    aborted.cancel()
    expect(cancellations[1]).toHaveBeenCalledTimes(1)
    await rejection
    f.queue.dispose()
    wake.mockClear()
    f.change('normal')
    expect(wake).not.toHaveBeenCalled()
    f.clock.advance(20_000)
  })

  it('skips an entry cancelled by an earlier pause observer during the same wake', async () => {
    const f = setup('normal')
    const check = await f.background('check').ready
    const worker = await f.background('worker').ready
    f.change('throttle')
    const queuedCheck = f.background('check', 0)
    const queuedWorker = f.background('worker', 2)
    const workerRejection = expect(queuedWorker.ready).rejects.toMatchObject({ name: 'AbortError' })
    f.events.subscribe((event) => {
      if (event.type === 'paused' && event.kind === 'check') queuedWorker.cancel()
    })
    f.change('pause')
    expect(f.seen.filter((event) => event.type === 'paused')).toEqual([
      { type: 'paused', atMs: 0, kind: 'check' },
    ])
    await workerRejection
    const checkRejection = expect(queuedCheck.ready).rejects.toMatchObject({ name: 'AbortError' })
    queuedCheck.cancel()
    await checkRejection
    check.release()
    worker.release()
  })
})

describe('governor and queue integration', () => {
  it('uses real governor events to defer, pause, recover and resume, with schema-valid status', async () => {
    const clock = new FakeResourceClock()
    const steps: ResourceSample[] = []
    const events = new ResourceEvents((error) => {
      throw error
    })
    const governor = new ResourceGovernor({
      clock,
      events,
      sampler: new ScriptedResourceSampler(steps),
      settings: resourceSettingsSchema.parse({}),
      hasRelocationTarget: () => false,
      onError: (error) => {
        throw error
      },
    })
    const queue = new ResourceQueue({
      clock,
      events,
      capacity: (kind) => governor.capacity(kind),
      running: { backgroundCount: () => 0 },
    })
    const read = async (atMs: number, available: number) => {
      clock.advance(atMs - clock.now())
      steps.push({
        atMs,
        cpuPercent: 20,
        memoryUsedPercent: 40,
        memoryAvailableBytes: available,
        memoryTotalBytes: 16 * RESOURCE_GIB_BYTES,
        gpuPercent: null,
        diskBusyPercent: null,
        pressure: null,
      })
      await governor.refresh()
    }
    await read(0, 0)
    const admission = queue.request({ kind: 'check', class: 'background', priority: 0 })
    expect(resourceStatusSchema.safeParse(governor.status(queue.counts())).success).toBe(true)
    expect(governor.status(queue.counts()).queued[0]!.count).toBe(1)
    governor.resumeNow()
    const permit = await admission.ready
    expect(queue.counts()).toEqual([])
    permit.release()
    governor.updateSettings(resourceSettingsSchema.parse({ enabled: false }))
    await read(5000, 0)
    expect(governor.level()).toBe('normal')
    await release(queue.request({ kind: 'check', class: 'background', priority: 0 }).ready)
    governor.updateSettings(resourceSettingsSchema.parse({}))
    await read(10_000, 0)
    const next = queue.request({ kind: 'check', class: 'background', priority: 0 })
    await read(15_000, 8 * RESOURCE_GIB_BYTES)
    await read(75_000, 8 * RESOURCE_GIB_BYTES)
    expect(governor.level()).toBe('throttle')
    await release(next.ready)
    queue.dispose()
    governor.dispose()
  })
})
