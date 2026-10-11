import { describe, expect, it, vi } from 'vitest'
import { pickResourceReady } from '../../src/core/team/scheduler/pick'
import {
  isResourceSlotAvailable,
  type GovernedTeamSlot,
  type TeamCapacityPort,
} from '../../src/core/team/scheduler/slots'
import { requestCheckSlot } from '../../src/host/team/checkSlots'
import { resourceSettingsSchema } from '../../src/shared/resources'
import { RESOURCE_MIN_DWELL_MS } from '../../src/shared/constants'
import { teamResources } from './helpers/resources/team'

describe('C2 governor capacity in the team scheduler', () => {
  it('preserves existing caps at normal and narrows them at throttle without widening zero', async () => {
    const h = teamResources()
    const configured = vi.fn(() => 2)
    const occupied = vi.fn(() => 1)
    const capacity: TeamCapacityPort = {
      governor: h.governor,
      running: h.running,
      configured,
      occupied,
    }
    expect(isResourceSlotAvailable(capacity, 'worker')).toBe(true)
    expect(h.running.backgroundCount).not.toHaveBeenCalled()
    occupied.mockReturnValue(2)
    expect(isResourceSlotAvailable(capacity, 'worker')).toBe(false)
    await h.throttle()
    occupied.mockReturnValue(0)
    expect(isResourceSlotAvailable(capacity, 'worker')).toBe(true)
    occupied.mockReturnValue(1)
    expect(isResourceSlotAvailable(capacity, 'worker')).toBe(false)
    expect(isResourceSlotAvailable(capacity, 'worker', true)).toBe(true)
    configured.mockReturnValue(0)
    occupied.mockReturnValue(0)
    expect(isResourceSlotAvailable(capacity, 'worker')).toBe(false)
    expect(isResourceSlotAvailable(capacity, 'worker', true)).toBe(false)
  })

  it('refuses unknown or occupied registry counts even when scheduler slots are free', async () => {
    const h = teamResources()
    await h.throttle()
    const capacity: TeamCapacityPort = {
      governor: h.governor,
      running: h.running,
      configured: () => 2,
      occupied: () => 0,
    }
    h.running.backgroundCount.mockReturnValue(null)
    expect(isResourceSlotAvailable(capacity, 'worker')).toBe(false)
    h.running.backgroundCount.mockReturnValue(1)
    expect(isResourceSlotAvailable(capacity, 'worker')).toBe(false)
    h.running.backgroundCount.mockReturnValue(0)
    expect(isResourceSlotAvailable(capacity, 'worker')).toBe(true)
  })

  it('preserves eligible-task order while allowing another kind past a busy worker', async () => {
    const h = teamResources()
    await h.throttle()
    const first = { kind: 'worker' as const, id: 'first' }
    const next = { kind: 'worker' as const, id: 'second' }
    const check = { kind: 'check' as const, id: 'check' }
    const tasks = [first, next, check]
    const capacity: TeamCapacityPort = {
      governor: h.governor,
      running: h.running,
      configured: () => 2,
      occupied: (kind) => (kind === 'worker' ? 1 : 0),
    }
    expect(pickResourceReady(tasks, capacity)).toBe(check)
    capacity.occupied = () => 0
    expect(pickResourceReady(tasks, capacity)).toBe(first)
    await h.read({ memoryAvailableBytes: 0 })
    expect(pickResourceReady(tasks, capacity)).toBeUndefined()
    expect(tasks).toEqual([first, next, check])
    expect(pickResourceReady(tasks, capacity)).toBeUndefined()
  })
})

// SPAWN017C (accepted): at pause the governor refuses new background work at
// once with a typed ResourcePausedError instead of queueing it until resume.
// Cancellation of work that is genuinely waiting (throttle, one per kind)
// still ends with AbortError, which the team scheduler's callers rely on.
const paused = { name: 'ResourcePausedError', code: 'paused' }

