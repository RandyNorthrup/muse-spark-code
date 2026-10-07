import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import * as fsPromises from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createWindowIdentity } from '../../src/host/team/windowIdentity'
import { createLoadGuard } from '../../src/host/team/loadGuard'
import {
  createWindowHints,
  windowHintsDirectory,
  type WindowHint,
} from '../../src/host/team/windowHints'
import * as processTree from '../../src/host/processTree'
import { runProgram, windowsPowerShell } from '../../src/host/processTree'
import { powerShellQuoted } from '../../src/core/shellQuote'
import { WINDOWS_POWERSHELL_COMMAND_ARGS } from '../../src/shared/constants'
import { createOrphanRecovery, type OrphanObservation } from '../../src/host/team/orphanRecovery'

const directories: string[] = []
const nativeDirectories: string[] = []
const permissionState = vi.hoisted(() => ({ ignoresChmod: false, foreignUid: false }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fsPromises>()
  const chmod: typeof actual.chmod = async (target, mode) => {
    if (!permissionState.ignoresChmod) await actual.chmod(target, mode)
  }
  const open: typeof actual.open = async (target, flags, mode) => {
    const file = await actual.open(target, flags, mode)
    if (permissionState.foreignUid) {
      vi.spyOn(file, 'stat').mockImplementation(async () => {
        const information = await actual.stat(target)
        Object.defineProperty(information, 'uid', { value: information.uid + 1 })
        return information
      })
    }
    return file
  }
  return { ...actual, chmod, open }
})
afterEach(async () => {
  permissionState.ignoresChmod = false
  permissionState.foreignUid = false
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})
afterAll(async () => {
  for (const directory of nativeDirectories) await rm(directory, { recursive: true, force: true })
})

