import { describe, expect, it, vi } from 'vitest'
import { ResourceTreeRegistry } from '../../src/core/resources/trees/registry'
import { PosixResourceTreeReader } from '../../src/core/resources/trees/posix'
import {
  signalVerifiedPosix,
  type ResourceActionResult,
  type ResourceTreeActionReader,
} from '../../src/core/resources/trees/actions'
import type { ResourceTicket } from '../../src/shared/resources'
import { FakeResourceTree } from './helpers/resources/fakes'

const ticket: ResourceTicket = {
  id: 'action-tree',
  root: { pid: 701, startTime: '1000' },
  scope: { type: 'group', pgid: 701 },
  kind: 'check',
  class: 'foreground',
  sessionId: null,
}
const child = { pid: 702, startTime: '1001' }

function world() {
  const fake = new FakeResourceTree()
  fake.register(ticket)
  for (const identity of [ticket.root, child])
    fake.put(ticket.id, identity, { cpuSeconds: 1, residentBytes: 1 })
  const signal = vi.fn<ResourceTreeActionReader['signal']>(
    (_ticket, _identity, _signal, isRegistered) =>
      Promise.resolve<ResourceActionResult>(isRegistered() ? 'done' : 'refused'),
  )
  const actionMembers = vi.fn<ResourceTreeActionReader['actionMembers']>(() =>
    Promise.resolve([ticket.root, child]),
  )
  const registry = new ResourceTreeRegistry({
    contains: (launch, identity) => fake.contains(launch, identity),
    members: (launch) => fake.members(launch),
    usage: (launch) => fake.usage(launch),
    actionMembers,
    signal,
  })
  return { registry, signal, actionMembers }
}

