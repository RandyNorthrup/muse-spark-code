import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWindowIdentity } from '../../src/host/team/windowIdentity'
import { createLoadGuard } from '../../src/host/team/loadGuard'
import {
  createWindowHints,
  windowHintsDirectory,
  type WindowHint,
} from '../../src/host/team/windowHints'
import { runProgram, windowsPowerShell } from '../../src/host/processTree'
import { powerShellQuoted } from '../../src/core/shellQuote'
import { WINDOWS_POWERSHELL_COMMAND_ARGS } from '../../src/shared/constants'
import { createOrphanRecovery, type OrphanObservation } from '../../src/host/team/orphanRecovery'

const directories: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

async function hintFixture() {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'm96-k-hints-')))
  directories.push(directory)
  let now = 100_000
  const disabled = vi.fn()
  const question = vi.fn((): Promise<'continue' | 'wait' | 'openWindow'> =>
    Promise.resolve('continue'),
  )
  const make = () => {
    const id = createWindowIdentity(now).instanceId
    const hints = createWindowHints({
      directory,
      instanceId: id,
      platform: 'linux',
      freshMs: 60_000,
      writeMs: 10_000,
      maxHintBytes: 8192,
      now: () => now,
      disabled,
      question,
      overlap: (mine, theirs) => mine.filter((p) => theirs.includes(p)),
    })
    return { id, hints }
  }
  return {
    directory,
    make,
    disabled,
    question,
    setNow: (value: number) => {
      now = value
    },
  }
}

const hintState: Omit<WindowHint, 'at' | 'instanceId'> = {
  workspaceName: 'Fixture',
  trees: [
    {
      commonDirectory: '/repo/.git',
      branch: 'feature/a',
      worktree: '/repo',
      paths: ['src/a.ts', 'src/b.ts'],
    },
  ],
  exclusiveServers: ['browser'],
  workers: 4,
  processWorkers: 2,
  heavyCommands: 1,
}
const intent = { repository: '/repo/.git', paths: ['src/a.ts'], exclusiveServers: [] }

describe('M96 K advisory hints', () => {
  it('uses state home and secures a real native owner-only hints folder', async () => {
    const f = await hintFixture()
    const stateHome = windowHintsDirectory(
      process.platform,
      { LOCALAPPDATA: f.directory, XDG_STATE_HOME: f.directory },
      f.directory,
    )
    expect(stateHome.endsWith(path.join('muse-spark-code', 'hints'))).toBe(true)
    expect(() =>
      windowHintsDirectory('linux', { XDG_STATE_HOME: 'relative' }, f.directory),
    ).toThrow('STATE_HOME_UNAVAILABLE')
    const disabled = vi.fn()
    const hints = createWindowHints({
      directory: f.directory,
      instanceId: createWindowIdentity(Date.now()).instanceId,
      platform: process.platform,
      freshMs: 60_000,
      writeMs: 10_000,
      maxHintBytes: 8192,
      now: Date.now,
      disabled,
      question: () => Promise.resolve('continue'),
      overlap: () => [],
    })
    await hints.publish(hintState)
    expect(disabled).not.toHaveBeenCalled()
    if (process.platform === 'win32') {
      const ps = windowsPowerShell(process.env['SystemRoot'] ?? '', {})
      const script = `$d = New-Object IO.DirectoryInfo(${powerShellQuoted(f.directory)}); $acl = $d.GetAccessControl(); $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User; $r = @($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])); $acl.AreAccessRulesProtected -and $r.Count -eq 1 -and $r[0].IdentityReference.Value -eq $sid.Value`
      const result = await runProgram(ps.file, [...WINDOWS_POWERSHELL_COMMAND_ARGS, script], ps.env)
      expect(result.trim()).toBe('True')
    } else {
      const information = await stat(f.directory)
      expect(information.mode & 0o777).toBe(0o700)
    }
    await hints.dispose()
  })
  it('publishes only the strict projection, sums all windows and removes its own hint', async () => {
    const f = await hintFixture()
    const a = f.make()
    const b = f.make()
    await a.hints.publish(hintState)
    await b.hints.publish({ ...hintState, workers: 5 })
    const file = path.join(f.directory, `${a.id}.json`)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      ...hintState,
      instanceId: a.id,
      at: 100_000,
    })
    expect(await b.hints.advisory()).toEqual({
      windows: 2,
      workers: 9,
      processWorkers: 4,
      heavyCommands: 2,
    })
    await a.hints.dispose()
    expect(await b.hints.advisory()).toEqual({
      windows: 1,
      workers: 5,
      processWorkers: 2,
      heavyCommands: 1,
    })
    await b.hints.dispose()
  })

  it('asks once across rewrites and other tasks; new path and drop ask again', async () => {
    const f = await hintFixture()
    const a = f.make()
    const b = f.make()
    await a.hints.publish(hintState)
    for (let rewrite = 0; rewrite < 10; rewrite++) {
      await a.hints.publish(hintState)
      expect(await b.hints.check(intent)).toBe('continue')
    }
    expect(f.question).toHaveBeenCalledTimes(1)
    await b.hints.check({ ...intent, paths: ['unrelated.ts'] })
    await b.hints.check(intent)
    expect(f.question).toHaveBeenCalledTimes(1)
    await b.hints.check({ ...intent, paths: ['src/b.ts'] })
    expect(f.question).toHaveBeenCalledTimes(2)
    await a.hints.publish({ ...hintState, trees: [] })
    await b.hints.check(intent)
    await a.hints.publish(hintState)
    await b.hints.check(intent)
    expect(f.question).toHaveBeenCalledTimes(3)
    await a.hints.dispose()
    await b.hints.dispose()
  })

  it('Wait lasts only while fresh collision exists; stale, absent and malformed hints never lock', async () => {
    const f = await hintFixture()
    f.question.mockImplementation(() => Promise.resolve('wait'))
    const a = f.make()
    const b = f.make()
    await a.hints.publish(hintState)
    expect(await b.hints.check({ ...intent, paths: [], exclusiveServers: ['browser'] })).toBe(
      'wait',
    )
    f.setNow(160_000)
    expect(await b.hints.check({ ...intent, paths: [], exclusiveServers: ['browser'] })).toBe(
      'continue',
    )
    await writeFile(path.join(f.directory, `${a.id}.json`), '{broken')
    expect(await b.hints.check(intent)).toBe('continue')
    expect(f.disabled).not.toHaveBeenCalled()
    await a.hints.dispose()
    expect(await b.hints.check(intent)).toBe('continue')
    await b.hints.dispose()
  })

  it('disables hints once when folder cannot be used', async () => {
    const f = await hintFixture()
    await writeFile(path.join(f.directory, 'not-folder'), 'occupied')
    const disabled = vi.fn()
    const hints = createWindowHints({
      directory: path.join(f.directory, 'not-folder'),
      instanceId: createWindowIdentity(1).instanceId,
      platform: 'linux',
      freshMs: 60_000,
      writeMs: 10_000,
      maxHintBytes: 8192,
      now: () => 100_000,
      disabled,
      question: () => Promise.resolve('continue'),
      overlap: () => [],
    })
    await hints.publish(hintState)
    expect(await hints.check(intent)).toBe('continue')
    expect(disabled).toHaveBeenCalledTimes(1)
    await hints.dispose()
    expect(disabled).toHaveBeenCalledTimes(1)
  })
})