async function hintFixture(isNative = false) {
  if (!isNative && process.platform === 'win32') {
    // Advisory state cases use real files without spawning/compiling PowerShell
    // on every read. The separate native cases exercise the actual ACL/handle path.
    vi.spyOn(processTree, 'runProgram').mockImplementation(async (_file, args) => {
      const script = args.at(-1) ?? ''
      const read = /\[MuseTeamHintReader\]::Read\('((?:''|[^'])*)', (\d+)\)/.exec(script)
      if (read !== null) {
        const content = await readFile(read[1]!.replaceAll("''", "'"), 'utf8')
        return Buffer.byteLength(content) > Number(read[2]) ? 'TEAM_HINT_TOO_LARGE' : content
      }
      if (script.includes('DirectorySecurity')) return 'secured'
      if (script.includes('$acl.SetOwner($sid)')) return ''
      throw new Error('Unexpected Windows hint helper')
    })
  }
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'm96-k-hints-')))
  // Native ACL fixtures are shared across their security cases. Keep them
  // through the suite; ordinary state fixtures remain isolated per test.
  const retained = isNative ? nativeDirectories : directories
  retained.push(directory)
  let now = 100_000
  const disabled = vi.fn()
  const question = vi.fn((): Promise<'continue' | 'wait' | 'openWindow'> =>
    Promise.resolve('continue'),
  )
  const make = (overrides: Partial<Parameters<typeof createWindowHints>[0]> = {}) => {
    const id = createWindowIdentity(now).instanceId
    const hints = createWindowHints({
      directory,
      instanceId: id,
      platform: process.platform,
      freshMs: 60_000,
      writeMs: 10_000,
      maxHintBytes: 8192,
      now: () => now,
      disabled,
      question,
      overlap: (mine, theirs) => mine.filter((p) => theirs.includes(p)),
      ...overrides,
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

async function publishedHintFixture() {
  const f = await hintFixture(true)
  const writer = f.make()
  const reader = f.make()
  await writer.hints.publish(hintState)
  return { ...f, writer, reader, file: path.join(f.directory, `${writer.id}.json`) }
}

// The native Windows hint suites start Windows PowerShell and compile the C#
// hint reader on every read (windowHints.ts), two or three times per test; a
// cold hosted runner needs longer than the unit default. PLAN.md §8
// (2026-10-07) tracks this; the follow-up precompiles the reader once.
const NATIVE_WINDOWS_HINT_TIMEOUT_MS = 30_000

describe('M96 K advisory hints', () => {
  it('accepts a native short temp spelling but refuses links and different resolved folders', async () => {
    const f = await hintFixture()
    const actual = await vi.importActual<typeof fsPromises>('node:fs/promises')
    const short = path.join(f.directory, 'RUNNER~1')
    await mkdir(short)
    const long = path.join(f.directory, 'runneradmin')
    const expand = (given: string) => given.replace(short, () => long)
    vi.spyOn(fsPromises, 'realpath').mockImplementation(async (given) =>
      expand(await actual.realpath(given)),
    )
    const native = realpathSync.native
    const nativePath = vi
      .spyOn(realpathSync, 'native')
      .mockImplementation((given) => expand(native(given)))
    const policy = { directory: short, secureWindowsDirectory: () => Promise.resolve() }
    const { hints } = f.make(policy)
    expect(await hints.advisory()).toEqual({
      windows: 0,
      workers: 0,
      processWorkers: 0,
      heavyCommands: 0,
    })
    expect(f.disabled).not.toHaveBeenCalled()
    await hints.dispose()
    const alias = path.join(f.directory, 'junction')
    const linkedFolder = path.join(f.directory, 'other')
    await mkdir(linkedFolder)
    await symlink(linkedFolder, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const linked = f.make({ ...policy, directory: alias })
    await linked.hints.advisory()
    expect(f.disabled).toHaveBeenCalledTimes(1)
    await linked.hints.dispose()
    nativePath.mockReturnValue(f.directory)
    const different = f.make(policy)
    await different.hints.advisory()
    expect(f.disabled).toHaveBeenCalledTimes(2)
    await different.hints.dispose()
  })

  it('secures, publishes and reads Windows hints without broad module discovery', async () => {
    const f = await hintFixture()
    vi.stubEnv('SystemRoot', String.raw`C:\Windows`)
    const helper = vi.spyOn(processTree, 'runProgram').mockImplementation(async (_file, args) => {
      const script = args.at(-1) ?? ''
      if (/(?:^|[;=]\s*)\b(?:New-Object|Add-Type)\b/.test(script))
        throw new Error('hosted module discovery exceeded the unchanged deadline')
      const read = /\[MuseTeamHintReader\]::Read\('((?:''|[^'])*)', (\d+)\)/.exec(script)
      if (read !== null) return await readFile(read[1]!.replaceAll("''", "'"), 'utf8')
      return script.includes('DirectorySecurity') ? 'secured' : ''
    })
    const { hints } = f.make({ platform: 'win32' })
    await hints.publish(hintState)
    expect(f.disabled).not.toHaveBeenCalled()
    expect(await hints.advisory()).toMatchObject({ windows: 1, workers: hintState.workers })
    expect(helper).toHaveBeenCalled()
    await hints.dispose()
  })

  describe('native owner-only folder', { timeout: NATIVE_WINDOWS_HINT_TIMEOUT_MS }, () => {
    let f: Awaited<ReturnType<typeof hintFixture>>
    let hints: ReturnType<typeof createWindowHints> | undefined
    let disabled: ReturnType<typeof vi.fn<() => void>>
    beforeAll(async () => {
      f = await hintFixture(true)
      disabled = vi.fn()
      hints = createWindowHints({
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
      await hints.advisory()
    })
    afterAll(async () => {
      await hints?.dispose()
    })
    it('uses state home and secures a real native owner-only hints folder', async () => {
      const stateHome = windowHintsDirectory(
        process.platform,
        { LOCALAPPDATA: f.directory, XDG_STATE_HOME: f.directory },
        f.directory,
      )
      expect(stateHome.endsWith(path.join('muse-spark-code', 'hints'))).toBe(true)
      expect(() =>
        windowHintsDirectory('linux', { XDG_STATE_HOME: 'relative' }, f.directory),
      ).toThrow('STATE_HOME_UNAVAILABLE')
      expect(disabled).not.toHaveBeenCalled()
      if (process.platform === 'win32') {
        const ps = windowsPowerShell(process.env['SystemRoot'] ?? '', {})
        const script = `$d = New-Object IO.DirectoryInfo(${powerShellQuoted(f.directory)}); $acl = $d.GetAccessControl(); $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User; $r = @($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])); $acl.AreAccessRulesProtected -and $r.Count -eq 1 -and $r[0].IdentityReference.Value -eq $sid.Value`
        const result = await runProgram(
          ps.file,
          [...WINDOWS_POWERSHELL_COMMAND_ARGS, script],
          ps.env,
        )
        expect(result.trim()).toBe('True')
      } else {
        const information = await stat(f.directory)
        expect(information.mode & 0o777).toBe(0o700)
      }
    })
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

  it('Windows consumes the handle-verified hint rather than an older opened inode after replacement', async () => {
    const f = await hintFixture()
    const foreign = createWindowIdentity(100_000).instanceId
    const target = path.join(f.directory, `${foreign}.json`)
    const forged = { ...hintState, instanceId: foreign, at: 100_000, workers: 40 }
    const safe = { ...forged, trees: [], exclusiveServers: [], workers: 7 }
    await writeFile(target, JSON.stringify(forged))
    vi.stubEnv('SystemRoot', String.raw`C:\Windows`)
    const helper = vi.spyOn(processTree, 'runProgram').mockImplementation(async (_file, args) => {
      const replacement = path.join(f.directory, 'replacement.tmp')
      await writeFile(replacement, JSON.stringify(safe))
      await rename(replacement, target)
      // Model the opened-handle helper's consumed bytes. The old path-only
      // verifier says verified while Node retains the unsafe original inode.
      return args.at(-1)?.includes('MuseTeamHintReader') === true
        ? JSON.stringify(safe)
        : 'verified'
    })
    const reader = createWindowHints({
      directory: f.directory,
      instanceId: createWindowIdentity(100_000).instanceId,
      platform: 'win32',
      freshMs: 60_000,
      writeMs: 10_000,
      maxHintBytes: 8192,
      now: () => 100_000,
      secureWindowsDirectory: () => Promise.resolve(),
      disabled: f.disabled,
      question: f.question,
      overlap: (mine, theirs) => mine.filter((value) => theirs.includes(value)),
    })
    expect(await reader.check(intent)).toBe('continue')
    expect(f.question).not.toHaveBeenCalled()
    expect(f.disabled).not.toHaveBeenCalled()
    expect(await reader.advisory()).toMatchObject({ workers: 7 })
    expect(helper).toHaveBeenCalledTimes(2)
    await reader.dispose()
    vi.unstubAllEnvs()
  })

  if (process.platform === 'win32') {
    describe('native Windows hint permissions', { timeout: NATIVE_WINDOWS_HINT_TIMEOUT_MS }, () => {
      let f: Awaited<ReturnType<typeof publishedHintFixture>> | undefined
      beforeAll(async () => {
        f = await publishedHintFixture()
      })
      afterAll(async () => {
        if (f === undefined) return
        await f.writer.hints.dispose()
        await f.reader.hints.dispose()
      })
      it('native Windows holds the consumed hint against replacement through ACL verification', async () => {
        if (f === undefined) throw new Error('native hints not prepared')
        const original = processTree.runProgram
        const helper = vi
          .spyOn(processTree, 'runProgram')
          .mockImplementation(async (file, args, env) => {
            const instrumented = args.map((argument) =>
              argument.includes('MuseTeamHintReader')
                ? argument.replace(
                    'FileInfo info;',
                    'try { File.Move(target, target + ".attack"); throw new Exception("replacement was allowed"); } catch (IOException) {} FileInfo info;',
                  )
                : argument,
            )
            return await original(file, instrumented, env)
          })
        expect(await f.reader.hints.advisory()).toMatchObject({ workers: hintState.workers })
        expect(f.disabled).not.toHaveBeenCalled()
        expect(helper).toHaveBeenCalled()
        expect(await readFile(f.file, 'utf8')).toContain(f.writer.id)
      })

      it('native Windows rejects an opened hint with another principal granted write access', async () => {
        if (f === undefined) throw new Error('native hints not prepared')
        const powershell = windowsPowerShell(process.env['SystemRoot'] ?? '', {})
        const script = `$f = New-Object IO.FileInfo(${powerShellQuoted(f.file)}); $acl = $f.GetAccessControl(); $everyone = New-Object Security.Principal.SecurityIdentifier('S-1-1-0'); $rule = New-Object Security.AccessControl.FileSystemAccessRule($everyone,'Modify','Allow'); $acl.AddAccessRule($rule); $f.SetAccessControl($acl)`
        await runProgram(
          powershell.file,
          [...WINDOWS_POWERSHELL_COMMAND_ARGS, script],
          powershell.env,
        )
        expect(await f.reader.hints.check(intent)).toBe('continue')
        expect(f.question).not.toHaveBeenCalled()
        expect(f.disabled).toHaveBeenCalledTimes(1)
      })
    })
  }

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

  if (process.platform === 'win32') {
    return
  }

  it('rejects a two-link other-uid hint despite a verified owner-only directory', async () => {
    const f = await publishedHintFixture()
    const { writer, reader, file } = f
    const retained = path.join(f.directory, 'retained-link')
    await link(file, retained)
    await chmod(file, 0o666)
    permissionState.foreignUid = true
    expect(await reader.hints.check(intent)).toBe('continue')
    expect(f.question).not.toHaveBeenCalled()
    expect(f.disabled).toHaveBeenCalledTimes(1)
    permissionState.foreignUid = false
    await writer.hints.publish({ ...hintState, workers: 1 })
    const information = await stat(file)
    expect(information.nlink).toBe(1)
    expect(JSON.parse(await readFile(retained, 'utf8'))).toMatchObject({ workers: 4 })
    await writer.hints.dispose()
    await reader.hints.dispose()
  })

  for (const unsafe of ['owner', 'write', 'links', 'symlink', 'directory', 'fifo'] as const) {
    it(`disables hints for an unsafe opened file: ${unsafe}`, async () => {
      const f = await publishedHintFixture()
      const { reader, file } = f
      switch (unsafe) {
        case 'owner': {
          permissionState.foreignUid = true
          break
        }
        case 'write': {
          await chmod(file, 0o666)
          break
        }
        case 'links': {
          await link(file, path.join(f.directory, 'retained'))
          break
        }
        case 'symlink': {
          const text = await readFile(file)
          await rm(file)
          const target = path.join(f.directory, 'target')
          await writeFile(target, text, { mode: 0o600 })
          await symlink(target, file)
          break
        }
        case 'directory': {
          await rm(file)
          await mkdir(file)
          break
        }
        case 'fifo': {
          await rm(file)
          await runProgram('/usr/bin/mkfifo', [file], {})
          await chmod(file, 0o600)
          // A FIFO has one link; only the regular-file guard rejects it.
          const information = await stat(file)
          expect(information.nlink).toBe(1)
          break
        }
      }
      expect(await reader.hints.check(intent)).toBe('continue')
      expect(f.question).not.toHaveBeenCalled()
      expect(f.disabled).toHaveBeenCalledTimes(1)
      permissionState.foreignUid = false
    })
  }

  it('refuses forged hints and publication when successful chmod leaves permissive bits', async () => {
    const f = await hintFixture()
    const other = f.make()
    const mine = f.make()
    const forged = path.join(f.directory, `${other.id}.json`)
    await writeFile(forged, JSON.stringify({ ...hintState, instanceId: other.id, at: 100_000 }))
    await chmod(f.directory, 0o777)
    permissionState.ignoresChmod = true
    expect(await mine.hints.check({ ...intent, exclusiveServers: ['browser'] })).toBe('continue')
    expect(f.question).not.toHaveBeenCalled()
    expect(f.disabled).toHaveBeenCalledTimes(1)
    const publisher = f.make()
    await publisher.hints.publish(hintState)
    await expect(readFile(path.join(f.directory, `${publisher.id}.json`))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(f.disabled).toHaveBeenCalledTimes(2)
    const information = await stat(f.directory)
    expect(information.mode & 0o777).toBe(0o777)
    await mine.hints.dispose()
    await publisher.hints.dispose()
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
      monotonicNow: () => now,
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

  it('keeps sustained CPU protection through a backward wall-clock adjustment', () => {
    let wall = 86_400_000
    let elapsed = 0
    let user = 0
    const guard = createLoadGuard({
      sampleMs: 5000,
      cpuHigh: 0.85,
      windowMs: 30_000,
      freeMemoryMin: 100,
      now: () => wall,
      monotonicNow: () => elapsed,
      readCpuTimes: () => [{ user, idle: 0, nice: 0, sys: 0, irq: 0 }],
      readFreeMemory: () => 100,
      changed: vi.fn(),
    })
    guard.sample()
    elapsed = 5000
    user += 100
    expect(guard.sample().isHostBusy).toBe(false)
    wall = 0
    for (elapsed = 10_000; elapsed <= 30_000; elapsed += 5000) {
      user += 100
      const sample = guard.sample()
      expect(sample.cpuUsage).toBe(1)
      expect(sample.isHostBusy).toBe(elapsed === 30_000)
    }
    elapsed = 60_000
    user += 100
    expect(guard.sample().isHostBusy).toBe(true)
  })
})

describe('M96 K orphan decisions', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const observation: OrphanObservation = {
    pid: 42,
    group: '42',
    startTime: 'boot:123',
    command: 'fixture-worker',
    executable: '/fixture/worker',
    uid: 501,
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
      executable: '/fixture/worker',
      uid: 501,
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
    const signal = vi.fn(() => Promise.resolve(true))
    const observe = vi.fn(() => Promise.resolve(observation))
    const recovery = createOrphanRecovery({ scan, signal, observe })
    const found = await recovery.find([record])
    expect(found).toHaveLength(2)
    expect(found[1]).toMatchObject({ pid: 43, match: 'uncertain' })
    expect(await recovery.stop(found[1]!, true)).toBe('changed')
    expect(await recovery.stop(found[0]!, false)).toBe('kept')
    expect(signal).not.toHaveBeenCalled()
    expect(observe).not.toHaveBeenCalled()
    expect(await recovery.stop(found[0]!, true)).toBe('stopped')
    expect(observe.mock.invocationCallOrder[0]).toBeLessThan(signal.mock.invocationCallOrder[0]!)
    expect(signal).toHaveBeenCalledWith(
      expect.objectContaining({
        pid: observation.pid,
        executable: observation.executable,
        uid: observation.uid,
      }),
      'SIGTERM',
      process.platform === 'darwin',
    )
  })

  for (const scenario of [
    {
      name: 'a marker-only recovery row cannot stop without a recorded confirmation',
      scanned: observation,
      observed: observation,
      hasConfirmation: false,
    },
    {
      name: 'marker-only recovery cannot authorize an unrelated recorded PID or executable',
      scanned: { ...observation, executable: '/foreign/program' },
      observed: observation,
      hasConfirmation: true,
    },
    {
      name: 'refuses changed PID or marker after second check, and labels PID-only match uncertain',
      scanned: { ...observation, launchId: undefined },
      observed: { ...observation, startTime: 'boot:999' },
      hasConfirmation: true,
    },
  ]) {
    it(scenario.name, async () => {
      const signal = vi.fn(() => Promise.resolve(true))
      const recovery = createOrphanRecovery({
        scan: () => Promise.resolve([scenario.scanned]),
        observe: () => Promise.resolve(scenario.observed),
        signal,
      })
      const found = await recovery.find([
        scenario.hasConfirmation
          ? record
          : { id, command: 'worker', cwd: '/scratch', taskId: 'task' },
      ])
      expect(found[0]).toMatchObject({ match: 'uncertain' })
      expect(await recovery.stop(found[0]!, true)).toBe('changed')
      expect(signal).not.toHaveBeenCalled()
    })
  }
})
