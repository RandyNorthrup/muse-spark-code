import { spawn } from 'node:child_process'
import { once } from 'node:events'
import process from 'node:process'
import { describe, expect, it, vi } from 'vitest'
import { LinuxResourceTreeReader, type LinuxTreeDeps } from '../../src/core/resources/trees/linux'
import { MacResourceTreeReader } from '../../src/core/resources/trees/mac'
import {
  PosixResourceTreeReader,
  type PosixTreeSnapshot,
} from '../../src/core/resources/trees/posix'
import {
  parseCpuTime,
  parseLinuxStat,
  parseMacProcessTable,
  type ProcessSample,
} from '../../src/core/resources/trees/posixTable'
import { ResourceTreeRegistry } from '../../src/core/resources/trees/registry'
import { parseProcessTable } from '../../src/core/resources/trees/processTable'
import { runTreeProgram } from '../../src/core/resources/trees/run'
import type { ResourceTicket } from '../../src/shared/resources'

const ticket: ResourceTicket = {
  id: 'posix-tree',
  root: { pid: 710, startTime: '1000' },
  scope: { type: 'group', pgid: 710 },
  kind: 'museServe',
  class: 'background',
  sessionId: null,
}
function row(pid: number, startTime = '1000', pgid = 710): ProcessSample {
  return { pid, startTime, pgid, parent: 1, exited: false, cpuSeconds: 2, residentBytes: 4096 }
}
function stat(sample: ProcessSample, command = 'owned (worker)') {
  const fields = Array.from({ length: 50 }, () => '0')
  fields[0] = sample.exited ? 'Z' : 'S'
  fields[1] = String(sample.parent)
  fields[2] = String(sample.pgid)
  fields[11] = String(sample.cpuSeconds * 100)
  fields[12] = '0'
  fields[19] = sample.startTime
  fields[21] = String(sample.residentBytes / 4096)
  return `${String(sample.pid)} (${command}) ${fields.join(' ')}`
}

describe('numeric process accounting tables', () => {
  it('runs bounded probes without inheriting the parent environment', async () => {
    const sentinel = 'M107_TREE_PROBE_SENTINEL'
    const prior = process.env[sentinel]
    process.env[sentinel] = 'owned-test-marker'
    try {
      expect(
        await runTreeProgram(process.execPath, [
          '-e',
          `process.stdout.write(process.env['${sentinel}'] === undefined ? 'absent' : 'inherited')`,
        ]),
      ).toBe('absent')
      await expect(runTreeProgram(process.execPath, ['-e', 'process.exit(1)'])).rejects.toThrow()
    } finally {
      if (prior === undefined) delete process.env['M107_TREE_PROBE_SENTINEL']
      else process.env[sentinel] = prior
    }
  })
  it('parses Linux exact start ticks, own CPU and RSS despite parentheses or newlines in comm', () => {
    expect(parseLinuxStat(stat(row(710), 'strange ) (name\n)'), 100, 4096)).toEqual(row(710))
    const fields = stat(row(710)).split(' ')
    expect(parseLinuxStat('error', 100, 4096)).toBeNull()
    expect(parseLinuxStat(fields.slice(0, 10).join(' '), 100, 4096)).toBeNull()
    expect(parseLinuxStat(stat({ ...row(710), residentBytes: -4096 }), 100, 4096)).toBeNull()
    expect(parseLinuxStat(stat(row(710)), 0, 4096)).toBeNull()
    expect(parseLinuxStat(stat(row(710)), 100, NaN)).toBeNull()
    expect(parseLinuxStat(stat({ ...row(710), exited: true }), 100, 4096)?.exited).toBe(true)
  })

  it('parses Darwin CPU durations and KiB with no process names, rejecting incomplete tables', () => {
    expect(parseCpuTime('01:02.50')).toBe(62.5)
    expect(parseCpuTime('2-03:04:05.00')).toBe(183_845)
    expect(parseCpuTime('0:60')).toBeNull()
    expect(parseCpuTime('n/a')).toBeNull()
    expect(parseMacProcessTable(' 710 1 710 S 0:02.00 4\n711 1 710 S 1:00.25 8\n')).toEqual([
      { pid: 710, pgid: 710, parent: 1, exited: false, cpuSeconds: 2, residentBytes: 4096 },
      { pid: 711, pgid: 710, parent: 1, exited: false, cpuSeconds: 60.25, residentBytes: 8192 },
    ])
    expect(parseMacProcessTable('710 1 710 S 0:02.00 4\nps: denied')).toBeNull()
    expect(parseMacProcessTable('710 710 0:02.00 -1')).toBeNull()
    expect(parseMacProcessTable('9007199254740992 1 710 S 0:00.00 0')).toBeNull()
  })

  it('retains the Windows orphan parser and excludes invalid or unsafe process ids', () => {
    expect(parseProcessTable('710 1 134040000000000000 Worker.exe\n')).toEqual([
      {
        pid: 710,
        parent: 1,
        ticks: '134040000000000000',
        createdAt: 1_759_526_400_000,
        name: 'Worker.exe',
      },
    ])
    expect(
      parseProcessTable(
        '0 1 134040000000000000 zero\n9007199254740992 1 134040000000000000 unsafe\n',
      ),
    ).toEqual([])
  })
})

