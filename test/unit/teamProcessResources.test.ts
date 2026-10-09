import { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { prepareTeamProcess } from '../../src/host/team/processLifetime'
import { observeResourceProcess } from '../../src/host/resources/resourceAdmission'
import { fakeResourceLease } from './helpers/resources/fakes'
import { teamResources } from './helpers/resources/team'

describe('C2 team process registry hook', () => {
  it('attaches the exact reserved permit before launch and retains root-exit uncertainty', async () => {
    const h = teamResources()
    await h.throttle()
    const slot = await h.slots.request({ kind: 'worker', priority: 0 }).ready
    const supplied = fakeResourceLease(true)
    const attach = vi.fn((permit, onRetired: () => void) => {
      expect(permit).toBe(slot.permit)
      supplied.complete.mockImplementation((isGone: boolean) => {
        if (isGone) onRetired()
      })
      return supplied
    })
    const lease = prepareTeamProcess(slot, { attach })
    expect(lease).toBe(supplied)
    expect(attach).toHaveBeenCalledTimes(1)
    expect(supplied.register).not.toHaveBeenCalled()
    const child = new ChildProcess()
    Object.defineProperty(child, 'pid', { value: 700 })
    observeResourceProcess(lease, child)
    expect(supplied.register).toHaveBeenCalledWith({
      pid: 700,
      job: undefined,
      group: process.platform !== 'win32',
    })
    child.emit('exit', 0)
    expect(supplied.complete).toHaveBeenLastCalledWith(false)
    const next = h.slots.request({ kind: 'worker', priority: 0 })
    await Promise.resolve()
    expect(h.scheduler.acquire).toHaveBeenCalledTimes(1)
    expect(h.release).not.toHaveBeenCalled()
    expect(h.queue.counts()).toEqual([{ kind: 'worker', class: 'background', count: 1 }])
    // SPAWN017C: at pause the queued worker is refused at once, typed; the
    // killed tree keeps its reservation until its retirement is proved.
    const refused = expect(next.ready).rejects.toMatchObject({
      name: 'ResourcePausedError',
      code: 'paused',
    })
    await h.read({ memoryAvailableBytes: 0 })
    expect(await lease.kill?.()).toBe(true)
    await refused
    expect(h.queue.counts()).toEqual([])
    expect(h.release).not.toHaveBeenCalled()
    lease.complete(true)
    lease.complete(true)
    expect(h.release).toHaveBeenCalledTimes(1)
    h.governor.resumeNow()
    const following = await h.slots.request({ kind: 'worker', priority: 0 }).ready
    following.release()
  })

  it('releases a failed registry attachment before any process can spawn', async () => {
    const h = teamResources()
    await h.throttle()
    const slot = await h.slots.request({ kind: 'worker', priority: 0 }).ready
    const attach = vi.fn(() => {
      throw new Error('Registry unavailable')
    })
    expect(() => prepareTeamProcess(slot, { attach })).toThrow('Registry unavailable')
    expect(h.release).toHaveBeenCalledTimes(1)
    const following = await h.slots.request({ kind: 'worker', priority: 0 }).ready
    following.release()
  })

  it('uses failed-spawn proof to release the reservation through the registry callback', async () => {
    const h = teamResources()
    await h.throttle()
    const slot = await h.slots.request({ kind: 'worker', priority: 0 }).ready
    const lease = fakeResourceLease()
    prepareTeamProcess(slot, {
      attach: (_permit, onRetired) => {
        lease.complete.mockImplementation((isGone: boolean) => {
          if (isGone) onRetired()
        })
        return lease
      },
    })
    const child = new ChildProcess()
    observeResourceProcess(lease, child)
    child.emit('error', new Error('Spawn failed'))
    expect(lease.complete).toHaveBeenLastCalledWith(true)
    expect(h.release).toHaveBeenCalledTimes(1)
    const following = await h.slots.request({ kind: 'worker', priority: 0 }).ready
    following.release()
  })
})