describe('M96 K load sampler', () => {
  it('uses CPU time deltas, trips only after sustained pressure, then recovers', () => {
    let now = 0
    let user = 0
    let idle = 0
    const guard = createLoadGuard({
      sampleMs: 5000,
      cpuHigh: 0.85,
      windowMs: 30_000,
      freeMemoryMin: 2 * 1024 ** 3,
      now: () => now,
      readCpuTimes: () => [{ user, idle, nice: 0, sys: 0, irq: 0 }],
      readFreeMemory: () => 4 * 1024 ** 3,
      changed: vi.fn(),
    })
    expect(guard.sample().isHostBusy).toBe(false)
    for (now = 5000; now <= 25_000; now += 5000) {
      user += 95
      idle += 5
      expect(guard.sample().isHostBusy).toBe(false)
    }
    user += 95
    idle += 5
    expect(guard.sample()).toMatchObject({ cpuUsage: 0.95, isHostBusy: true })
    now += 5000
    idle += 100
    expect(guard.sample().isHostBusy).toBe(false)
  })

  it('holds new local work immediately on low memory, and recovers at threshold', () => {
    let available = 99
    const guard = createLoadGuard({
      sampleMs: 5000,
      cpuHigh: 0.85,
      windowMs: 30_000,
      freeMemoryMin: 100,
      now: () => 0,
      readCpuTimes: () => [],
      readFreeMemory: () => available,
      changed: vi.fn(),
    })
    expect(guard.sample().isHostBusy).toBe(true)
    available = 100
    expect(guard.sample().isHostBusy).toBe(false)
    expect(guard.isHostBusy()).toBe(false)
  })
})

describe('M96 K orphan decisions', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const observation: OrphanObservation = {
    pid: 42,
    group: '42',
    startTime: 'boot:123',
    command: 'fixture-worker',
    launchId: id,
  }
  const record = {
    id,
    command: 'worker',
    cwd: '/scratch',
    taskId: 'task',
    confirmation: {
      pid: 42,
      group: '42',
      startTime: 'boot:123',
      container: 'processGroup' as const,
    },
    end: { childExited: true, descendants: 'uncertain' as const },
  }

  it('finds marked descendants even when direct child ended; does not stop without click', async () => {
    const scan = vi.fn(() =>
      Promise.resolve([
        observation,
        { ...observation, pid: 43, group: '43', startTime: 'boot:124' },
      ]),
    )
    const signalGroup = vi.fn(() => Promise.resolve())
    const observe = vi.fn(() => Promise.resolve(observation))
    const recovery = createOrphanRecovery({ scan, signalGroup, observe })
    const found = await recovery.find([record])
    expect(found).toHaveLength(2)
    expect(found[1]).toMatchObject({ pid: 43, match: 'matched' })
    expect(await recovery.stop(found[0]!, false)).toBe('kept')
    expect(signalGroup).not.toHaveBeenCalled()
    expect(observe).not.toHaveBeenCalled()
    expect(await recovery.stop(found[0]!, true)).toBe('stopped')
    expect(observe.mock.invocationCallOrder[0]).toBeLessThan(
      signalGroup.mock.invocationCallOrder[0]!,
    )
    expect(signalGroup).toHaveBeenCalledWith('42')
  })

  it('refuses changed PID or marker after second check, and labels PID-only match uncertain', async () => {
    const signalGroup = vi.fn(() => Promise.resolve())
    const observe = vi.fn(() => Promise.resolve({ ...observation, startTime: 'boot:999' }))
    const recovery = createOrphanRecovery({
      scan: () => Promise.resolve([{ ...observation, launchId: undefined }]),
      observe,
      signalGroup,
    })
    const found = await recovery.find([record])
    expect(found[0]).toMatchObject({ match: 'uncertain' })
    expect(await recovery.stop(found[0]!, true)).toBe('changed')
    expect(signalGroup).not.toHaveBeenCalled()
  })
})