describe('POSIX group and start-time proof', () => {
  it('excludes foreign groups, older processes, the harness and recycled identities from actions', async () => {
    let rows = [
      row(710),
      row(711, '1001'),
      row(712, '999'),
      row(713, '1002', 888),
      row(process.pid),
    ]
    const reader = new PosixResourceTreeReader({
      containsNow: () => Promise.resolve(true),
      snapshot: () => Promise.resolve({ rows, cpuSeconds: null }),
    })
    const registry = new ResourceTreeRegistry(reader)
    await registry.register(ticket)
    expect(await registry.members(ticket)).toEqual([ticket.root, { pid: 711, startTime: '1001' }])
    expect(await reader.members(ticket)).toEqual([ticket.root, { pid: 711, startTime: '1001' }])
    const priority = vi.fn()
    for (const target of rows) {
      if (await registry.contains(ticket, { pid: target.pid, startTime: target.startTime }))
        priority(target.pid)
    }
    expect(priority.mock.calls).toEqual([[710], [711]])
    rows = [row(710), row(711, '2000')]
    expect(await registry.contains(ticket, { pid: 711, startTime: '1001' })).toBe(false)
    rows = [row(710, '3000'), row(711, '2000')]
    expect(await registry.members(ticket)).toEqual([])
    expect(await registry.usage(ticket)).toBeNull()
    expect(await registry.contains(ticket, rows[1]!)).toBe(false)
  })

  it('continues an observed orphan group, but never admits an unanchored or recycled group', async () => {
    let rows = [row(710), row(711, '1001')]
    const reader = new PosixResourceTreeReader({
      containsNow: () => Promise.resolve(true),
      snapshot: () => Promise.resolve({ rows, cpuSeconds: null }),
    })
    expect(await reader.contains(ticket, ticket.root)).toBe(true)
    rows = [row(711, '1001'), row(714, '2000')]
    expect(await reader.contains(ticket, rows[1]!)).toBe(true)
    rows = [row(711, '3000'), row(714, '3001')]
    expect(await reader.members(ticket)).toEqual([])
    expect(await reader.usage(ticket)).toBeNull()
    expect(
      await new PosixResourceTreeReader({
        containsNow: () => Promise.resolve(true),
        snapshot: () => Promise.resolve({ rows, cpuSeconds: null }),
      }).members(ticket),
    ).toEqual([])
    expect(
      await reader.contains({ ...ticket, scope: { type: 'group', pgid: 888 } }, rows[0]!),
    ).toBe(false)
  })

  it('refuses a group that the registered root did not lead', async () => {
    const reader = new PosixResourceTreeReader({
      containsNow: () => Promise.resolve(true),
      snapshot: () => Promise.resolve({ rows: [row(710, '1000', 888)], cpuSeconds: null }),
    })
    expect(await reader.usage({ ...ticket, scope: { type: 'group', pgid: 888 } })).toBeNull()
  })

  it('retains observed CPU across exits, uses cgroup lifetime CPU and sums only current RSS', async () => {
    let snapshot: PosixTreeSnapshot | null = {
      rows: [row(710), row(711, '1001')],
      cpuSeconds: null,
    }
    const reader = new PosixResourceTreeReader({
      snapshot: () => Promise.resolve(snapshot),
      containsNow: () => Promise.resolve(true),
    })
    expect(await reader.usage(ticket)).toEqual({ cpuSeconds: 4, residentBytes: 8192 })
    snapshot = { rows: [{ ...row(710), cpuSeconds: 3 }], cpuSeconds: null }
    expect(await reader.usage(ticket)).toEqual({ cpuSeconds: 5, residentBytes: 4096 })
    const scoped: ResourceTicket = { ...ticket, scope: { type: 'cgroup', path: '/private-scope' } }
    snapshot = { rows: [row(710)], cpuSeconds: 12.5 }
    expect(await reader.usage(scoped)).toEqual({ cpuSeconds: 12.5, residentBytes: 4096 })
    snapshot = null
    expect(await reader.usage(scoped)).toBeNull()
    snapshot = { rows: [row(710)], cpuSeconds: null }
    reader.forget(scoped)
    expect(await reader.usage(scoped)).toBeNull()
    expect(
      await reader.usage({ ...ticket, root: { ...ticket.root, startTime: 'whole seconds' } }),
    ).toBeNull()
  })

  it.each(['snapshot', 'anchor', 'target'] as const)(
    'does not restore POSIX state when a pending %s finishes after retirement',
    async (stage) => {
      const current = { rows: [row(710), row(711, '1001')], cpuSeconds: null }
      const snapshot = vi.fn(() => Promise.resolve(current))
      const containsNow = vi.fn(() => Promise.resolve(true))
      const reader = new PosixResourceTreeReader({ snapshot, containsNow })
      const registry = new ResourceTreeRegistry(reader)
      await registry.register(ticket)
      const started = Promise.withResolvers<undefined>()
      const finish = Promise.withResolvers<undefined>()
      const wait = async () => {
        started.resolve(undefined)
        await finish.promise
      }
      if (stage === 'snapshot')
        snapshot.mockImplementationOnce(async () => {
          await wait()
          return current
        })
      else {
        if (stage === 'target') containsNow.mockResolvedValueOnce(true)
        containsNow.mockImplementationOnce(async () => {
          await wait()
          return true
        })
      }
      const pending =
        stage === 'target' ? reader.contains(ticket, ticket.root) : reader.usage(ticket)
      await started.promise
      registry.unregister(ticket)
      finish.resolve(undefined)
      if (stage === 'target') expect(await pending).toBe(false)
      else expect(await pending).toBeNull()
      expect(registry.tickets()).toEqual([])
      expect(reader).toHaveProperty('states.size', 0)
    },
  )

  it.each([false, true])(
    'isolates a new POSIX ticket epoch from an old scan (recycled=%s)',
    async (isRecycled) => {
      let current: PosixTreeSnapshot = { rows: [row(710), row(711, '1001')], cpuSeconds: null }
      const snapshot = vi.fn(() => Promise.resolve(current))
      const reader = new PosixResourceTreeReader({
        snapshot,
        containsNow: () => Promise.resolve(true),
      })
      const registry = new ResourceTreeRegistry(reader)
      await registry.register(ticket)
      const finish = Promise.withResolvers<PosixTreeSnapshot>()
      snapshot.mockReturnValueOnce(finish.promise)
      const pending = registry.usage(ticket)
      registry.unregister(ticket)
      await registry.register(ticket)
      finish.resolve({
        rows: [{ ...row(710, isRecycled ? '3000' : '1000'), cpuSeconds: 99 }],
        cpuSeconds: null,
      })
      expect(await pending).toBeNull()
      expect(reader).toHaveProperty('states.size', 1)
      current = { rows: [row(711, '1001')], cpuSeconds: null }
      expect(await registry.usage(ticket)).toEqual({ cpuSeconds: 4, residentBytes: 4096 })
    },
  )
})

