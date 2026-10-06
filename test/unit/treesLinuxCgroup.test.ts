import process from 'node:process'
import { describe, expect, it, vi } from 'vitest'
import { LinuxResourceTreeReader } from '../../src/core/resources/trees/linux'
import { ResourceTreeRegistry } from '../../src/core/resources/trees/registry'
import {
  LINUX_PID_IDENTITY_MIN_PID_MAX,
  RESOURCE_TREE_STOP_TIMEOUT_MS,
  RESOURCE_HARNESS_PLACEMENT_ATTEMPTS,
  RESOURCE_TREE_STOP_POLL_MS,
} from '../../src/shared/constants'
import type { ResourceSignal } from '../../src/core/resources/trees/actions'
import type { ResourceTicket } from '../../src/shared/resources'

const root = `/sys/fs/cgroup/user.slice/user-${String(process.getuid?.())}.slice/delegated`
const scope = `${root}/tree`
const ticket: ResourceTicket = {
  id: 'cgroup-owned',
  root: { pid: 710, startTime: '1000' },
  scope: { type: 'cgroup', path: scope },
  kind: 'check',
  class: 'foreground',
  sessionId: null,
}
function world() {
  const rows = new Map([
    [710, { birth: '1000', parent: 1 }],
    [711, { birth: '1001', parent: 710 }],
  ])
  const inside = new Set([710, 711])
  const events = { populated: true, frozen: false }
  const read = vi.fn((file: string) => {
    if (file === '/proc/sys/kernel/pid_max')
      return Promise.resolve(String(LINUX_PID_IDENTITY_MIN_PID_MAX))
    if (file === `${scope}/cpu.stat`) return Promise.resolve('usage_usec 12000000\n')
    if (file === `${scope}/cgroup.events`)
      return Promise.resolve(
        `populated ${events.populated ? '1' : '0'}\nfrozen ${events.frozen ? '1' : '0'}\n`,
      )
    if (file === `${scope}/cgroup.procs`) return Promise.resolve([...inside].join('\n'))
    const pid = Number(/^\/proc\/(\d+)\//.exec(file)?.[1])
    const row = rows.get(pid)
    if (row === undefined)
      return Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
    if (file.endsWith('/cgroup'))
      return Promise.resolve(
        `0::${inside.has(pid) ? scope.slice('/sys/fs/cgroup'.length) : '/outside'}\n`,
      )
    const fields = Array.from({ length: 50 }, () => '0')
    fields[0] = 'S'
    fields[1] = String(row.parent)
    fields[2] = String(pid)
    fields[19] = row.birth
    fields[21] = '1'
    return Promise.resolve(`${String(pid)} (fixture) ${fields.join(' ')}`)
  })
  const sendSignal = vi.fn<(pid: number, signal: ResourceSignal) => void>((pid) => {
    inside.delete(pid)
  })
  const killed = new Set<number>()
  const write = vi.fn((file: string, value: string) => {
    if (file === `${root}/cgroup.procs`) inside.delete(Number(value))
    if (file.endsWith('/cgroup.kill')) {
      for (const pid of inside) killed.add(pid)
      inside.clear()
    }
    if (file.endsWith('/cgroup.freeze')) events.frozen = value === '1'
    return Promise.resolve()
  })
  const remove = vi.fn(() => Promise.resolve())
  const directories = vi.fn<(directory: string) => Promise<readonly string[]>>(() =>
    Promise.resolve([]),
  )
  const reader = new LinuxResourceTreeReader({
    homeCgroup: root,
    pinDirectory: (directory) =>
      Promise.resolve({
        path: directory,
        removalPath: directory,
        matches: () => Promise.resolve(true),
        close: () => Promise.resolve(),
      }),
    ownedCgroupRoot: root,
    read,
    write,
    remove,
    directories,
    list: () => Promise.resolve(Array.from(rows.keys(), String)),
    canonical: (file) => Promise.resolve(file),
    sendSignal,
    run: (_file, args) => Promise.resolve(args[0] === 'CLK_TCK' ? '100' : '4096'),
  })
  return {
    reader,
    registry: new ResourceTreeRegistry(reader),
    rows,
    inside,
    events,
    read,
    write,
    remove,
    directories,
    sendSignal,
    killed,
  }
}

async function readyWorld() {
  const w = world()
  await w.registry.register(ticket)
  return w
}
function moveOutsideOnStat(w: ReturnType<typeof world>, afterReads: number) {
  const original = w.read.getMockImplementation()!
  let reads = 0
  w.read.mockImplementation((file) => {
    if (file === '/proc/711/stat' && ++reads === afterReads) w.inside.delete(711)
    return original(file)
  })
}
async function expectRefusedSignal(w: ReturnType<typeof world>, signal: ResourceSignal) {
  expect(await w.registry.signal(ticket, { pid: 711, startTime: '1001' }, signal)).toBe('refused')
  expect(w.sendSignal).not.toHaveBeenCalled()
}
function deferEvents(w: ReturnType<typeof world>) {
  const receipt = Promise.withResolvers<string>()
  const original = w.read.getMockImplementation()!
  w.read.mockImplementation((file) =>
    file.endsWith('/cgroup.events') ? receipt.promise : original(file),
  )
  return receipt
}
function unsupportedKill(w: ReturnType<typeof world>, code: string) {
  const original = w.write.getMockImplementation()!
  w.write.mockImplementation((file, value) =>
    file.endsWith('/cgroup.kill')
      ? Promise.reject(Object.assign(new Error('unsupported'), { code }))
      : original(file, value),
  )
}

async function expectHarnessSafeStop(w: ReturnType<typeof world>, signal: ResourceSignal) {
  w.events.populated = false
  expect(await w.registry.kill(ticket, signal)).toMatchObject({ status: 'done' })
  expect(w.killed.has(process.pid)).toBe(false)
  expect(w.sendSignal.mock.calls.some(([pid]) => pid === process.pid)).toBe(false)
  expect(w.inside.has(process.pid)).toBe(false)
}

describe('Linux cgroup authority', () => {
  it('reports harness_in_tree for late harness placement after freeze and thaws without signalling', async () => {
    const w = await readyWorld()
    const original = w.write.getMockImplementation()!
    w.write.mockImplementation(async (file, value) => {
      await original(file, value)
      if (value === '1' && file.endsWith('/cgroup.freeze')) w.inside.add(process.pid)
    })
    expect(await w.registry.kill(ticket, 'SIGTERM')).toMatchObject({ status: 'harness_in_tree' })
    expect(w.sendSignal).not.toHaveBeenCalled()
    expect(w.events.frozen).toBe(false)
    expect(w.registry.tickets()).toHaveLength(1)
    expect(w.remove).not.toHaveBeenCalled()
  })

  it.each(['SIGKILL', 'SIGTERM'] as const)(
    'moves the harness out when inserted before the scan, then safely stops with %s',
    async (signal) => {
      const w = await readyWorld()
      const original = w.read.getMockImplementation()!
      let isInserted = false
      w.read.mockImplementation((file) => {
        if (!isInserted && file === `${scope}/cgroup.procs`) {
          isInserted = true
          w.inside.add(process.pid)
        }
        return original(file)
      })
      await expectHarnessSafeStop(w, signal)
      expect(
        w.write.mock.calls.filter(([file]) => file === `${root}/cgroup.procs`).length,
      ).toBeGreaterThan(1)
    },
  )
  it.each(['SIGKILL', 'SIGTERM'] as const)(
    'reasserts the harness home after the scan and before %s dispatch',
    async (signal) => {
      const w = await readyWorld()
      const original = w.read.getMockImplementation()!
      w.read.mockImplementation((file) => {
        const result = original(file)
        const hasDispatched = w.write.mock.calls.some(
          ([target]) => target.endsWith('/cgroup.kill') || target.endsWith('/cgroup.freeze'),
        )
        if (!hasDispatched && file === `${scope}/cgroup.procs`) w.inside.add(process.pid)
        return result
      })
      await expectHarnessSafeStop(w, signal)
      const dispatch = w.write.mock.calls.findIndex(
        ([file, value]) =>
          (file.endsWith('/cgroup.kill') || file.endsWith('/cgroup.freeze')) && value === '1',
      )
      expect(w.write.mock.calls[dispatch - 1]).toEqual([
        `${root}/cgroup.procs`,
        String(process.pid),
      ])
    },
  )
  it('returns harness_in_tree after bounded reinsertion, retains ownership and lets a later Stop retry', async () => {
    const w = await readyWorld()
    const original = w.read.getMockImplementation()!
    w.read.mockImplementation((file) => {
      if (file === `${scope}/cgroup.procs`) w.inside.add(process.pid)
      return original(file)
    })
    expect(await w.registry.kill(ticket)).toMatchObject({
      status: 'harness_in_tree',
      message: expect.stringContaining('retry Stop'),
    })
    expect(w.write).toHaveBeenCalledTimes(RESOURCE_HARNESS_PLACEMENT_ATTEMPTS)
    expect(w.write.mock.calls.every(([file]) => file === `${root}/cgroup.procs`)).toBe(true)
    expect(w.registry.tickets()).toEqual([ticket])
    expect(w.killed.has(process.pid)).toBe(false)
    w.read.mockImplementation(original)
    w.events.populated = false
    expect(await w.registry.kill(ticket)).toMatchObject({ status: 'done' })
    expect(w.killed.has(process.pid)).toBe(false)
  })

  it('does not enroll a same-tick replacement that moves outside during the sample', async () => {
    const w = await readyWorld()
    moveOutsideOnStat(w, 2)
    expect(await w.registry.members(ticket)).toEqual([ticket.root])
    await expectRefusedSignal(w, 'SIGKILL')
  })
  it('omits ESRCH member churn without losing healthy cgroup accounting', async () => {
    const w = await readyWorld()
    const original = w.read.getMockImplementation()!
    w.read.mockImplementation((file) =>
      file === '/proc/711/stat'
        ? Promise.reject(Object.assign(new Error('gone'), { code: 'ESRCH' }))
        : original(file),
    )
    expect(await w.registry.usage(ticket)).toEqual({ cpuSeconds: 12, residentBytes: 4096 })
    expect(await w.reader.identity(711)).toBeNull()
  })

  it('refuses an outside root even when its birth matches the launch ticket', async () => {
    const w = world()
    w.inside.delete(710)
    await expect(w.registry.register(ticket)).rejects.toThrow('not proven')
  })
  it('waits for the frozen receipt before signalling any member', async () => {
    const w = await readyWorld()
    const receipt = deferEvents(w)
    const stopped = w.registry.kill(ticket, 'SIGTERM')
    await vi.waitFor(() => {
      expect(w.write).toHaveBeenCalledWith(`${scope}/cgroup.freeze`, '1')
    })
    expect(w.sendSignal).not.toHaveBeenCalled()
    receipt.resolve('populated 0\nfrozen 1\n')
    expect(await stopped).toMatchObject({ status: 'done' })
  })
  it('refuses a member that moves outside after its final birth read', async () => {
    const w = await readyWorld()
    moveOutsideOnStat(w, 6)
    await expectRefusedSignal(w, 'SIGTERM')
  })
  it('refuses an outside replacement from a stale frozen PID list and thaws', async () => {
    const w = await readyWorld()
    w.inside.delete(711)
    const original = w.read.getMockImplementation()!
    w.read.mockImplementation((file) =>
      file.endsWith('/cgroup.procs') ? Promise.resolve('710\n711') : original(file),
    )
    expect(await w.registry.kill(ticket, 'SIGTERM')).toMatchObject({ status: 'refused' })
    expect(w.sendSignal.mock.calls).toEqual([[710, 'SIGTERM']])
    expect(w.write).toHaveBeenLastCalledWith(`${scope}/cgroup.freeze`, '0')
    expect(w.remove).not.toHaveBeenCalled()
  })
  it('refuses completion after retirement while a dispatched kernel kill is pending', async () => {
    const w = await readyWorld()
    w.events.populated = false
    const dispatch = Promise.withResolvers<undefined>()
    w.write.mockReturnValueOnce(dispatch.promise)
    const stopped = w.registry.kill(ticket)
    await vi.waitFor(() => {
      expect(w.write).toHaveBeenCalled()
    })
    w.registry.unregister(ticket)
    dispatch.resolve(undefined)
    expect(await stopped).toMatchObject({ status: 'refused' })
    expect(w.remove).not.toHaveBeenCalled()
  })

  it.each(['malformed-event', 'unsafe-pid', 'harness-pid', 'malformed-pids'])(
    'refuses %s without claiming completion or removing the scope',
    async (failure) => {
      const w = world()
      await w.registry.register(ticket)
      const original = w.read.getMockImplementation()!
      w.read.mockImplementation((file) => {
        if (failure === 'malformed-event' && file.endsWith('/cgroup.events'))
          return Promise.resolve('populated 0\nfrozen malformed\n')
        if (failure !== 'malformed-event' && file.endsWith('/cgroup.procs')) {
          let contents = 'bad'
          if (failure === 'harness-pid') contents = String(process.pid)
          else if (failure === 'unsafe-pid') contents = '-1'
          return Promise.resolve(contents)
        }
        return original(file)
      })
      expect(await w.registry.kill(ticket)).toMatchObject({
        status: failure === 'harness-pid' ? 'harness_in_tree' : 'refused',
      })
      expect(w.remove).not.toHaveBeenCalled()
      expect(w.sendSignal).not.toHaveBeenCalled()
      if (failure !== 'malformed-event')
        expect(w.write.mock.calls.every(([file]) => file === `${root}/cgroup.procs`)).toBe(true)
    },
  )
  it('retains a populated scope when the completion deadline expires', async () => {
    const w = await readyWorld()
    vi.useFakeTimers()
    try {
      const stopped = w.registry.kill(ticket)
      await vi.advanceTimersByTimeAsync(RESOURCE_TREE_STOP_TIMEOUT_MS + RESOURCE_TREE_STOP_POLL_MS)
      expect(await stopped).toMatchObject({ status: 'refused' })
      expect(w.remove).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
  it('does not downgrade permission denial to the freeze fallback', async () => {
    const w = await readyWorld()
    w.events.populated = false
    unsupportedKill(w, 'EACCES')
    expect(await w.registry.kill(ticket)).toMatchObject({ status: 'refused' })
    expect(w.write.mock.calls.filter(([file]) => file.endsWith('/cgroup.kill'))).toHaveLength(1)
    expect(w.sendSignal).not.toHaveBeenCalled()
  })
  it('thaws after a failed frozen signal and retains ownership', async () => {
    const w = await readyWorld()
    unsupportedKill(w, 'EOPNOTSUPP')
    w.sendSignal.mockImplementationOnce(() => {
      throw Object.assign(new Error('denied'), { code: 'EPERM' })
    })
    expect(await w.registry.kill(ticket)).toMatchObject({ status: 'refused' })
    expect(w.write).toHaveBeenLastCalledWith(`${scope}/cgroup.freeze`, '0')
    expect(w.remove).not.toHaveBeenCalled()
    expect(w.registry.tickets()).toEqual([ticket])
  })
  it('includes nested cgroups in frozen signals and removes child scopes first', async () => {
    const w = await readyWorld()
    const original = w.read.getMockImplementation()!
    w.directories.mockImplementation((directory) =>
      Promise.resolve(directory === scope ? ['nested'] : []),
    )
    w.read.mockImplementation((file) => {
      if (file === `${scope}/nested/cgroup.procs`) return Promise.resolve('711')
      return file === `${scope}/cgroup.procs` ? Promise.resolve('710') : original(file)
    })
    w.events.populated = false
    expect(await w.registry.kill(ticket, 'SIGTERM')).toMatchObject({ status: 'done' })
    expect(w.sendSignal.mock.calls).toEqual([
      [710, 'SIGTERM'],
      [711, 'SIGTERM'],
    ])
    expect(w.remove.mock.calls).toEqual([[`${scope}/nested`], [scope]])
  })
  it('rechecks pid_max after group admission before each signal', async () => {
    const w = world()
    const grouped: ResourceTicket = { ...ticket, scope: { type: 'group', pgid: 710 } }
    await w.registry.register(grouped)
    const original = w.read.getMockImplementation()!
    w.read.mockImplementation((file) =>
      file === '/proc/sys/kernel/pid_max' ? Promise.resolve('32768') : original(file),
    )
    expect(await w.registry.signal(grouped, ticket.root, 'SIGTERM')).toBe('refused')
    expect(w.sendSignal).not.toHaveBeenCalled()
  })

  it('never enrolls or signals same-tick replacement 711 or its child 712 outside the cgroup', async () => {
    const w = await readyWorld()
    expect(await w.registry.members(ticket)).toHaveLength(2)
    w.inside.delete(711)
    w.rows.set(711, { birth: '1001', parent: 1 })
    w.rows.set(712, { birth: '1002', parent: 711 })
    expect(await w.registry.members(ticket)).toEqual([ticket.root])
    await expectRefusedSignal(w, 'SIGKILL')
    expect(await w.registry.contains(ticket, { pid: 712, startTime: '1002' })).toBe(false)
    w.events.populated = false
    expect(await w.registry.kill(ticket)).toMatchObject({ status: 'done' })
    expect(w.sendSignal).not.toHaveBeenCalled()
    expect(w.inside.has(711)).toBe(false)
    expect(w.rows.has(711)).toBe(true)
    expect(w.rows.has(712)).toBe(true)
  })
  it('enrolls kernel-contained orphans without a parent witness or a live original root', async () => {
    const w = await readyWorld()
    w.rows.delete(710)
    w.inside.delete(710)
    w.rows.delete(711)
    w.inside.delete(711)
    w.rows.set(712, { birth: '1002', parent: 1 })
    w.inside.add(712)
    expect(await w.registry.members(ticket)).toEqual([{ pid: 712, startTime: '1002' }])
    expect(await w.registry.usage(ticket)).toEqual({ cpuSeconds: 12, residentBytes: 4096 })
  })
  it('waits for populated zero before returning completion or removing the cgroup', async () => {
    const w = await readyWorld()
    const receipt = deferEvents(w)
    let isFinished = false
    const stopped = (async () => {
      const result = await w.registry.kill(ticket)
      isFinished = true
      return result
    })()
    await vi.waitFor(() => {
      expect(w.write).toHaveBeenCalledWith(`${scope}/cgroup.kill`, '1')
    })
    expect(isFinished).toBe(false)
    expect(w.remove).not.toHaveBeenCalled()
    receipt.resolve('populated 0\nfrozen 0\n')
    expect(await stopped).toMatchObject({ status: 'done' })
    expect(w.remove).toHaveBeenCalledWith(scope)
  })
  it('freezes and signals kernel members when cgroup.kill is unavailable, then thaws', async () => {
    const w = await readyWorld()
    unsupportedKill(w, 'ENOENT')
    w.events.populated = false
    expect(await w.registry.kill(ticket)).toMatchObject({ status: 'done' })
    expect(w.sendSignal.mock.calls).toEqual([
      [710, 'SIGKILL'],
      [711, 'SIGKILL'],
    ])
    expect(
      w.write.mock.calls
        .filter(([file]) => file.startsWith(`${scope}/`))
        .map((call) => [call[0].slice(scope.length), call[1]]),
    ).toEqual([
      ['/cgroup.kill', '1'],
      ['/cgroup.freeze', '1'],
      ['/cgroup.freeze', '0'],
    ])
  })
  it('refuses unreadable completion and retirement while keeping the scope', async () => {
    const w = await readyWorld()
    const original = w.read.getMockImplementation()!
    w.read.mockImplementation((file) =>
      file === `${scope}/cgroup.events` ? Promise.reject(new Error('unreadable')) : original(file),
    )
    expect(await w.registry.kill(ticket)).toMatchObject({ status: 'refused' })
    expect(w.remove).not.toHaveBeenCalled()
    w.read.mockImplementation(original)
    const pending = Promise.withResolvers<undefined>()
    w.write.mockReturnValueOnce(pending.promise)
    const stopped = w.registry.kill(ticket)
    w.registry.unregister(ticket)
    pending.resolve(undefined)
    expect(await stopped).toMatchObject({ status: 'refused' })
    expect(w.remove).not.toHaveBeenCalled()
  })
  it('refuses low pid_max group authority instead of assuming unique tick identities', async () => {
    const w = world()
    const original = w.read.getMockImplementation()!
    w.read.mockImplementation((file) =>
      file === '/proc/sys/kernel/pid_max'
        ? Promise.resolve(String(LINUX_PID_IDENTITY_MIN_PID_MAX - 1))
        : original(file),
    )
    const grouped: ResourceTicket = { ...ticket, scope: { type: 'group', pgid: 710 } }
    await expect(w.registry.register(grouped)).rejects.toThrow('not proven')
    expect(await w.registry.signal(grouped, ticket.root, 'SIGKILL')).toBe('refused')
    expect(w.sendSignal).not.toHaveBeenCalled()
  })
})
