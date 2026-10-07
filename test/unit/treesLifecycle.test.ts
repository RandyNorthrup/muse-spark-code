import { describe, expect, it, vi } from 'vitest'
import { LinuxResourceTreeReader } from '../../src/core/resources/trees/linux'
import { MacResourceTreeReader } from '../../src/core/resources/trees/mac'
import { ResourceTreeRegistry } from '../../src/core/resources/trees/registry'
import type { ResourceSignal } from '../../src/core/resources/trees/actions'
import type { ProcessSample } from '../../src/core/resources/trees/posixTable'
import type { ResourceTicket } from '../../src/shared/resources'

const ticket: ResourceTicket = {
  id: 'lifecycle',
  root: { pid: 710, startTime: '1000' },
  scope: { type: 'group', pgid: 710 },
  kind: 'check',
  class: 'foreground',
  sessionId: null,
}
function sample(pid: number, parent = 1, pgid = 710): ProcessSample {
  return {
    pid,
    parent,
    pgid,
    startTime: String(1000 + pid - 710),
    exited: false,
    cpuSeconds: 2,
    residentBytes: 4096,
  }
}
function stat(row: ProcessSample) {
  const fields = Array.from({ length: 50 }, () => '0')
  fields[0] = row.exited ? 'Z' : 'S'
  fields[1] = String(row.parent)
  fields[2] = String(row.pgid)
  fields[19] = row.startTime
  fields[21] = '1'
  return `${String(row.pid)} (fixture) ${fields.join(' ')}`
}
function world(platform: 'linux' | 'darwin') {
  const rows = new Map([
    [710, sample(710)],
    [711, sample(711, 710, 711)],
  ])
  const sendSignal = vi.fn<(pid: number, signal: ResourceSignal) => void>()
  const inspect = vi.fn((pid: number) => {
    const row = rows.get(pid)
    return Promise.resolve(
      row === undefined
        ? null
        : {
            pid: row.pid,
            startTime: row.startTime,
            parent: row.parent,
            pgid: row.pgid,
            exited: row.exited,
          },
    )
  })
  const read = vi.fn((file: string) => {
    if (file === '/proc/sys/kernel/pid_max') return Promise.resolve('4194304')
    const row = rows.get(Number(/\/proc\/(\d+)\/stat$/.exec(file)?.[1]))
    return row === undefined
      ? Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
      : Promise.resolve(stat(row))
  })
  const reader =
    platform === 'linux'
      ? new LinuxResourceTreeReader({
          read,
          list: () => Promise.resolve(Array.from(rows.keys(), String)),
          sendSignal,
          run: (_file, args) => Promise.resolve(args[0] === 'CLK_TCK' ? '100' : '4096'),
        })
      : new MacResourceTreeReader({
          inspect,
          sendSignal,
          run: () =>
            Promise.resolve(
              Array.from(
                rows.values(),
                (row) =>
                  `${String(row.pid)} ${String(row.parent)} ${String(row.pgid)} ${row.exited ? 'Z' : 'S'} 0:02.00 4`,
              ).join('\n'),
            ),
        })
  return { rows, sendSignal, inspect, read, reader, registry: new ResourceTreeRegistry(reader) }
}