function linuxWorld(scope?: string, overrides: Partial<LinuxTreeDeps> = {}) {
  const samples = new Map([
    [710, row(710)],
    [711, row(711, '1001')],
    [999, row(999, '3000', 999)],
  ])
  const files = new Map<string, string>()
  const delegated =
    scope ?? `/sys/fs/cgroup/user.slice/user-${String(process.getuid?.())}.slice/owned.scope`
  const cg = `${delegated}/check-1`
  const read = vi.fn((file: string) => {
    if (file === '/proc/sys/kernel/pid_max') return Promise.resolve('4194304')
    const pid = /\/proc\/(\d+)\/stat$/.exec(file)?.[1]
    if (pid !== undefined) {
      const sample = samples.get(Number(pid))
      return sample === undefined
        ? Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
        : Promise.resolve(stat(sample))
    }
    return files.has(file)
      ? Promise.resolve(files.get(file)!)
      : Promise.reject(new Error('unavailable'))
  })
  const run = vi.fn((_file: string, args: readonly string[]) =>
    Promise.resolve(args[0] === 'CLK_TCK' ? '100\n' : '4096\n'),
  )
  const reader = new LinuxResourceTreeReader({
    ownedCgroupRoot: scope ?? delegated,
    read,
    list: () => Promise.resolve(['self', '710', '711', '999']),
    canonical: (file) => Promise.resolve(file),
    directories: (file) => Promise.resolve(file === cg ? ['nested'] : []),
    run,
    ...overrides,
  })
  files.set(`${cg}/cgroup.procs`, '710\n')
  files.set(`${cg}/nested/cgroup.procs`, '711\n')
  files.set('/proc/710/cgroup', `0::${cg.slice('/sys/fs/cgroup'.length)}\n`)
  files.set('/proc/711/cgroup', `0::${cg.slice('/sys/fs/cgroup'.length)}/nested\n`)
  files.set('/proc/999/cgroup', '0::/outside\n')
  files.set(`${cg}/cpu.stat`, 'usage_usec 12500000\nuser_usec 10000000\nsystem_usec 2500000\n')
  return { reader, samples, files, read, run, cg }
}

