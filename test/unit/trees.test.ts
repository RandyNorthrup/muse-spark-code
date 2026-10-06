import { describe, expect, it, vi } from 'vitest'
import { ResourceTreeRegistry } from '../../src/core/resources/trees/registry'
import { resourceKindSchema, type ResourceTicket } from '../../src/shared/resources'
import { FakeResourceTree } from './helpers/resources/fakes'

function tree(id = 'check-1'): ResourceTicket {
  return {
    id,
    root: { pid: 701, startTime: '1000' },
    scope: { type: 'group', pgid: 701 },
    kind: 'check',
    class: 'background',
    sessionId: 'session-1',
  }
}

function world() {
  const ticket = tree()
  const reader = new FakeResourceTree()
  reader.register(ticket)
  reader.put(ticket.id, ticket.root, { cpuSeconds: 2, residentBytes: 4096 })
  const registry = new ResourceTreeRegistry(reader)
  return { ticket, reader, registry }
}

function pendingMembership(reader: FakeResourceTree) {
  const proof = Promise.withResolvers<boolean>()
  vi.spyOn(reader, 'contains').mockReturnValueOnce(proof.promise)
  return proof
}

describe('resource launch authority (M107 T)', () => {
  it('kills only a current registered member and refuses retirement during proof', async () => {
    const { ticket, reader } = world()
    const kill = vi.fn(() => Promise.resolve(true))
    const registry = new ResourceTreeRegistry(Object.assign(reader, { kill }))
    expect(await registry.kill(ticket)).toBe(false)
    await registry.register(ticket)
    expect(await registry.kill({ ...ticket, sessionId: 'forged' })).toBe(false)
    expect(await registry.kill(ticket)).toBe(true)
    expect(kill).toHaveBeenCalledExactlyOnceWith(ticket, ticket.root)
    const proof = pendingMembership(reader)
    vi.mocked(reader.contains).mockClear()
    const pending = registry.kill(ticket)
    await vi.waitFor(() => {
      expect(reader.contains).toHaveBeenCalledWith(ticket, ticket.root)
    })
    registry.unregister(ticket)
    proof.resolve(true)
    expect(await pending).toBe(false)
    expect(kill).toHaveBeenCalledTimes(1)
  })

  it('registers every kind and both classes with its actual root, scope and session', async () => {
    for (const kind of resourceKindSchema.options) {
      for (const workClass of ['foreground', 'background'] as const) {
        const { ticket, reader, registry } = world()
        const launch = { ...ticket, kind, class: workClass }
        expect(await registry.register(launch)).toEqual(launch)
        expect(registry.tickets()).toEqual([launch])
        expect(await registry.members(launch)).toEqual([ticket.root])
        expect(await registry.usage(launch)).toEqual({ cpuSeconds: 2, residentBytes: 4096 })
        reader.remove(ticket.root.pid)
        expect(await registry.contains(launch, launch.root)).toBe(false)
      }
    }
  })

  it('never authorizes unregistered or forged tickets, or the harness itself', async () => {
    const { registry, ticket, reader } = world()
    const proof = vi.spyOn(reader, 'contains')
    expect(await registry.contains(ticket, ticket.root)).toBe(false)
    expect(await registry.members(ticket)).toEqual([])
    expect(await registry.usage(ticket)).toBeNull()
    expect(proof).not.toHaveBeenCalled()
    await registry.register(ticket)
    const forged = { ...ticket, scope: { type: 'group', pgid: 999 } } as const
    expect(await registry.contains(forged, ticket.root)).toBe(false)
    expect(await registry.usage(forged)).toBeNull()
    reader.put(
      ticket.id,
      { pid: process.pid, startTime: '1000' },
      { cpuSeconds: 0, residentBytes: 0 },
    )
    expect(await registry.contains(ticket, { pid: process.pid, startTime: '1000' })).toBe(false)
    const selfTicket: ResourceTicket = {
      ...tree('self'),
      root: { pid: process.pid, startTime: '1000' },
      scope: { type: 'group', pgid: process.pid },
    }
    const selfReader = new FakeResourceTree()
    selfReader.register(selfTicket)
    selfReader.put(selfTicket.id, selfTicket.root, { cpuSeconds: 0, residentBytes: 0 })
    await expect(new ResourceTreeRegistry(selfReader).register(selfTicket)).rejects.toThrow(
      'harness',
    )
    registry.unregister(forged)
    expect(registry.tickets()).toEqual([ticket])
  })

  it('rechecks membership immediately before each action and refuses a recycled child or root', async () => {
    const { registry, ticket, reader } = world()
    const child = { pid: 702, startTime: '1001' }
    reader.put(ticket.id, child, { cpuSeconds: 1, residentBytes: 2048 })
    await registry.register(ticket)
    const priority = vi.fn()
    const act = async () => {
      if (await registry.contains(ticket, child)) priority(child)
    }
    await act()
    reader.put(ticket.id, { ...child, startTime: '2000' }, { cpuSeconds: 0, residentBytes: 1 })
    await act()
    reader.put(ticket.id, child, { cpuSeconds: 1, residentBytes: 2048 })
    reader.put(
      ticket.id,
      { ...ticket.root, startTime: '3000' },
      { cpuSeconds: 0, residentBytes: 1 },
    )
    await act()
    expect(priority.mock.calls).toEqual([[child]])
    expect(await registry.usage(ticket)).toBeNull()
  })

  it('keeps canonical copies and retires authority even during an in-flight proof', async () => {
    const { registry, ticket, reader } = world()
    const registered = await registry.register(ticket)
    registered.root.startTime = 'changed'
    ticket.sessionId = null
    const canonical = registry.tickets()[0]!
    const proof = Promise.withResolvers<boolean>()
    vi.spyOn(reader, 'contains').mockReturnValue(proof.promise)
    const pending = registry.contains(canonical, canonical.root)
    registry.unregister(canonical)
    proof.resolve(true)
    expect(await pending).toBe(false)
    expect(registry.tickets()).toEqual([])
    expect(await registry.members(canonical)).toEqual([])
  })

  it('reserves duplicate ids, roots and scopes and rolls back a failed launch proof', async () => {
    const { registry, ticket, reader } = world()
    const proof = pendingMembership(reader)
    const pending = registry.register(ticket)
    expect(registry.tickets()).toEqual([])
    await expect(registry.register(ticket)).rejects.toThrow('already registered')
    await expect(registry.register({ ...ticket, id: 'other' })).rejects.toThrow(
      'already registered',
    )
    proof.resolve(false)
    await expect(pending).rejects.toThrow('not proven')
    expect(registry.tickets()).toEqual([])
    await registry.register(ticket)
  })

  it('reports failed or invalid accounting as unknown, never zero', async () => {
    const { registry, ticket, reader } = world()
    await registry.register(ticket)
    vi.spyOn(reader, 'usage').mockRejectedValueOnce(new Error('denied'))
    expect(await registry.usage(ticket)).toBeNull()
    vi.spyOn(reader, 'usage').mockResolvedValueOnce({ cpuSeconds: NaN, residentBytes: 0 })
    expect(await registry.usage(ticket)).toBeNull()
    vi.spyOn(reader, 'members').mockResolvedValueOnce([{ pid: -1, startTime: 'invalid' }])
    expect(await registry.members(ticket)).toEqual([])
    vi.spyOn(reader, 'contains').mockRejectedValueOnce(new Error('denied'))
    expect(await registry.contains(ticket, ticket.root)).toBe(false)
  })

  it('cancels a pending launch without restoring authority when the OS proof finishes', async () => {
    const { registry, ticket, reader } = world()
    const proof = pendingMembership(reader)
    const pending = registry.register(ticket)
    registry.unregister(ticket)
    proof.resolve(true)
    await expect(pending).rejects.toThrow('cancelled')
    expect(registry.tickets()).toEqual([])
  })
})