describe.each(['linux', 'darwin'] as const)(
  '%s recorded ancestry and verified signals',
  (platform) => {
    it('enrolls new sessions, retains reparented descendants and snapshots them before tree kill', async () => {
      const { registry, rows, sendSignal } = world(platform)
      await registry.register(ticket)
      expect(await registry.members(ticket)).toContainEqual({ pid: 711, startTime: '1001' })
      rows.set(712, sample(712, 711, 712))
      expect(await registry.members(ticket)).toHaveLength(3)
      rows.delete(710)
      rows.delete(711)
      rows.set(712, sample(712, 1, 712))
      expect(await registry.members(ticket)).toEqual([{ pid: 712, startTime: '1002' }])
      const result = await registry.kill(ticket)
      expect(result.status).toBe('done')
      expect(result.members.map((member) => member.result)).toEqual(['done', 'gone', 'gone'])
      expect(sendSignal.mock.calls).toEqual([[712, 'SIGKILL']])
    })

    it('never admits an unobserved orphan, recycled member or unrelated reused group', async () => {
      const { registry, rows } = world(platform)
      await registry.register(ticket)
      rows.set(711, sample(711, 1, 711))
      rows.set(720, sample(720, 1, 710))
      rows.delete(710)
      expect(await registry.members(ticket)).toEqual([{ pid: 711, startTime: '1001' }])
      rows.set(711, { ...sample(711, 1, 711), startTime: '3000' })
      expect(await registry.contains(ticket, { pid: 711, startTime: '3000' })).toBe(false)
      const other = world(platform)
      other.rows.set(711, sample(711, 1, 711))
      await other.registry.register(ticket)
      expect(await other.registry.members(ticket)).toEqual([ticket.root])
    })

    it('keeps an observed detached descendant after the departed root PID is reused', async () => {
      const { registry, rows, sendSignal } = world(platform)
      await registry.register(ticket)
      rows.set(711, sample(711, 1, 711))
      rows.set(710, { ...sample(710, 1, 999), startTime: '5000' })
      expect(await registry.members(ticket)).toEqual([{ pid: 711, startTime: '1001' }])
      const result = await registry.kill(ticket)
      expect(result.status).toBe('identity-changed')
      expect(sendSignal.mock.calls).toEqual([[711, 'SIGKILL']])
    })

    it('admits a recycled PID only through a freshly proven ancestry edge', async () => {
      const { registry, rows, sendSignal } = world(platform)
      await registry.register(ticket)
      rows.set(711, { ...sample(711, 710, 711), startTime: '2000' })
      expect(await registry.members(ticket)).toContainEqual({ pid: 711, startTime: '2000' })
      expect(await registry.signal(ticket, { pid: 711, startTime: '1001' }, 'SIGKILL')).toBe(
        'refused',
      )
      expect(await registry.signal(ticket, { pid: 711, startTime: '2000' }, 'SIGKILL')).toBe('done')
      expect(sendSignal.mock.calls).toEqual([[711, 'SIGKILL']])
    })

    it('does not re-enroll a departed PID solely because a later birth joins its former group', async () => {
      const { registry, rows } = world(platform)
      await registry.register(ticket)
      rows.set(711, { ...sample(711, 1, 710), startTime: '2000' })
      expect(await registry.contains(ticket, { pid: 711, startTime: '2000' })).toBe(false)
      expect(await registry.members(ticket)).toEqual([ticket.root])
    })

    it('retains a proven descendant that reuses the original root PID after its parent exits', async () => {
      const { registry, rows } = world(platform)
      await registry.register(ticket)
      rows.set(710, { ...sample(710, 711, 710), startTime: '2000' })
      expect(await registry.members(ticket)).toContainEqual({ pid: 710, startTime: '2000' })
      rows.delete(711)
      rows.set(710, { ...sample(710, 1, 710), startTime: '2000' })
      expect(await registry.contains(ticket, ticket.root)).toBe(false)
      expect(await registry.members(ticket)).toEqual([{ pid: 710, startTime: '2000' }])
      expect(await registry.signal(ticket, { pid: 710, startTime: '2000' }, 'SIGKILL')).toBe('done')
    })

    it('rechecks exact birth immediately before signalling and distinguishes every outcome', async () => {
      const { registry, rows, sendSignal } = world(platform)
      await registry.register(ticket)
      const member = { pid: 711, startTime: '1001' }
      expect(await registry.signal(ticket, member, 'SIGTERM')).toBe('done')
      rows.set(711, { ...sample(711, 710, 711), startTime: '1002' })
      expect(await registry.signal(ticket, member, 'SIGKILL')).toBe('identity-changed')
      rows.set(711, { ...sample(711, 710, 711), exited: true })
      expect(await registry.signal(ticket, member, 'SIGTERM')).toBe('gone')
      rows.delete(711)
      expect(await registry.signal(ticket, member, 'SIGTERM')).toBe('gone')
      rows.set(711, sample(711, 710, 711))
      sendSignal.mockImplementationOnce(() => {
        throw Object.assign(new Error('exit race'), { code: 'ESRCH' })
      })
      expect(await registry.signal(ticket, member, 'SIGTERM')).toBe('gone')
      sendSignal.mockImplementationOnce(() => {
        throw Object.assign(new Error('denied'), { code: 'EPERM' })
      })
      expect(await registry.signal(ticket, member, 'SIGTERM')).toBe('refused')
      expect(sendSignal).toHaveBeenCalledTimes(3)
    })

    it('does not signal after retirement while the final birth read is pending', async () => {
      const { registry, reader, inspect, read, sendSignal } = world(platform)
      await registry.register(ticket)
      let action: ReturnType<ResourceTreeRegistry['signal']>
      if (platform === 'linux') {
        const proof = Promise.withResolvers<string>()
        read.mockReturnValueOnce(proof.promise)
        action = registry.signal(ticket, { pid: 711, startTime: '1001' }, 'SIGKILL')
        proof.resolve(stat(sample(711, 710, 711)))
      } else {
        const proof = Promise.withResolvers<Awaited<ReturnType<typeof inspect>>>()
        inspect.mockReturnValueOnce(proof.promise)
        action = registry.signal(ticket, { pid: 711, startTime: '1001' }, 'SIGKILL')
        proof.resolve({ pid: 711, parent: 710, pgid: 711, startTime: '1001', exited: false })
      }
      registry.unregister(ticket)
      expect(await action).toBe('refused')
      expect(sendSignal).not.toHaveBeenCalled()
      expect(reader).toHaveProperty('states.size', 0)
    })

    it.each(['edge', 'parent-birth'] as const)(
      'refuses a newcomer when its %s changed after the anchor proof',
      async (changed) => {
        const { registry, rows, inspect, read } = world(platform)
        rows.delete(711)
        await registry.register(ticket)
        rows.set(711, sample(711, 710, 711))
        let reads = 0
        const change = () => {
          if (++reads > 1) {
            if (changed === 'edge') rows.set(711, sample(711, 1, 711))
            else rows.set(710, { ...sample(710), startTime: '3000' })
          }
        }
        if (platform === 'linux') {
          const original = read.getMockImplementation()!
          read.mockImplementation((file) => {
            if (file === '/proc/711/stat') change()
            return original(file)
          })
        } else {
          const original = inspect.getMockImplementation()!
          inspect.mockImplementation((pid) => {
            if (pid === 711) change()
            return original(pid)
          })
        }
        expect(await registry.members(ticket)).toEqual([ticket.root])
        expect(await registry.signal(ticket, { pid: 711, startTime: '1001' }, 'SIGKILL')).toBe(
          'refused',
        )
      },
    )

    it('reports inaccessible final birth reads as refused, never gone or done', async () => {
      const { registry, inspect, read, sendSignal } = world(platform)
      await registry.register(ticket)
      if (platform === 'linux')
        read.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
      else inspect.mockRejectedValueOnce(new Error('denied'))
      expect(await registry.signal(ticket, { pid: 711, startTime: '1001' }, 'SIGKILL')).toBe(
        'refused',
      )
      expect(sendSignal).not.toHaveBeenCalled()
    })
  },
)