async function registeredLinuxCgroup() {
  const world = linuxWorld()
  const scoped: ResourceTicket = { ...ticket, scope: { type: 'cgroup', path: world.cg } }
  const registry = new ResourceTreeRegistry(world.reader)
  await registry.register(scoped)
  return { ...world, scoped, registry }
}

describe('POSIX authority during mixed-time scans', () => {
  it.each([
    { platform: 'linux', orphan: false },
    { platform: 'linux', orphan: true },
    { platform: 'darwin', orphan: false },
    { platform: 'darwin', orphan: true },
  ])(
    'revalidates the existing anchor before saving witnesses ($platform, orphan=$orphan)',
    async ({ platform, orphan }) => {
      const world = linuxWorld(undefined, {
        list: () => Promise.resolve(['710', '711', '712', '999']),
      })
      let isMixedScan = false
      const anchorPid = orphan ? 711 : 710
      const foreignPid = orphan ? 712 : 711
      const recycle = (pid: number) => {
        if (!(isMixedScan && pid === foreignPid)) {
          return
        }

        world.samples.set(anchorPid, row(anchorPid, '3000'))
        world.samples.set(foreignPid, row(foreignPid, '3001'))
      }
      const original = world.read.getMockImplementation()!
      world.read.mockImplementation((file) => {
        const pid = /\/proc\/(\d+)\/stat$/.exec(file)?.[1]
        if (pid !== undefined) recycle(Number(pid))
        return original(file)
      })
      const reader =
        platform === 'linux'
          ? world.reader
          : new MacResourceTreeReader({
              run: () =>
                Promise.resolve(
                  '710 1 710 S 0:02.00 4\n711 1 710 S 0:02.00 4\n712 1 710 S 0:02.00 4\n',
                ),
              inspect: (pid) => {
                recycle(pid)
                const sample = world.samples.get(pid)
                return Promise.resolve(
                  sample === undefined
                    ? null
                    : {
                        pid,
                        pgid: sample.pgid,
                        startTime: sample.startTime,
                      },
                )
              },
            })
      const registry = new ResourceTreeRegistry(reader)
      await registry.register(ticket)
      if (orphan) world.samples.delete(710)
      isMixedScan = true
      expect(await registry.members(ticket)).toEqual([])
      isMixedScan = false
      world.samples.delete(anchorPid)
      const foreign = { pid: foreignPid, startTime: '3001' }
      expect(await registry.contains(ticket, foreign)).toBe(false)
      expect(await registry.usage(ticket)).toBeNull()
    },
  )
})