describe('registered process actions', () => {
  it('refuses process groups, unsafe PIDs and the harness at the POSIX mutation boundary', () => {
    const send = vi.fn()
    for (const pid of [-1, 0, NaN, Infinity, process.pid]) {
      const identity = { pid, startTime: '1000' }
      expect(signalVerifiedPosix(identity, identity, 'SIGKILL', () => true, send)).toBe('refused')
    }
    expect(
      signalVerifiedPosix(
        ticket.root,
        { ...child, startTime: ticket.root.startTime },
        'SIGKILL',
        () => true,
        send,
      ),
    ).toBe('identity-changed')
    expect(send).not.toHaveBeenCalled()
  })
  it('proves a live root independently of an unavailable global accounting table', async () => {
    const reader = new PosixResourceTreeReader({
      snapshot: () => Promise.resolve(null),
      containsNow: () => Promise.resolve(true),
      signalNow: (_identity, _signal, isRegistered) =>
        Promise.resolve(isRegistered() ? 'done' : 'refused'),
    })
    const registry = new ResourceTreeRegistry(reader)
    await registry.register(ticket)
    expect(await registry.usage(ticket)).toBeNull()
    expect(await registry.signal(ticket, ticket.root, 'SIGTERM')).toBe('done')
    expect(await registry.kill(ticket)).toEqual({ status: 'refused', members: [] })
  })

  it('refuses retirement or a changed native root before committing its launch witness', async () => {
    let proofs = 0
    const reader = new PosixResourceTreeReader({
      snapshot: () => Promise.resolve(null),
      containsNow: () => Promise.resolve(++proofs === 1),
    })
    await expect(new ResourceTreeRegistry(reader).register(ticket)).rejects.toThrow('not proven')
    expect(reader).toHaveProperty('states.size', 0)
  })

  it('never restores a root epoch after its pending native launch proof is retired', async () => {
    const proof = Promise.withResolvers<boolean>()
    const reader = new PosixResourceTreeReader({
      snapshot: () => Promise.resolve(null),
      containsNow: () => proof.promise,
    })
    const registry = new ResourceTreeRegistry(reader)
    const pending = registry.register(ticket)
    registry.unregister(ticket)
    proof.resolve(true)
    await expect(pending).rejects.toThrow()
    expect(reader).toHaveProperty('states.size', 0)
    expect(registry.tickets()).toEqual([])
  })
  it('refuses unregistered, forged, retired and harness targets before the mutation port', async () => {
    const { registry, signal } = world()
    expect(await registry.signal(ticket, child, 'SIGTERM')).toBe('refused')
    expect(await registry.kill(ticket)).toMatchObject({ status: 'refused' })
    await registry.register(ticket)
    expect(await registry.signal({ ...ticket, class: 'background' }, child, 'SIGTERM')).toBe(
      'refused',
    )
    expect(await registry.signal(ticket, { pid: process.pid, startTime: '1000' }, 'SIGKILL')).toBe(
      'refused',
    )
    registry.unregister(ticket)
    expect(await registry.signal(ticket, child, 'SIGTERM')).toBe('refused')
    expect(signal).not.toHaveBeenCalled()
  })

  it('passes canonical copies and invalidates permission after a pending proof', async () => {
    const { registry, signal } = world()
    await registry.register(ticket)
    const proof = Promise.withResolvers<ResourceActionResult>()
    signal.mockImplementationOnce(async (launch, identity, _signal, isRegistered) => {
      launch.root.startTime = 'changed-copy'
      identity.startTime = 'changed-copy'
      await proof.promise
      return isRegistered() ? 'done' : 'refused'
    })
    const pending = registry.signal(ticket, child, 'SIGTERM')
    registry.unregister(ticket)
    await registry.register(ticket)
    proof.resolve('done')
    expect(await pending).toBe('refused')
    expect(registry.tickets()).toEqual([ticket])
    expect(child.startTime).toBe('1001')
  })

  it('snapshots exact members before signalling, visits descendants first and keeps honest results', async () => {
    const { registry, signal, actionMembers } = world()
    await registry.register(ticket)
    signal.mockResolvedValueOnce('gone').mockResolvedValueOnce('done')
    const result = await registry.kill(ticket, 'SIGTERM')
    expect(actionMembers).toHaveBeenCalledTimes(1)
    expect(signal.mock.calls.map((call) => call[1])).toEqual([child, ticket.root])
    expect(result).toEqual({
      status: 'done',
      members: [
        { identity: child, result: 'gone' },
        { identity: ticket.root, result: 'done' },
      ],
    })
    signal.mockResolvedValueOnce('identity-changed').mockResolvedValueOnce('gone')
    expect(await registry.kill(ticket)).toMatchObject({ status: 'identity-changed' })
    signal.mockRejectedValueOnce(new Error('denied'))
    expect(await registry.kill(ticket)).toMatchObject({ status: 'refused' })
  })

  it('refuses unknown snapshots, unsupported ports and retirement during enumeration', async () => {
    const { registry, actionMembers, signal } = world()
    await registry.register(ticket)
    actionMembers.mockResolvedValueOnce(null)
    expect(await registry.kill(ticket)).toMatchObject({ status: 'refused' })
    actionMembers.mockResolvedValueOnce([])
    expect(await registry.kill(ticket)).toMatchObject({ status: 'gone' })
    actionMembers.mockResolvedValueOnce([child, { pid: -1, startTime: '1000' }])
    expect(await registry.kill(ticket)).toMatchObject({ status: 'refused' })
    expect(signal).not.toHaveBeenCalled()
    const pendingMembers = Promise.withResolvers<readonly (typeof child)[] | null>()
    actionMembers.mockReturnValueOnce(pendingMembers.promise)
    const pending = registry.kill(ticket)
    registry.unregister(ticket)
    pendingMembers.resolve([child])
    expect(await pending).toEqual({ status: 'refused', members: [] })
    expect(signal).not.toHaveBeenCalled()
    const fake = new FakeResourceTree()
    fake.register(ticket)
    fake.put(ticket.id, ticket.root, { cpuSeconds: 1, residentBytes: 1 })
    const readOnly = new ResourceTreeRegistry(fake)
    await readOnly.register(ticket)
    expect(await readOnly.signal(ticket, ticket.root, 'SIGTERM')).toBe('refused')
    expect(await readOnly.kill(ticket)).toMatchObject({ status: 'refused' })
  })
})
