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
    configured.mockReturnValue(0)
    occupied.mockReturnValue(0)
    expect(isResourceSlotAvailable(capacity, 'worker')).toBe(false)
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

describe('C2 adds the governor to existing team and heavy-check slots', () => {
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
    const admittedUrgent = await urgent
    expect(order).toEqual(['urgent'])
    admittedUrgent.release()
    const admittedSame = await same
    expect(order).toEqual(['urgent', 'same'])
    admittedSame.release()
    const admittedLow = await low
    expect(order).toEqual(['urgent', 'same', 'low'])
    await h.read({ memoryAvailableBytes: 0 })
    const paused = requestCheckSlot(h.slots, 0)
    let isResumed = false
    const ready = (async () => {
      const slot = await paused.ready
      isResumed = true
      return slot
    })()
    check.release()
    await Promise.resolve()
    expect(isResumed).toBe(false)
    h.governor.resumeNow()
    const afterRecovery = await ready
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
    await h.read({ memoryAvailableBytes: 0 })
    const waiting = h.slots.request({ kind: 'worker', priority: 0 })
    const rejected = expect(waiting.ready).rejects.toThrow('Child capacity changed')
    h.scheduler.preflight.mockImplementationOnce(() => {
      throw new Error('Child capacity changed')
    })
    h.governor.resumeNow()
    await rejected
    expect(h.scheduler.acquire).not.toHaveBeenCalled()
    h.governor.updateSettings(resourceSettingsSchema.parse({ enabled: false }))
    h.governor.updateSettings(resourceSettingsSchema.parse({}))
    h.clock.advance(RESOURCE_MIN_DWELL_MS)
    await h.throttle()
    const following = await h.slots.request({ kind: 'worker', priority: 0 }).ready
    following.release()
  })

  it('releases admission when existing slot acquisition fails', async () => {
    const h = teamResources()
    await h.throttle()
    h.scheduler.acquire.mockRejectedValueOnce(new Error('Slot unavailable'))
    await expect(requestCheckSlot(h.slots, 0).ready).rejects.toThrow('Slot unavailable')
    const following = await requestCheckSlot(h.slots, 0).ready
    following.release()
  })

  it('cancels queued background work immediately at pause without acquiring a slot', async () => {
    const h = teamResources()
    await h.read({ memoryAvailableBytes: 0 })
    const waiting = requestCheckSlot(h.slots, 0)
    const rejected = expect(waiting.ready).rejects.toMatchObject({ name: 'AbortError' })
    waiting.cancel()
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
    const next = await requestCheckSlot(h.slots, 0).ready
    next.release()
  })
})