describe('Linux OS reader', () => {
  it('treats zombies as exited at the identity and membership boundaries', async () => {
    const { reader, samples } = linuxWorld()
    samples.set(711, { ...row(711, '1001'), exited: true })
    expect(await reader.identity(711)).toBeNull()
    expect(await reader.members(ticket)).toEqual([ticket.root])
    expect(await reader.contains(ticket, { pid: 711, startTime: '1001' })).toBe(false)
  })
  it('queries units only on demand, proves groups and uses delegated cgroup CPU without counting outsiders', async () => {
    const { reader, run, cg } = linuxWorld()
    expect(run).not.toHaveBeenCalled()
    expect(await reader.identity(710)).toEqual(ticket.root)
    expect(await reader.usage(ticket)).toEqual({ cpuSeconds: 4, residentBytes: 8192 })
    expect(run.mock.calls).toEqual([
      ['/usr/bin/getconf', ['CLK_TCK']],
      ['/usr/bin/getconf', ['PAGESIZE']],
    ])
    expect(await reader.usage({ ...ticket, scope: { type: 'cgroup', path: cg } })).toEqual({
      cpuSeconds: 12.5,
      residentBytes: 8192,
    })
    expect(await reader.contains(ticket, { pid: 999, startTime: '3000' })).toBe(false)
    expect(await reader.identity(-1)).toBeNull()
  })

  it('shares a numeric proc table between concurrent trees and retries failed unit probes', async () => {
    const list = vi.fn(() => Promise.resolve(['710', '711', '999']))
    const { reader, run } = linuxWorld(undefined, { list })
    run.mockRejectedValueOnce(new Error('getconf unavailable'))
    expect(await reader.identity(710)).toBeNull()
    const other: ResourceTicket = {
      ...ticket,
      id: 'other-group',
      root: { pid: 999, startTime: '3000' },
      scope: { type: 'group', pgid: 999 },
    }
    expect(await Promise.all([reader.usage(ticket), reader.usage(other)])).toEqual([
      { cpuSeconds: 4, residentBytes: 8192 },
      { cpuSeconds: 2, residentBytes: 4096 },
    ])
    expect(list).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('refuses foreign cgroup paths and failed counters', async () => {
    const { reader, files, read, cg } = linuxWorld()
    expect(
      await reader.usage({
        ...ticket,
        scope: { type: 'cgroup', path: '/sys/fs/cgroup/system.slice/user-task' },
      }),
    ).toBeNull()
    expect(
      await linuxWorld('/sys/fs/cgroup/system.slice/owned').reader.usage({
        ...ticket,
        scope: { type: 'cgroup', path: '/sys/fs/cgroup/system.slice/owned/check-1' },
      }),
    ).toBeNull()
    files.delete(`${cg}/cpu.stat`)
    expect(await reader.usage({ ...ticket, scope: { type: 'cgroup', path: cg } })).toBeNull()
    files.set(`${cg}/cpu.stat`, 'usage_usec nope\n')
    expect(await reader.usage({ ...ticket, scope: { type: 'cgroup', path: cg } })).toBeNull()
    read.mockRejectedValueOnce(new Error('denied'))
    expect(await reader.usage(ticket)).toBeNull()
    expect(await reader.identity(123)).toBeNull()
  })

  it('rejects cgroup symlink aliases and PIDs recycled between stat and membership', async () => {
    const alias = linuxWorld(undefined, {
      canonical: (file) =>
        Promise.resolve(file.endsWith('/alias') ? file.replace('/alias', '/check-1') : file),
    })
    expect(
      await alias.reader.usage({
        ...ticket,
        scope: { type: 'cgroup', path: alias.cg.replace('/check-1', '/alias') },
      }),
    ).toBeNull()
    const { reader, read, cg } = linuxWorld()
    const original = read.getMockImplementation()!
    let rootReads = 0
    read.mockImplementation((file) => {
      return file === '/proc/710/stat' && ++rootReads > 1
        ? Promise.resolve(stat(row(710, '2000')))
        : original(file)
    })
    expect(await reader.usage({ ...ticket, scope: { type: 'cgroup', path: cg } })).toEqual({
      cpuSeconds: 12.5,
      residentBytes: 4096,
    })
    expect(
      await reader.contains({ ...ticket, scope: { type: 'cgroup', path: cg } }, ticket.root),
    ).toBe(false)
  })

  it.each([999, 711])(
    'ignores outsiders and omits vanished members without losing the healthy tree (pid=%s)',
    async (vanishedPid) => {
      const { read, samples, scoped, registry } = await registeredLinuxCgroup()
      const original = read.getMockImplementation()!
      read.mockImplementation((file) => {
        if (file !== `/proc/${String(vanishedPid)}/cgroup`) return original(file)
        samples.delete(vanishedPid)
        return Promise.reject(Object.assign(new Error('vanished during scan'), { code: 'ENOENT' }))
      })
      expect(await registry.usage(scoped)).toEqual({
        cpuSeconds: 12.5,
        residentBytes: vanishedPid === 999 ? 8192 : 4096,
      })
      const survivor = vanishedPid === 999 ? { pid: 711, startTime: '1001' } : ticket.root
      expect(await registry.contains(scoped, survivor)).toBe(true)
      expect(await registry.members(scoped)).toContainEqual(survivor)
    },
  )

  it.each(['EACCES', 'EIO'])('keeps genuine cgroup read failures unknown (%s)', async (code) => {
    const { read, samples, scoped, registry } = await registeredLinuxCgroup()
    const original = read.getMockImplementation()!
    read.mockImplementation((file) =>
      file === '/proc/711/cgroup'
        ? Promise.reject(Object.assign(new Error('unreadable cgroup'), { code }))
        : original(file),
    )
    expect(await registry.usage(scoped)).toBeNull()
    expect(await registry.members(scoped)).toEqual([])
    const child = { pid: 711, startTime: '1001' }
    expect(await registry.contains(scoped, child)).toBe(false)
    read.mockImplementation(original)
    samples.delete(710)
    expect(await registry.contains(scoped, child)).toBe(true)
    expect(await registry.usage(scoped)).toEqual({ cpuSeconds: 12.5, residentBytes: 4096 })
  })

  it('rechecks a target after the table scan before authorizing an action', async () => {
    const { reader, read } = linuxWorld()
    const original = read.getMockImplementation()!
    let targetReads = 0
    read.mockImplementation((file) => {
      return file === '/proc/711/stat' && ++targetReads > 1
        ? Promise.resolve(stat(row(711, '2000')))
        : original(file)
    })
    expect(await reader.contains(ticket, { pid: 711, startTime: '1001' })).toBe(false)
  })

  it.runIf(process.platform === 'linux')(
    'accounts only our real detached child and refuses it after retirement',
    async () => {
      const child = spawn('/bin/sleep', ['30'], { detached: true, stdio: 'ignore' })
      await once(child, 'spawn')
      try {
        const reader = new LinuxResourceTreeReader()
        const identity = await reader.identity(child.pid!)
        expect(identity).not.toBeNull()
        const launch: ResourceTicket = {
          ...ticket,
          id: 'real-child',
          root: identity!,
          scope: { type: 'group', pgid: child.pid! },
          kind: 'check',
        }
        const registry = new ResourceTreeRegistry(reader)
        await registry.register(launch)
        expect(await registry.members(launch)).toEqual([identity])
        const usage = await registry.usage(launch)
        expect(usage?.residentBytes).toBeGreaterThan(0)
        expect(await registry.contains(launch, { pid: process.pid, startTime: '0' })).toBe(false)
        registry.unregister(launch)
        expect(await registry.contains(launch, identity!)).toBe(false)
      } finally {
        child.kill()
        await once(child, 'exit')
      }
    },
  )
})

describe('Darwin OS reader with the exact native identity port', () => {
  it('rechecks the native group and exact identity after accounting, refusing reuse before an action', async () => {
    let reads = 0
    const reader = new MacResourceTreeReader({
      run: () => Promise.resolve('710 1 710 S 0:01.00 4\n'),
      inspect: (pid) =>
        Promise.resolve({ pid, pgid: 710, startTime: ++reads === 1 ? '1000' : '1001' }),
    })
    expect(await reader.contains(ticket, ticket.root)).toBe(false)
  })
  it('shares one numerical ps table for concurrent groups and reproves exact identity on each action', async () => {
    const run = vi.fn(() =>
      Promise.resolve('710 1 710 S 0:02.00 4\n711 1 710 S 0:01.00 8\n999 1 999 S 0:01.00 16\n'),
    )
    const inspect = vi.fn((pid: number) =>
      Promise.resolve({ pid, pgid: pid === 999 ? 999 : 710, startTime: String(1000 + pid - 710) }),
    )
    const reader = new MacResourceTreeReader({ run, inspect })
    expect(run).not.toHaveBeenCalled()
    const other: ResourceTicket = {
      ...ticket,
      id: 'other',
      root: { pid: 999, startTime: '1289' },
      scope: { type: 'group', pgid: 999 },
    }
    expect(await Promise.all([reader.usage(ticket), reader.usage(other)])).toEqual([
      { cpuSeconds: 3, residentBytes: 12_288 },
      { cpuSeconds: 1, residentBytes: 16_384 },
    ])
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,state=,time=,rss='])
    expect(await reader.identity(710)).toEqual(ticket.root)
    expect(await reader.contains(ticket, { pid: 711, startTime: '1001' })).toBe(true)
    inspect.mockImplementation((pid) => Promise.resolve({ pid, pgid: 710, startTime: '2000' }))
    expect(await reader.contains(ticket, { pid: 711, startTime: '1001' })).toBe(false)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('refuses a changed native group, missing identity, unavailable probe and malformed data', async () => {
    const run = vi.fn(() => Promise.resolve('710 1 710 S 0:01.00 4\n'))
    const inspect = vi.fn(() => Promise.resolve({ pid: 710, pgid: 999, startTime: '1000' }))
    const reader = new MacResourceTreeReader({ run, inspect })
    expect(await reader.usage(ticket)).toBeNull()
    expect(await reader.identity(711)).toBeNull()
    expect(await reader.identity(-1)).toBeNull()
    inspect.mockRejectedValueOnce(new Error('native probe unavailable'))
    expect(await reader.identity(710)).toBeNull()
    run.mockResolvedValueOnce('ps: denied')
    expect(await reader.usage(ticket)).toBeNull()
    run.mockRejectedValueOnce(new Error('ps missing'))
    expect(await reader.members(ticket)).toEqual([])
    expect(await reader.usage({ ...ticket, scope: { type: 'job', name: 'not-posix' } })).toBeNull()
  })
})
