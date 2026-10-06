import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { constants, getPriority, setPriority, tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { build } from 'esbuild'
import { describe, expect, it, vi } from 'vitest'
import { ResourceActuators } from '../../src/core/resources/actuators'
import {
  LinuxResourceActuator,
  type LinuxCgroupFiles,
  type LinuxProcessPriorityPort,
} from '../../src/core/resources/actuators/linux'
import { ResourceTreeRegistry } from '../../src/core/resources/trees/registry'
import { LinuxResourceTreeReader } from '../../src/core/resources/trees/linux'
import { parseLinuxStat } from '../../src/core/resources/trees/posixTable'
import { runTreeProgram } from '../../src/core/resources/trees/run'
import type { ResourceTicket } from '../../src/shared/resources'
import { FakeResourceTree } from './helpers/resources/fakes'
import { removeFolder } from './helpers/temporaryFolders'

const userId = process.getuid?.() ?? 1000
const ownedRoot = `/sys/fs/cgroup/user.slice/user-${String(userId)}.slice/owned-harness`
const ticket: ResourceTicket = {
  id: 'linux',
  root: { pid: 710, startTime: '1000' },
  scope: { type: 'cgroup', path: `${ownedRoot}/check` },
  kind: 'check',
  class: 'background',
  sessionId: null,
}
function fixture(memoryHigh = 'max') {
  const tree = new FakeResourceTree()
  tree.register(ticket)
  tree.put(ticket.id, ticket.root, { cpuSeconds: 1, residentBytes: 100 })
  const values = new Map([
    ['cpu.weight', '100'],
    ['io.weight', 'default 100\n8:0 200'],
    ['memory.high', memoryHigh],
  ])
  const writes = vi.fn((file: string, row: string) => {
    if (file === 'io.weight') {
      const key = row.split(' ', 1)[0] ?? ''
      values.set(
        file,
        (values.get(file) ?? '')
          .split('\n')
          .map((old) => (old.startsWith(`${key} `) ? row : old))
          .join('\n'),
      )
    } else values.set(file, row)
    return Promise.resolve(true)
  })
  const close = vi.fn(() => Promise.resolve())
  const files: LinuxCgroupFiles = {
    userId: () => userId,
    canonical: vi.fn((file) => Promise.resolve(file)),
    owner: vi.fn(() => Promise.resolve(userId)),
    open: vi.fn((file: string) => {
      const name = path.basename(file)
      return Promise.resolve({
        read: () => Promise.resolve(values.get(name) ?? ''),
        write: (row: string) => writes(name, row),
        close,
      })
    }),
  }
  const port = new LinuxResourceActuator({
    registry: tree,
    ownedCgroupRoot: ownedRoot,
    memoryHighBytes: 4096,
    files,
  })
  return { tree, files, values, writes, close, port, actuators: new ResourceActuators(tree, port) }
}

async function ioReading(pid: number): Promise<string> {
  const text = await runTreeProgram('/usr/bin/ionice', ['-p', String(pid)])
  return text.trim()
}

describe('Linux delegated and lifetime resource controls', () => {
  it('narrows all weights and soft memory, then restores every saved row', async () => {
    const f = fixture()
    expect(await f.actuators.setLevel(ticket, 'throttle')).toEqual([
      { control: 'cpuWeight', status: 'applied' },
      { control: 'ioWeight', status: 'applied' },
      { control: 'memoryHigh', status: 'applied' },
    ])
    expect(f.values).toEqual(
      new Map([
        ['cpu.weight', '1'],
        ['io.weight', 'default 1\n8:0 1'],
        ['memory.high', '4096'],
      ]),
    )
    expect(await f.actuators.retire(ticket)).toHaveProperty('retired', true)
    expect(f.values).toEqual(
      new Map([
        ['cpu.weight', '100'],
        ['io.weight', 'default 100\n8:0 200'],
        ['memory.high', 'max'],
      ]),
    )
    expect(f.writes.mock.calls.every(([file]) => file !== 'memory.max')).toBe(true)
    expect(f.close).toHaveBeenCalledTimes(3)
  })
  it('keeps a stricter existing soft memory target', async () => {
    const f = fixture('1024')
    expect(await f.actuators.setLevel(ticket, 'throttle')).toContainEqual({
      control: 'memoryHigh',
      status: 'unchanged',
    })
    expect(f.values.get('memory.high')).toBe('1024')
    await f.actuators.retire(ticket)
  })
  it('preserves a pre-existing zero soft memory target', async () => {
    const f = fixture('0')
    expect(await f.actuators.setLevel(ticket, 'throttle')).toContainEqual({
      control: 'memoryHigh',
      status: 'unchanged',
    })
    expect(f.values.get('memory.high')).toBe('0')
    await f.actuators.retire(ticket)
  })
  it.each(['outside', 'parent', 'alias', 'owner'] as const)(
    'refuses a scope with invalid %s authority before opening controllers',
    async (failure) => {
      const f = fixture()
      let input = ticket
      switch (failure) {
        case 'outside': {
          const foreign = '/sys/fs/cgroup/system.slice/foreign'
          input = { ...ticket, scope: { type: 'cgroup', path: `${foreign}/check` } }
          vi.mocked(f.files.canonical).mockImplementation((file) =>
            Promise.resolve(file === ownedRoot ? foreign : file),
          )
          break
        }
        case 'parent': {
          input = { ...ticket, scope: { type: 'cgroup', path: ownedRoot } }
          break
        }
        case 'alias': {
          vi.mocked(f.files.canonical).mockImplementation((file) =>
            Promise.resolve(file === `${ownedRoot}/check` ? `${ownedRoot}/actual` : file),
          )
          break
        }
        case 'owner': {
          vi.mocked(f.files.owner).mockResolvedValue(-1)
          break
        }
      }
      expect(await f.actuators.setLevel(input, 'pause')).toEqual([
        { control: null, status: 'unknown' },
      ])
      expect(f.files.open).not.toHaveBeenCalled()
    },
  )
  it('reports undelegated or unreadable controllers as unknown while using the available ones', async () => {
    const f = fixture()
    const originalOpen = f.files.open
    f.files.open = (file) =>
      file.endsWith('/io.weight') ? Promise.reject(new Error('not delegated')) : originalOpen(file)
    expect(await f.actuators.setLevel(ticket, 'pause')).toEqual([
      { control: 'cpuWeight', status: 'applied' },
      { control: 'ioWeight', status: 'unknown' },
      { control: 'memoryHigh', status: 'applied' },
    ])
    await f.actuators.retire(ticket)
  })
  it('refuses an aliased controller without opening its target', async () => {
    const f = fixture()
    vi.mocked(f.files.canonical).mockImplementation((file) =>
      Promise.resolve(file.endsWith('/cpu.weight') ? '/foreign/cpu.weight' : file),
    )
    expect(await f.actuators.setLevel(ticket, 'throttle')).toContainEqual({
      control: 'cpuWeight',
      status: 'unknown',
    })
    expect(
      vi.mocked(f.files.open).mock.calls.every(([file]) => !file.endsWith('/cpu.weight')),
    ).toBe(true)
    await f.actuators.retire(ticket)
  })
  it.each(['cpu.weight', 'io.weight', 'memory.high'] as const)(
    'refuses malformed %s controls before writing them',
    async (name) => {
      const f = fixture()
      f.values.set(name, 'not a kernel value')
      const names = {
        'cpu.weight': 'cpuWeight',
        'io.weight': 'ioWeight',
        'memory.high': 'memoryHigh',
      }
      expect(await f.actuators.setLevel(ticket, 'pause')).toContainEqual({
        control: names[name],
        status: 'unknown',
      })
      expect(f.writes.mock.calls.every(([file]) => file !== name)).toBe(true)
      await f.actuators.retire(ticket)
    },
  )
  it('requires birth membership immediately before every pinned-file write', async () => {
    const f = fixture()
    const controls = await f.port.controls(ticket)
    f.tree.remove(ticket.root.pid)
    for (const control of controls) {
      expect(
        await control.write(control.name === 'ioWeight' ? 'default 1' : '1', ticket.root),
      ).toBeNull()
      await control.close()
    }
    expect(f.writes).not.toHaveBeenCalled()
  })
  it('reports short writes and readback mismatches as unknown and retains recovery', async () => {
    const f = fixture()
    f.writes.mockResolvedValueOnce(false)
    expect(await f.actuators.setLevel(ticket, 'throttle')).toContainEqual({
      control: 'cpuWeight',
      status: 'unknown',
    })
    expect(await f.actuators.retire(ticket)).toHaveProperty('retired', true)
    expect(f.values.get('cpu.weight')).toBe('100')
  })
  it('refuses a short pinned-file write at the OS boundary', async () => {
    const f = fixture()
    const controls = await f.port.controls(ticket)
    f.writes.mockResolvedValueOnce(false)
    expect(await controls[0]!.write('1', ticket.root)).toBeNull()
    for (const control of controls) await control.close()
  })
  it('uses injected nice/ionice only at pause, restoring I/O but retaining irreversible nice', async () => {
    const launch = { ...ticket, scope: { type: 'group', pgid: 710 } } as const
    const tree = new FakeResourceTree()
    tree.register(launch)
    tree.put(launch.id, launch.root, { cpuSeconds: 1, residentBytes: 100 })
    const state = { nice: 0, ioClass: 'bestEffort', ioPriority: '4' } as const
    let current: { nice: number; ioClass: 'none' | 'bestEffort' | 'idle'; ioPriority: string } = {
      ...state,
    }
    const port: LinuxProcessPriorityPort = {
      read: vi.fn(() => Promise.resolve(current)),
      nice: vi.fn((_ticket, _identity, nice) => {
        current = { ...current, nice }
        return Promise.resolve(current)
      }),
      io: vi.fn((_ticket, _identity, value) => {
        current = { ...current, ...value }
        return Promise.resolve(current)
      }),
    }
    const actuators = new ResourceActuators(
      tree,
      new LinuxResourceActuator({ registry: tree, memoryHighBytes: 4096, processes: port }),
    )
    await actuators.setLevel(launch, 'throttle')
    expect(port.nice).not.toHaveBeenCalled()
    expect(port.io).not.toHaveBeenCalled()
    expect(await actuators.setLevel(launch, 'pause')).toEqual([
      { control: 'nice', status: 'lifetimeLowered' },
      { control: 'ionice', status: 'applied' },
    ])
    expect(current).toEqual({
      nice: constants.priority.PRIORITY_LOW,
      ioClass: 'idle',
      ioPriority: '0',
    })
    expect(await actuators.retire(launch)).toHaveProperty('retired', true)
    expect(current).toEqual({ ...state, nice: constants.priority.PRIORITY_LOW })
    expect(port.nice).toHaveBeenCalledTimes(1)
  })
  it('rejects missing OS bindings and invalid soft memory targets explicitly', async () => {
    const f = fixture()
    const port = new LinuxResourceActuator({ registry: f.tree, memoryHighBytes: 1 })
    await expect(port.controls(ticket)).rejects.toThrow('scope unavailable')
    await expect(port.controls({ ...ticket, scope: { type: 'group', pgid: 710 } })).rejects.toThrow(
      'port unavailable',
    )
    for (const memoryHighBytes of [0, -1, NaN, Infinity])
      expect(() => new LinuxResourceActuator({ registry: f.tree, memoryHighBytes })).toThrow()
  })
  it('rejects unexpected process-priority fields before invoking nice or ionice', async () => {
    const f = fixture()
    const launch = { ...ticket, scope: { type: 'group', pgid: 710 } } as const
    const port: LinuxProcessPriorityPort = {
      read: vi.fn(() =>
        Promise.resolve({
          nice: 0,
          ioClass: 'bestEffort',
          ioPriority: '4',
          path: 'private-canary',
        } as const),
      ),
      nice: vi.fn(() => Promise.resolve(null)),
      io: vi.fn(() => Promise.resolve(null)),
    }
    const actuators = new ResourceActuators(
      f.tree,
      new LinuxResourceActuator({ registry: f.tree, memoryHighBytes: 4096, processes: port }),
    )
    expect(await actuators.setLevel(launch, 'pause')).toEqual([
      { control: 'nice', status: 'unknown' },
      { control: 'ionice', status: 'unknown' },
    ])
    expect(port.nice).not.toHaveBeenCalled()
    expect(port.io).not.toHaveBeenCalled()
  })
  it.runIf(process.platform === 'linux')(
    'reads back real nice/ionice on our finite child and restores I/O',
    async () => {
      const child = spawn('/bin/sleep', ['30'], {
        detached: true,
        env: { LC_ALL: 'C' },
        stdio: 'ignore',
      })
      const exited = once(child, 'exit')
      try {
        await once(child, 'spawn')
        const reader = new LinuxResourceTreeReader()
        const identity = await reader.identity(child.pid!)
        if (identity === null) throw new Error('Owned child identity unavailable')
        const launch: ResourceTicket = {
          ...ticket,
          root: identity,
          scope: { type: 'group', pgid: identity.pid },
        }
        const registry = new ResourceTreeRegistry(reader)
        await registry.register(launch)
        const originalIo = await ioReading(identity.pid)
        const synchronousProof = () => {
          const stat = parseLinuxStat(
            readFileSync(`/proc/${String(identity.pid)}/stat`, 'utf8'),
            100,
            4096,
          )
          return stat?.startTime === identity.startTime && stat.pgid === identity.pid
        }
        const read = async () => {
          if (!synchronousProof()) return null
          const text = await ioReading(identity.pid)
          let ioClass: 'idle' | 'none' | 'bestEffort' = 'bestEffort'
          if (text.startsWith('idle')) ioClass = 'idle'
          else if (text.startsWith('none')) ioClass = 'none'
          const ioPriority = /prio ([0-7])$/.exec(text)?.[1] ?? '0'
          return { nice: getPriority(identity.pid), ioClass, ioPriority } as const
        }
        const osPort: LinuxProcessPriorityPort = {
          read,
          nice: async (_ticket, _identity, nice) => {
            if (!synchronousProof()) return null
            setPriority(identity.pid, nice)
            return await read()
          },
          io: async (_ticket, _identity, value) => {
            if (!synchronousProof()) return null
            await runTreeProgram('/usr/bin/ionice', [
              '-c',
              { idle: '3', none: '0', bestEffort: '2' }[value.ioClass],
              '-n',
              value.ioPriority,
              '-p',
              String(identity.pid),
            ])
            return await read()
          },
        }
        const actuators = new ResourceActuators(
          registry,
          new LinuxResourceActuator({ registry, memoryHighBytes: 4096, processes: osPort }),
        )
        expect(await actuators.setLevel(launch, 'pause')).toEqual([
          { control: 'nice', status: 'lifetimeLowered' },
          { control: 'ionice', status: 'applied' },
        ])
        expect(getPriority(identity.pid)).toBe(constants.priority.PRIORITY_LOW)
        expect(await ioReading(identity.pid)).toBe('idle')
        expect(await actuators.retire(launch)).toHaveProperty('retired', true)
        expect(await ioReading(identity.pid)).toBe(originalIo)
        registry.unregister(launch)
      } finally {
        child.kill()
        await exited
      }
    },
  )
  it.runIf(process.platform === 'linux')(
    'reads back CPU weight and memory.high in our delegated scope and restores them',
    async () => {
      const folder = await mkdtemp(path.join(tmpdir(), 'm107-a-cgroup-'))
      const output = path.join(folder, 'probe.cjs')
      try {
        await build({
          bundle: true,
          platform: 'node',
          format: 'cjs',
          outfile: output,
          stdin: {
            resolveDir: process.cwd(),
            contents: `
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const {ResourceActuators} = require('./src/core/resources/actuators');
const {LinuxResourceActuator} = require('./src/core/resources/actuators/linux');
const {LinuxResourceTreeReader} = require('./src/core/resources/trees/linux');
const {ResourceTreeRegistry} = require('./src/core/resources/trees/registry');
(async () => {
  const own = (await fs.readFile('/proc/self/cgroup','utf8')).trim().split('::')[1];
  const parent = path.dirname('/sys/fs/cgroup' + own);
  if (!own.endsWith('/supervisor') || !path.basename(parent).startsWith('run-')) throw new Error('not our delegated service');
  await fs.writeFile(parent+'/cgroup.subtree_control','+cpu +memory');
  const scope = parent+'/governed';
  await fs.mkdir(scope);
  const child = spawn('/bin/sleep',['30'],{detached:true,env:{LC_ALL:'C'},stdio:'ignore'});
  const exited = once(child,'exit');
  try {
    await once(child,'spawn');
    await fs.writeFile(scope+'/cgroup.procs',String(child.pid));
    const reader = new LinuxResourceTreeReader({ownedCgroupRoot:parent});
    const root = await reader.identity(child.pid);
    const ticket = {id:'native-cgroup',root,scope:{type:'cgroup',path:scope},kind:'check',class:'background',sessionId:null};
    const registry = new ResourceTreeRegistry(reader);
    await registry.register(ticket);
    const before = {cpu:(await fs.readFile(scope+'/cpu.weight','utf8')).trim(),memory:(await fs.readFile(scope+'/memory.high','utf8')).trim()};
    const actuator = new ResourceActuators(registry,new LinuxResourceActuator({registry,ownedCgroupRoot:parent,memoryHighBytes:67108864}));
    const applied = await actuator.setLevel(ticket,'throttle');
    const during = {cpu:(await fs.readFile(scope+'/cpu.weight','utf8')).trim(),memory:(await fs.readFile(scope+'/memory.high','utf8')).trim()};
    const retirement = await actuator.retire(ticket);
    const after = {cpu:(await fs.readFile(scope+'/cpu.weight','utf8')).trim(),memory:(await fs.readFile(scope+'/memory.high','utf8')).trim()};
    registry.unregister(ticket);
    process.stdout.write(JSON.stringify({before,during,after,applied,retired:retirement.retired}));
  } finally {child.kill();await exited;await fs.rmdir(scope)}
})().catch(() => {process.exitCode=1});`,
          },
        })
        const stdout = await runTreeProgram(
          '/usr/bin/systemd-run',
          [
            '--user',
            '--quiet',
            '--wait',
            '--pipe',
            '--collect',
            '--property=Delegate=yes',
            '--property=DelegateSubgroup=supervisor',
            process.execPath,
            output,
          ],
          { XDG_RUNTIME_DIR: `/run/user/${String(process.getuid?.())}`, LC_ALL: 'C' },
        )
        const result: unknown = JSON.parse(stdout)
        expect(result).toMatchObject({
          before: { cpu: '100', memory: 'max' },
          during: { cpu: '1', memory: '67108864' },
          after: { cpu: '100', memory: 'max' },
          retired: true,
          applied: [
            { control: 'cpuWeight', status: 'applied' },
            { control: 'ioWeight', status: 'unknown' },
            { control: 'memoryHigh', status: 'applied' },
          ],
        })
      } finally {
        await removeFolder(folder)
      }
    },
  )
})