describe('C2 adds the governor to existing team and heavy-check slots', () => {
  it.each(['worker', 'check'] as const)(
    'rechecks pause after a %s waits for a local slot, refuses it typed and releases both unstarted reservations',
    async (kind) => {
      const h = teamResources()
      const local = Promise.withResolvers<ReturnType<typeof h.localSlot>>()
      h.scheduler.acquire.mockImplementationOnce(() => local.promise)
      const waiting =
        kind === 'check' ? requestCheckSlot(h.slots, 0) : h.slots.request({ kind, priority: 0 })
      const refused = expect(waiting.ready).rejects.toMatchObject(paused)
      await vi.waitFor(() => {
        expect(h.scheduler.acquire).toHaveBeenCalledTimes(1)
      })
      await h.read({ memoryAvailableBytes: 0 })
      local.resolve(h.localSlot(kind))
      await refused
      expect(h.queue.counts()).toEqual([])
      expect(h.release).toHaveBeenCalledTimes(1)
      expect(h.capacity.occupied(kind)).toBe(0)
      h.governor.resumeNow()
      const resumed = await (
        kind === 'check' ? requestCheckSlot(h.slots, 0) : h.slots.request({ kind, priority: 0 })
      ).ready
      expect(resumed.permit.kind).toBe(kind)
      resumed.release()
      expect(h.release).toHaveBeenCalledTimes(2)
      h.queue.dispose()
    },
  )

  it('rechecks throttle after two workers wait for local slots and admits at most one', async () => {
    const h = teamResources()
    const firstLocal = Promise.withResolvers<ReturnType<typeof h.localSlot>>()
    const nextLocal = Promise.withResolvers<ReturnType<typeof h.localSlot>>()
    h.scheduler.acquire
      .mockImplementationOnce(() => firstLocal.promise)
      .mockImplementationOnce(() => nextLocal.promise)
    const runnable: GovernedTeamSlot[] = []
    async function recorded(ready: Promise<GovernedTeamSlot>) {
      const slot = await ready
      runnable.push(slot)
      return slot
    }
    const first = recorded(h.slots.request({ kind: 'worker', priority: 0 }).ready)
    const next = recorded(h.slots.request({ kind: 'worker', priority: 0 }).ready)
    await vi.waitFor(() => {
      expect(h.scheduler.acquire).toHaveBeenCalledTimes(2)
    })
    await h.throttle()
    firstLocal.resolve(h.localSlot('worker'))
    nextLocal.resolve(h.localSlot('worker'))
    await vi.waitFor(() => {
      expect(runnable).toHaveLength(1)
      expect(h.queue.counts()).toEqual([{ kind: 'worker', class: 'background', count: 1 }])
    })
    expect(h.capacity.occupied('worker')).toBe(1)
    runnable[0]?.release()
    const completed = await Promise.all([first, next])
    expect(h.capacity.occupied('worker')).toBe(1)
    for (const slot of completed) slot.release()
    expect(h.capacity.occupied('worker')).toBe(0)
    h.queue.dispose()
  })

  it('cancels work requeued after local acquisition without holding either reservation', async () => {
    const h = teamResources()
    const local = Promise.withResolvers<ReturnType<typeof h.localSlot>>()
    h.scheduler.acquire.mockImplementationOnce(() => local.promise)
    const waiting = requestCheckSlot(h.slots, 0)
    await vi.waitFor(() => {
      expect(h.scheduler.acquire).toHaveBeenCalledTimes(1)
    })
    // Throttle with another check tree running: the recheck requeues and waits.
    await h.throttle()
    h.running.backgroundCount.mockReturnValue(1)
    local.resolve(h.localSlot('check'))
    await vi.waitFor(() => {
      expect(h.queue.counts()).toEqual([{ kind: 'check', class: 'background', count: 1 }])
    })
    const rejected = expect(waiting.ready).rejects.toMatchObject({ name: 'AbortError' })
    waiting.cancel()
    await rejected
    expect(h.queue.counts()).toEqual([])
    expect(h.capacity.occupied('check')).toBe(0)
    expect(h.release).toHaveBeenCalledTimes(1)
    h.running.backgroundCount.mockReturnValue(0)
    const following = await requestCheckSlot(h.slots, 0).ready
    following.release()
    h.queue.dispose()
  })

  it('refuses a same-kind child made impossible while local acquisition waits', async () => {
    const h = teamResources()
    const parent = await h.slots.request({ kind: 'worker', priority: 0 }).ready
    const local = Promise.withResolvers<ReturnType<typeof h.localSlot>>()
    h.scheduler.acquire.mockImplementationOnce(() => local.promise)
    const waiting = h.slots.request({ kind: 'worker', priority: 2, parent: parent.permit })
    const rejected = expect(waiting.ready).rejects.toThrow(
      'Resource child cannot wait on its parent slot',
    )
    await vi.waitFor(() => {
      expect(h.scheduler.acquire).toHaveBeenCalledTimes(2)
    })
    await h.throttle()
    local.resolve(h.localSlot('worker'))
    await rejected
    expect(h.capacity.occupied('worker')).toBe(1)
    expect(h.release).toHaveBeenCalledTimes(1)
    expect(h.queue.counts()).toEqual([])
    parent.release()
    const following = await h.slots.request({ kind: 'worker', priority: 0 }).ready
    following.release()
    h.queue.dispose()
  })

  it('runs one background item per kind and keeps priority/FIFO order through recovery', async () => {
    const h = teamResources()
    await h.throttle()
    const first = await h.slots.request({ kind: 'worker', priority: 0 }).ready
    const check = await requestCheckSlot(h.slots, 0).ready
    const order: string[] = []
    async function recorded(ready: Promise<GovernedTeamSlot>, label: string) {
      const slot = await ready
      order.push(label)
      return slot
    }
    const low = recorded(h.slots.request({ kind: 'worker', priority: 2 }).ready, 'low')
    const urgent = recorded(h.slots.request({ kind: 'worker', priority: 0 }).ready, 'urgent')
    const same = recorded(h.slots.request({ kind: 'worker', priority: 0 }).ready, 'same')
    await Promise.resolve()
    expect(h.scheduler.acquire).toHaveBeenCalledTimes(2)
    expect(order).toEqual([])
    first.release()
    expect(h.queue.counts()).toEqual([{ kind: 'worker', class: 'background', count: 2 }])
    const admittedUrgent = await urgent
    expect(order).toEqual(['urgent'])
    admittedUrgent.release()
    const admittedSame = await same
    expect(order).toEqual(['urgent', 'same'])
    admittedSame.release()
    const admittedLow = await low
    expect(order).toEqual(['urgent', 'same', 'low'])
    await h.read({ memoryAvailableBytes: 0 })
    await expect(requestCheckSlot(h.slots, 0).ready).rejects.toMatchObject(paused)
    check.release()
    expect(h.queue.counts()).toEqual([])
    h.governor.resumeNow()
    const afterRecovery = await requestCheckSlot(h.slots, 0).ready
    expect(afterRecovery.permit.kind).toBe('check')
    expect(afterRecovery.permit.class).toBe('background')
    afterRecovery.release()
    admittedLow.release()
    h.queue.dispose()
  })

  it('refuses a delegating parent before it waits on all existing scheduler slots at normal', async () => {
    const h = teamResources()
    const parent = await h.slots.request({ kind: 'worker', priority: 0 }).ready
    h.scheduler.preflight.mockImplementation((request) => {
      if (request.parent !== undefined) throw new Error('Child slots exhausted')
    })
    expect(() => h.slots.request({ kind: 'worker', priority: 0, parent: parent.permit })).toThrow(
      'Child slots exhausted',
    )
    expect(h.queue.counts()).toEqual([])
    expect(h.scheduler.acquire).toHaveBeenCalledTimes(1)
    parent.release()
  })

  it('passes the exact parent and refuses same-kind child waiting at throttle', async () => {
    const h = teamResources()
    await h.throttle()
    const parent = await h.slots.request({ kind: 'worker', priority: 0 }).ready
    const child = h.slots.request({ kind: 'worker', priority: 0, parent: parent.permit })
    await expect(child.ready).rejects.toThrow('Resource child cannot wait on its parent slot')
    const check = await requestCheckSlot(h.slots, 2, undefined, parent.permit).ready
    expect(h.scheduler.acquire).toHaveBeenLastCalledWith(
      { kind: 'check', class: 'background', priority: 2, parent: parent.permit },
      expect.any(AbortSignal),
    )
    expect(h.release).not.toHaveBeenCalled()
    check.release()
    parent.release()
  })

  it('rechecks child preflight after governor waiting and releases a rejected reservation', async () => {
    const h = teamResources()
    // Throttle with a worker tree running: the request waits in the governor's queue.
    await h.throttle()
    h.running.backgroundCount.mockReturnValue(1)
    const waiting = h.slots.request({ kind: 'worker', priority: 0 })
    expect(h.queue.counts()).toEqual([{ kind: 'worker', class: 'background', count: 1 }])
    const rejected = expect(waiting.ready).rejects.toThrow('Child capacity changed')
    h.scheduler.preflight.mockImplementationOnce(() => {
      throw new Error('Child capacity changed')
    })
    h.running.backgroundCount.mockReturnValue(0)
    h.queue.wake()
    await rejected
    expect(h.scheduler.acquire).not.toHaveBeenCalled()
    h.governor.updateSettings(resourceSettingsSchema.parse({ enabled: false }))
    h.governor.updateSettings(resourceSettingsSchema.parse({}))
    h.clock.advance(RESOURCE_MIN_DWELL_MS)
    await h.throttle()
    const following = h.slots.request({ kind: 'worker', priority: 0 })
    expect(h.queue.counts()).toEqual([])
    const slot = await following.ready
    slot.release()
  })

  it('releases admission when existing slot acquisition fails', async () => {
    const h = teamResources()
    await h.throttle()
    h.scheduler.acquire.mockRejectedValueOnce(new Error('Slot unavailable'))
    await expect(requestCheckSlot(h.slots, 0).ready).rejects.toThrow('Slot unavailable')
    const following = requestCheckSlot(h.slots, 0)
    expect(h.queue.counts()).toEqual([])
    const slot = await following.ready
    slot.release()
  })

  it('refuses background work at pause at once, typed, without acquiring a slot', async () => {
    const h = teamResources()
    await h.read({ memoryAvailableBytes: 0 })
    const refused = requestCheckSlot(h.slots, 0)
    await expect(refused.ready).rejects.toMatchObject(paused)
    expect(h.queue.counts()).toEqual([])
    // A late cancel finds nothing to withdraw.
    refused.cancel()
    expect(h.scheduler.acquire).not.toHaveBeenCalled()
    expect(h.queue.counts()).toEqual([])
  })

  it('cancels queued background work with AbortError without acquiring a slot', async () => {
    const h = teamResources()
    await h.throttle()
    h.running.backgroundCount.mockReturnValue(1)
    const waiting = requestCheckSlot(h.slots, 0)
    expect(h.queue.counts()).toEqual([{ kind: 'check', class: 'background', count: 1 }])
    const rejected = expect(waiting.ready).rejects.toMatchObject({ name: 'AbortError' })
    waiting.cancel()
    expect(h.queue.counts()).toEqual([])
    await rejected
    expect(h.scheduler.acquire).not.toHaveBeenCalled()
    expect(h.queue.counts()).toEqual([])
  })

  it('honors a caller abort before local acquisition begins', async () => {
    const h = teamResources()
    const controller = new AbortController()
    const waiting = requestCheckSlot(h.slots, 0, controller.signal)
    controller.abort()
    await expect(waiting.ready).rejects.toMatchObject({ name: 'AbortError' })
    expect(h.scheduler.acquire).not.toHaveBeenCalled()
    const following = await requestCheckSlot(h.slots, 0).ready
    following.release()
  })

  it('cleans up both slots when cancellation races a cancellation-ignoring acquisition', async () => {
    const h = teamResources()
    await h.throttle()
    let finish: (() => void) | undefined
    h.scheduler.acquire.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => {
            resolve({ release: h.release })
          }
        }),
    )
    const waiting = requestCheckSlot(h.slots, 0)
    await Promise.resolve()
    const rejected = expect(waiting.ready).rejects.toMatchObject({ name: 'AbortError' })
    waiting.cancel()
    if (finish === undefined) throw new Error('Acquisition did not begin')
    finish()
    await rejected
    expect(h.release).toHaveBeenCalledTimes(1)
    const following = await requestCheckSlot(h.slots, 0).ready
    following.release()
  })

  it('retains granted occupancy after cancel and releases it only once on retirement', async () => {
    const h = teamResources()
    await h.throttle()
    const admission = requestCheckSlot(h.slots, 0)
    const held = await admission.ready
    admission.cancel()
    const following = requestCheckSlot(h.slots, 0)
    await Promise.resolve()
    expect(h.scheduler.acquire).toHaveBeenCalledTimes(1)
    expect(h.release).not.toHaveBeenCalled()
    held.release()
    expect(h.queue.counts()).toEqual([])
    held.release()
    const next = await following.ready
    expect(h.release).toHaveBeenCalledTimes(1)
    next.release()
  })

  it('releases the governor permit even when the retired scheduler slot cleanup throws', async () => {
    const h = teamResources()
    await h.throttle()
    const held = await requestCheckSlot(h.slots, 0).ready
    h.release.mockImplementationOnce(() => {
      throw new Error('Cleanup failed')
    })
    expect(() => {
      held.release()
    }).toThrow('Cleanup failed')
    const following = requestCheckSlot(h.slots, 0)
    expect(h.queue.counts()).toEqual([])
    const next = await following.ready
    next.release()
  })
})
