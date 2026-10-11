import { describe, expect, it } from 'vitest'
import { resourceSampleSchema, type ResourceTicket } from '../../src/shared/resources'
import {
  FakeResourceClock,
  FakeResourceLinkedDevice,
  FakeResourceTree,
  ScriptedResourceSampler,
} from './helpers/resources/fakes'

const unknown = resourceSampleSchema.parse({
  atMs: 0,
  cpuPercent: null,
  memoryUsedPercent: null,
  memoryAvailableBytes: null,
  memoryTotalBytes: null,
  gpuPercent: null,
  diskBusyPercent: null,
  pressure: null,
})
const ticket: ResourceTicket = {
  id: 'tree',
  root: { pid: 10, startTime: 'first' },
  scope: { type: 'group', pgid: 10 },
  kind: 'check',
  class: 'background',
  sessionId: null,
}

describe('M107 reusable scripted fakes', () => {
  it('samples explicit unknown and zero in order, then refuses an exhausted script', async () => {
    const sampler = new ScriptedResourceSampler([
      unknown,
      { ...unknown, atMs: 5000, cpuPercent: 0 },
    ])
    expect(await sampler.sample()).toEqual(unknown)
    const zero = await sampler.sample()
    expect(zero.cpuPercent).toBe(0)
    await expect(sampler.sample()).rejects.toThrow('exhausted')
    expect(sampler.calls).toBe(3)
  })
  it('runs timers in time/FIFO order, supports cancellation and nested timers', () => {
    const clock = new FakeResourceClock()
    const calls: number[] = []
    clock.setTimeout(() => {
      calls.push(clock.now())
      clock.setTimeout(() => {
        calls.push(clock.now())
      }, 1)
    }, 2)
    const cancel = clock.setTimeout(() => {
      calls.push(-1)
    }, 1)
    clock.setTimeout(() => {
      calls.push(clock.now() * 10)
    }, 2)
    cancel()
    clock.advance(1)
    expect(calls).toEqual([])
    clock.advance(2)
    expect(calls).toEqual([2, 20, 3])
    expect(clock.now()).toBe(3)
    for (const invalid of [-1, NaN, Infinity]) {
      expect(() => {
        clock.advance(invalid)
      }).toThrow()
      expect(() => clock.setTimeout(() => undefined, invalid)).toThrow()
    }
  })
  it('accounts a registered tree and refuses foreign, unregistered and reused processes', async () => {
    const tree = new FakeResourceTree()
    tree.register(ticket)
    tree.put(ticket.id, ticket.root, { cpuSeconds: 2, residentBytes: 100 })
    const child = { pid: 11, startTime: 'child' }
    tree.put(ticket.id, child, { cpuSeconds: 1, residentBytes: 100 })
    expect(await tree.members(ticket)).toEqual([ticket.root, child])
    expect(await tree.usage(ticket)).toEqual({ cpuSeconds: 3, residentBytes: 200 })
    expect(await tree.contains(ticket, child)).toBe(true)
    expect(await tree.contains({ ...ticket, id: 'unregistered' }, child)).toBe(false)
    expect(await tree.contains(ticket, { pid: 99, startTime: 'user-process' })).toBe(false)
    tree.put(ticket.id, { ...child, startTime: 'recycled' }, { cpuSeconds: 0, residentBytes: 0 })
    expect(await tree.contains(ticket, child)).toBe(false)
    tree.put(
      ticket.id,
      { ...ticket.root, startTime: 'recycled-root' },
      { cpuSeconds: 0, residentBytes: 0 },
    )
    expect(await tree.members(ticket)).toEqual([])
    expect(await tree.usage(ticket)).toBeNull()
    tree.remove(child.pid)
    expect(() => {
      tree.register(ticket)
    }).toThrow('already registered')
    expect(() => {
      tree.put('unregistered', child, { cpuSeconds: 0, residentBytes: 0 })
    }).toThrow('not registered')
  })
  it('rechecks the current offer and level on admission; headroom supplies no authority', async () => {
    const device = new FakeResourceLinkedDevice()
    expect(await device.resource()).toEqual({ level: 'normal', headroom: 'ample' })
    expect(await device.admit('repo', 'check')).toBe(false)
    device.offer('repo', ['check'])
    expect(device.hasOffer('repo', 'worker')).toBe(false)
    expect(await device.admit('other-repo', 'check')).toBe(false)
    expect(await device.admit('repo', 'check')).toBe(true)
    for (const level of ['throttle', 'relocate', 'pause'] as const) {
      device.setResource({ level, headroom: 'ample' })
      expect(await device.admit('repo', 'check')).toBe(false)
    }
    device.setResource({ level: 'normal', headroom: 'some' })
    device.revoke('repo')
    expect(await device.admit('repo', 'check')).toBe(false)
    expect(device.admissions.map((admission) => admission.isAllowed)).toEqual([
      false,
      false,
      true,
      false,
      false,
      false,
      false,
    ])
  })
})
