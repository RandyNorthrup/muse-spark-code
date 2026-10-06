import { copyFile, mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises'
import { ChildProcess, type SpawnOptions } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import {
  NativeScheduleBackground,
  type BackgroundProcessResult,
  type NativeBackgroundDeps,
  type BackgroundFilePort,
} from '../../src/runtime/schedules/nativeBackground'
import {
  backgroundProcessRunner,
  nodeBackgroundFiles,
  trustedBackgroundPath,
  verifyScheduleWake,
  waitForScheduleWake,
  beginScheduleWake,
} from '../../src/runtime/schedules/nodeBackgroundIo'
import { SCHEDULE_WAKE_WAIT_MS, UI_TEXT } from '../../src/shared/constants'
import {
  backgroundDefinitionPaths,
  backgroundRecordPath,
  backgroundRegistrationId,
  backgroundWakeRecordSchema,
} from '../../src/runtime/schedules/registration'

function result(exitCode = 0, stdout = '', stderr = ''): BackgroundProcessResult {
  return { exitCode, stdout, stderr }
}
function fileInfo(uid = 0, mode = 0o755, isDirectory = true, isSymbolicLink = false) {
  return {
    uid,
    mode,
    isFile: () => !isDirectory && !isSymbolicLink,
    isDirectory: () => isDirectory,
    isSymbolicLink: () => isSymbolicLink,
  }
}
function ordinaryWindowsIdentity(script: string): string {
  // The elevated rig uses fake identity metadata; no token or ACL is changed.
  return script
    .replace(
      '[Security.Principal.WindowsIdentity]::GetCurrent()',
      '[pscustomobject]@{ User = [pscustomobject]@{ Value = $user }; Groups = @(); IsSystem = $false }',
    )
    .replace(
      '([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
      '$false',
    )
}
async function windowsPolicyFixture(fixture: string): Promise<readonly boolean[]> {
  const run = backgroundProcessRunner({ SystemRoot: process.env['SystemRoot'] })
  const output = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(fixture, 'utf16le').toString('base64'),
  ])
  expect(output.exitCode).toBe(0)
  return output.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => z.boolean().parse(JSON.parse(line)))
}
function verifyRegisteredWake(deps: NativeBackgroundDeps) {
  return verifyScheduleWake(
    deps.executable,
    deps.agentFile,
    {
      platform: deps.platform,
      uid: deps.uid,
      effectiveUid: deps.effectiveUid ?? deps.uid,
      homeDir: deps.homeDir,
      dataDir: deps.dataDir,
      trustedPath: deps.files.trustedPath,
      read: deps.files.read,
      hash: deps.files.hash,
    },
    backgroundRegistrationId(deps.homeDir),
  )
}
async function expectLaunchdMaintenanceRefusal(
  entry: NativeScheduleBackground,
  atMs: number,
): Promise<void> {
  await expect(entry.register(atMs, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow(
    UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable,
  )
  await expect(entry.remove()).rejects.toThrow(
    UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable,
  )
}
function setup(platform: NodeJS.Platform, overrides: Partial<NativeBackgroundDeps> = {}) {
  const files = new Map<string, string>()
  const state = {
    registered: false,
    createFails: false,
    reportsFailureAfterCreate: false,
    silentCreate: false,
    deleteFails: false,
    queryFails: false,
    staysRegistered: false,
    invalidQuery: false,
    invalidOwner: false,
    ownerFails: false,
    elevated: false,
    service: false,
    sid: 'S-1-5-21-1-2-3-1000',
    active: false,
    refusesStop: false,
    wakeActive: false,
  }
  const run = vi.fn((file: string, args: readonly string[]): Promise<BackgroundProcessResult> => {
    if (
      file === 'powershell.exe' &&
      args.includes('-EncodedCommand') &&
      Buffer.from(args.at(-1) ?? '', 'base64')
        .toString('utf16le')
        .includes('WindowsIdentity')
    )
      return Promise.resolve(
        state.ownerFails
          ? result(1)
          : result(
              0,
              JSON.stringify({
                sid: state.invalidOwner ? 'invalid' : state.sid,
                elevated: state.elevated,
                service: state.service,
              }),
            ),
      )
    if (file === 'powershell.exe')
      return Promise.resolve(
        state.queryFails
          ? result(1, JSON.stringify(state.registered))
          : result(0, JSON.stringify(state.invalidQuery ? 'true' : state.registered)),
      )
    if (file === 'launchctl' && args[0] === 'print')
      return Promise.resolve(
        args[1]?.includes('/muse-') !== true || state.registered
          ? result()
          : result(1, '', 'Could not find service'),
      )
    if (file === 'systemctl' && args[1] === 'is-enabled') {
      const registered = state.registered
        ? result(0, 'enabled')
        : result(1, files.size > 0 ? 'disabled' : 'not-found')
      return Promise.resolve(state.queryFails ? result(1) : registered)
    }
    if (file === 'systemctl' && args[1] === 'is-active')
      return Promise.resolve(state.active ? result(0, 'active') : result(3, 'inactive'))
    if (file === 'systemctl' && args[1] === 'stop' && !state.refusesStop) state.active = false
    if (args.includes('/Create') || args.includes('bootstrap') || args.includes('enable')) {
      if (state.createFails) return Promise.resolve(result(1, '', 'OS refused'))
      if (!state.silentCreate) state.registered = true
      if (state.reportsFailureAfterCreate)
        return Promise.resolve(result(1, '', 'Partial OS failure'))
    }
    if (args.includes('/Delete') || args.includes('bootout') || args.includes('disable')) {
      if (state.deleteFails) return Promise.resolve(result(1, '', 'OS refused'))
      if (!state.staysRegistered) state.registered = false
    }
    return Promise.resolve(result())
  })
  const isWindows = platform === 'win32'
  const trustedPath = vi
    .fn<BackgroundFilePort['trustedPath']>()
    .mockImplementation((file) => Promise.resolve(file))
  const prepare = vi.fn().mockResolvedValue(undefined)
  const authorization = vi.fn().mockResolvedValue({ scheduledPrompts: false })
  const deps: NativeBackgroundDeps = {
    platform,
    isWakeProcess: false,
    homeDir: isWindows ? String.raw`C:\Users\rig` : '/home/rig',
    dataDir: isWindows ? String.raw`C:\data` : '/data',
    executable: isWindows ? String.raw`C:\node.exe` : '/usr/bin/node',
    agentFile: isWindows ? String.raw`C:\agent\dist\acp.js` : '/agent/dist/acp.js',
    uid: 1000,
    effectiveUid: 1000,
    now: () => 1000,
    authorization,
    files: {
      trustedPath,
      prepare,
      hash: (file) => {
        const text = files.get(file)
        return Promise.resolve(
          text === undefined
            ? undefined
            : createHash('sha256')
                .update(file.endsWith('.xml') ? Buffer.from(`\u{FEFF}${text}`, 'utf16le') : text)
                .digest('hex'),
        )
      },
      waitForWake: (_dataDir, shouldWait) =>
        shouldWait === false && state.wakeActive
          ? Promise.reject(new Error(UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable))
          : Promise.resolve(),
      read: (file) => Promise.resolve(files.get(file)),
      write: (file, text) => {
        files.set(file, text)
        return Promise.resolve()
      },
      remove: (file) => {
        files.delete(file)
        return Promise.resolve()
      },
    },
    run,
    ...overrides,
  }
  const entry = new NativeScheduleBackground(deps)
  return { entry, files, state, run, trustedPath, prepare, authorization, deps }
}
describe('native background lifecycle', () => {
  it.each(['win32', 'darwin', 'linux'] as const)(
    'refuses a definition replaced or linked after publication before %s OS import',
    async (platform) => {
      for (const change of ['replacement', 'symlink']) {
        const { entry, deps, files, trustedPath, run } = setup(platform)
        const definition = backgroundDefinitionPaths(platform, deps.homeDir, deps.dataDir)[0]!
        if (change === 'replacement') {
          const write = deps.files.write
          vi.spyOn(deps.files, 'write').mockImplementation(async (file, text, encoding) => {
            await write(file, text, encoding)
            if (file === definition) files.set(file, `${text}\nreplaced`)
          })
        } else
          trustedPath.mockImplementation((file, _platform, _uid, kind) =>
            file === definition && kind === 'definition'
              ? Promise.reject(new Error(`unsafe ${file}`))
              : Promise.resolve(file),
          )
        await expect(entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow(
          definition,
        )
        expect(
          run.mock.calls.some(
            ([, args]) =>
              args.includes('/Create') || args.includes('bootstrap') || args.includes('enable'),
          ),
        ).toBe(false)
      }
    },
  )
  it.each(['win32', 'darwin', 'linux'] as const)(
    'trusts every definition and record at registration and refuses replacement or unsafe paths at a %s fire',
    async (platform) => {
      const { entry, files, deps, prepare, trustedPath, run } = setup(platform)
      const definitions = backgroundDefinitionPaths(platform, deps.homeDir, deps.dataDir)
      const recordFile = backgroundRecordPath(platform, deps.dataDir)
      prepare.mockRejectedValueOnce(new Error('unsafe definition directory'))
      await expect(entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow(
        'unsafe definition directory',
      )
      expect(files.size).toBe(0)
      expect(
        run.mock.calls.some(
          ([, args]) =>
            args.includes('/Create') || args.includes('bootstrap') || args.includes('enable'),
        ),
      ).toBe(false)
      await entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })
      for (const file of [...definitions, recordFile]) {
        expect(prepare).toHaveBeenCalledWith(file, platform, 1000)
        expect(trustedPath).toHaveBeenCalledWith(file, platform, 1000, 'definition')
      }
      const fire = () => verifyRegisteredWake(deps)
      expect(await fire()).toEqual({ scheduledPrompts: false })
      for (const definition of definitions) {
        const original = files.get(definition)!
        files.set(definition, `${original}\nreplaced`)
        await expect(fire()).rejects.toThrow(definition)
        files.set(definition, original)
      }
      for (const unsafe of [...definitions, recordFile]) {
        trustedPath.mockImplementation((file) =>
          file === unsafe
            ? Promise.reject(new Error(`symlink or writable ancestor: ${file}`))
            : Promise.resolve(file),
        )
        await expect(fire()).rejects.toThrow(unsafe)
      }
      trustedPath.mockImplementation((file) => Promise.resolve(file))
      const originalRecord = files.get(recordFile)!
      const record: unknown = JSON.parse(originalRecord)
      // Boundary parses rather than trusting test-created JSON.
      const parsed = backgroundWakeRecordSchema.parse(record)
      if (platform === 'win32') {
        files.set(
          recordFile,
          JSON.stringify({
            ...parsed,
            executable: parsed.executable.replaceAll('\\', '/').toUpperCase(),
            agentFile: parsed.agentFile.replaceAll('\\', '/'),
            files: parsed.files.map((file) => ({ ...file, path: file.path.replaceAll('\\', '/') })),
          }),
        )
        expect(await fire()).toEqual({ scheduledPrompts: false })
      }
      for (const changed of [
        { files: [] },
        { id: 'other' },
        { agentFile: 'other' },
        { files: parsed.files.map((file) => ({ ...file, path: 'other' })) },
      ]) {
        files.set(recordFile, JSON.stringify({ ...parsed, ...changed }))
        await expect(fire()).rejects.toThrow()
      }
      files.set(recordFile, originalRecord)
      expect(await fire()).toEqual({ scheduledPrompts: false })
    },
  )
  it.each(['win32', 'darwin', 'linux'] as const)(
    'reads paid flag and hard budget only from the verified %s record and turns paid features off without the flag',
    async (platform) => {
      const { entry, files, deps, authorization } = setup(platform)
      authorization.mockResolvedValue({ scheduledPrompts: true, maxBudgetUsd: 1 })
      await entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })
      const fire = () => verifyRegisteredWake(deps)
      expect(await fire()).toEqual({ scheduledPrompts: true, maxBudgetUsd: 1 })
      for (const definition of backgroundDefinitionPaths(platform, deps.homeDir, deps.dataDir)) {
        expect(files.get(definition)).not.toMatch(/scheduled-prompts|max-budget-usd/)
      }
      const recordFile = backgroundRecordPath(platform, deps.dataDir)
      const record = backgroundWakeRecordSchema.parse(JSON.parse(files.get(recordFile)!))
      const { scheduledPrompts: _flag, ...withoutFlag } = record
      files.set(recordFile, JSON.stringify(withoutFlag))
      expect(await fire()).toEqual({ scheduledPrompts: false })
      const { maxBudgetUsd: _budget, ...withoutBudget } = record
      files.set(recordFile, JSON.stringify(withoutBudget))
      await expect(fire()).rejects.toThrow(UI_TEXT.scheduleV2.runtime.paidAuthorizationRequired)
      for (const maxBudgetUsd of [undefined, 0, NaN, Infinity]) {
        authorization.mockResolvedValue({ scheduledPrompts: true, maxBudgetUsd })
        await expect(entry.register(121_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow(
          UI_TEXT.scheduleV2.runtime.paidAuthorizationRequired,
        )
      }
    },
  )
  it.each(['darwin', 'linux', 'win32'] as const)(
    'rejects symlinks, reparse points and writable directory chains for %s definitions',
    async (platform) => {
      const p = platform === 'win32' ? path.win32 : path.posix
      const file = platform === 'win32' ? String.raw`C:\owned\task.xml` : '/owned/job.plist'
      const parent = p.dirname(file)
      const nodes = new Map([
        [file, fileInfo(1000, 0o600, false)],
        [parent, fileInfo(1000)],
        [p.dirname(parent), fileInfo()],
      ])
      const run = vi.fn<NativeBackgroundDeps['run']>().mockResolvedValue(result(0, 'true'))
      const io = {
        realpath: vi.fn().mockResolvedValue(file),
        lstat: vi.fn((target: string) => Promise.resolve(nodes.get(target)!)),
        run,
      }
      await expect(trustedBackgroundPath(file, platform, 1000, io, 'definition')).resolves.toBe(
        file,
      )
      for (const target of [file, parent]) {
        const original = nodes.get(target)!
        nodes.set(target, fileInfo(1000, 0o777, false, true))
        await expect(trustedBackgroundPath(file, platform, 1000, io, 'definition')).rejects.toThrow(
          target === file ? file : parent,
        )
        nodes.set(target, original)
      }
      if (platform === 'win32') {
        const scripts = run.mock.calls.map(([, args]) =>
          Buffer.from(args.at(-1) ?? '', 'base64').toString('utf16le'),
        )
        if (process.platform === 'win32') {
          const script = ordinaryWindowsIdentity(scripts[0] ?? '')
          const fixture = `function Get-Acl { param([string]$LiteralPath); $acl = [Security.AccessControl.FileSecurity]::new(); $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($user)); return $acl }; function Get-Item { param([switch]$Force, [string]$LiteralPath); return [pscustomobject]@{ Attributes = $global:testAttributes } }; $user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; foreach ($attributes in @([IO.FileAttributes]::Normal, [IO.FileAttributes]::ReparsePoint, ([IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint))) { $global:testAttributes = $attributes; ${script} }`
          expect(await windowsPolicyFixture(fixture)).toEqual([true, false, false])
        }
        run.mockImplementation((_file, args) =>
          Promise.resolve(
            result(
              0,
              Buffer.from(args.at(-1) ?? '', 'base64')
                .toString('utf16le')
                .includes(`Get-Acl -LiteralPath '${parent}'`)
                ? 'false'
                : 'true',
            ),
          ),
        )
      } else nodes.set(parent, fileInfo(1000, 0o1777))
      await expect(trustedBackgroundPath(file, platform, 1000, io, 'definition')).rejects.toThrow(
        parent,
      )
    },
  )
  it('publishes the wake identity before launching detached after-exit maintenance through canonical trusted paths', async () => {
    const child = new ChildProcess()
    const unref = vi.spyOn(child, 'unref').mockImplementation(() => undefined)
    const write = vi.fn().mockResolvedValue(undefined)
    const launch = vi.fn((_file: string, _args: readonly string[], _options: SpawnOptions) => {
      expect(write).toHaveBeenCalledOnce()
      queueMicrotask(() => {
        child.emit('spawn')
      })
      return child
    })
    const deps = {
      identity: vi.fn().mockResolvedValue('kernel-start'),
      trustedPath: vi.fn((file: string) => Promise.resolve(`/real${file}`)),
      write,
      launch,
    }
    const afterWake = await beginScheduleWake('/data', '/node', '/acp.js', deps)
    expect(launch).not.toHaveBeenCalled()
    await afterWake()
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining('background-wakes'),
      JSON.stringify({ pid: process.pid, startIdentity: 'kernel-start' }),
    )
    expect(launch).toHaveBeenCalledWith(
      '/real/node',
      ['/real/acp.js', 'schedule', 'background-maintain', '--json'],
      expect.objectContaining({ detached: true, stdio: 'ignore' }),
    )
    expect(unref).toHaveBeenCalledOnce()
    const env = launch.mock.calls[0]![2].env!
    expect(Object.keys(env).some((name) => /_API_KEY$/i.test(name))).toBe(false)
    deps.trustedPath.mockRejectedValueOnce(new Error('unsafe launcher'))
    await expect(beginScheduleWake('/data', '/node', '/acp.js', deps)).rejects.toThrow(
      'unsafe launcher',
    )
    expect(launch).toHaveBeenCalledOnce()
    deps.identity.mockResolvedValue(undefined)
    await expect(beginScheduleWake('/data', '/node', '/acp.js', deps)).rejects.toThrow()
  })
  it('refuses a live macOS wake immediately and also protects a starting launchd process', async () => {
    const { entry, run, state, files, deps } = setup('darwin')
    state.wakeActive = true
    const probe = vi.spyOn(deps.files, 'waitForWake')
    await expectLaunchdMaintenanceRefusal(entry, 61_000)
    expect(probe.mock.calls).toEqual([
      ['/data', false],
      ['/data', false],
    ])
    expect(files.size).toBe(0)
    expect(run).not.toHaveBeenCalled()
    state.wakeActive = false
    await entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })
    run.mockImplementation(() => Promise.resolve(result(0, 'state = running\n pid = 123\n')))
    await expectLaunchdMaintenanceRefusal(entry, 121_000)
    expect(run.mock.calls.some(([, args]) => args[0] === 'bootout')).toBe(false)
  })
  it('keeps a pid/start-identity lock while live, bounds retry and removes it only after exit or pid reuse', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'm115-wake-lock-'))
    try {
      const lock = path.join(directory, 'background-wakes', '123-fixture.json')
      const files = nodeBackgroundFiles()
      await files.write(lock, JSON.stringify({ pid: 123, startIdentity: 'start-a' }))
      let now = 0
      const identity = vi.fn().mockResolvedValue('start-a')
      const pause = vi.fn((ms: number) => {
        now += Math.max(ms, SCHEDULE_WAKE_WAIT_MS)
        return Promise.resolve()
      })
      await expect(
        waitForScheduleWake(directory, { now: () => now, pause, identity }),
      ).rejects.toThrow(UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable)
      expect(await files.read(lock)).toBeDefined()
      identity.mockResolvedValue('start-b')
      await waitForScheduleWake(directory, { now: () => now, pause, identity })
      expect(await files.read(lock)).toBeUndefined()
      expect(pause).toHaveBeenCalled()
      await files.write(lock, JSON.stringify({ pid: 123, startIdentity: 'start-a' }))
      identity.mockResolvedValueOnce('start-a').mockResolvedValue(undefined)
      await waitForScheduleWake(directory, { now: () => now, pause, identity })
      expect(await files.read(lock)).toBeUndefined()
      await files.write(lock, '{invalid')
      await expect(
        waitForScheduleWake(directory, { now: () => now, pause, identity }),
      ).rejects.toThrow()
      expect(await files.read(lock)).toBe('{invalid')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('stops and disables a disabled-but-active Linux timer and service and verifies absence and inactivity', async () => {
    const { entry, state, run } = setup('linux')
    state.active = true
    await entry.remove()
    for (const operation of ['stop', 'disable'])
      expect(run).toHaveBeenCalledWith('systemctl', [
        '--user',
        operation,
        expect.stringContaining('.timer'),
        expect.stringContaining('.service'),
      ])
    expect(state.active).toBe(false)
    state.active = true
    state.refusesStop = true
    await expect(entry.remove()).rejects.toThrow(UI_TEXT.scheduleV2.runtime.unavailable)
  })
  it('reverifies both current launcher paths before a wake and refuses real or effective root', async () => {
    const trustedPath = vi.fn().mockResolvedValue('/real/path')
    const deps = { platform: 'linux' as const, uid: 1000, effectiveUid: 1000, trustedPath }
    await verifyScheduleWake('/node', '/acp.js', deps)
    expect(trustedPath.mock.calls).toEqual([
      ['/node', 'linux', 1000],
      ['/acp.js', 'linux', 1000],
    ])
    trustedPath.mockRejectedValueOnce(new Error('unsafe /node'))
    await expect(verifyScheduleWake('/node', '/acp.js', deps)).rejects.toThrow('/node')
    for (const changed of [{ uid: 0 }, { effectiveUid: 0 }])
      await expect(verifyScheduleWake('/node', '/acp.js', { ...deps, ...changed })).rejects.toThrow(
        UI_TEXT.scheduleV2.runtime.invalidRequest,
      )
  })
  it('checks both launchers before mutation and installs only their canonical paths', async () => {
    const { entry, trustedPath, files, run } = setup('linux')
    trustedPath.mockRejectedValueOnce(new Error('unsafe /usr'))
    await expect(entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow(
      'unsafe /usr',
    )
    expect(files.size).toBe(0)
    expect(run).not.toHaveBeenCalled()
    trustedPath.mockImplementation((file, _platform, _uid, kind) =>
      Promise.resolve(kind === undefined ? `/real${file}` : file),
    )
    await entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })
    expect(trustedPath.mock.calls).toContainEqual(['/agent/dist/acp.js', 'linux', 1000])
    let service: string | undefined
    for (const text of files.values()) if (text.includes('ExecStart=')) service = text
    expect(service).toContain('"/real/usr/bin/node" "/real/agent/dist/acp.js"')
  })
  it('refuses root, effective root, Windows service identities and elevated tokens before mutation', async () => {
    for (const platform of ['linux', 'darwin'] as const) {
      for (const identity of [{ uid: 0 }, { effectiveUid: 0 }]) {
        const { entry, files, run } = setup(platform, identity)
        await expect(entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow()
        expect(files.size).toBe(0)
        expect(run).not.toHaveBeenCalled()
      }
    }
    for (const identity of [
      { sid: 'S-1-5-18' },
      { sid: 'S-1-5-19' },
      { sid: 'S-1-5-20' },
      { sid: 'S-1-5-80-1-2' },
      { elevated: true },
      { service: true },
    ]) {
      const { entry, state, files, run } = setup('win32')
      Object.assign(state, identity)
      await expect(entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow()
      expect(files.size).toBe(0)
      expect(run.mock.calls.some(([file]) => file === 'schtasks.exe')).toBe(false)
    }
  })
  it('validates POSIX ownership, writable ancestors, sticky directories, links and existence through the root', async () => {
    const nodes = new Map([
      ['/opt/node', fileInfo(1000, 0o755, false)],
      ['/opt', fileInfo()],
      ['/', fileInfo()],
      ['/link/node', fileInfo(1000, 0o755, false)],
      ['/link', fileInfo(1000, 0o777, false, true)],
    ])
    const io = {
      realpath: vi.fn().mockResolvedValue('/opt/node'),
      lstat: vi.fn((file: string) => {
        const value = nodes.get(file)
        return value === undefined ? Promise.reject(new Error('missing')) : Promise.resolve(value)
      }),
      run: vi.fn(),
    }
    expect(await trustedBackgroundPath('/link/node', 'linux', 1000, io)).toBe('/opt/node')
    expect(io.lstat).toHaveBeenCalledWith('/')
    const node = nodes.get('/opt/node')!
    nodes.set('/opt/node', fileInfo(1000, 0o755, true))
    await expect(trustedBackgroundPath('/link/node', 'linux', 1000, io)).rejects.toThrow(
      '/link/node',
    )
    nodes.set('/opt/node', node)
    for (const [target, value] of [
      ['/opt', fileInfo(0, 0o775)],
      ['/opt', fileInfo(2000)],
      ['/link', fileInfo(2000, 0o777, false, true)],
      ['/opt/node', fileInfo(1000, 0o777, false)],
      ['/', fileInfo(0, 0o777)],
    ] as const) {
      const before = nodes.get(target)!
      nodes.set(target, value)
      await expect(trustedBackgroundPath('/link/node', 'linux', 1000, io)).rejects.toThrow(target)
      nodes.set(target, before)
    }
    nodes.set('/opt', fileInfo(0, 0o1777))
    await expect(trustedBackgroundPath('/link/node', 'darwin', 1000, io)).resolves.toBe('/opt/node')
    io.realpath.mockRejectedValueOnce(new Error('missing'))
    await expect(trustedBackgroundPath('/missing', 'linux', 1000, io)).rejects.toThrow('/missing')
    await expect(trustedBackgroundPath('relative', 'linux', 1000, io)).rejects.toThrow('relative')
  })
  it('checks Windows ACLs on the named and resolved ancestors through the drive root and refuses helper failures', async () => {
    const io = {
      realpath: vi.fn().mockResolvedValue(String.raw`C:\real\node.exe`),
      lstat: vi.fn().mockResolvedValue(fileInfo(0, 0o755, false)),
      run: vi.fn<NativeBackgroundDeps['run']>().mockResolvedValue(result(0, 'true')),
    }
    expect(await trustedBackgroundPath(String.raw`C:\link\node.exe`, 'win32', 0, io)).toBe(
      String.raw`C:\real\node.exe`,
    )
    const scripts = io.run.mock.calls.map((call) =>
      Buffer.from(call[1].at(-1) ?? '', 'base64').toString('utf16le'),
    )
    if (process.platform === 'win32') {
      // The rig runs elevated; fake only the identity so the real ACL operations
      // exercise an ordinary user's policy. Token refusal is tested separately.
      const ordinaryScript = ordinaryWindowsIdentity(scripts[0] ?? '')
      const fixture = `function Get-Acl { param([string]$LiteralPath); $acl = [Security.AccessControl.FileSecurity]::new(); $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($global:testOwner)); if ($global:testWriter) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($global:testWriter), $global:testRights, 'Allow')) }; return $acl }; $user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; foreach ($case in @(@($user,$user,'Write'), @('S-1-5-18',$null,'Read'), @('S-1-5-32-544',$null,'Read'), @('S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464',$null,'Read'), @('S-1-5-32-545',$null,'Read'), @($user,'S-1-1-0','Write'), @($user,'S-1-1-0','ReadAndExecute'))) { $global:testOwner = $case[0]; $global:testWriter = $case[1]; $global:testRights = $case[2]; ${ordinaryScript} }`
      expect(await windowsPolicyFixture(fixture)).toEqual([
        true,
        true,
        true,
        true,
        false,
        false,
        true,
      ])
    }
    expect(scripts.some((script) => script.includes(String.raw`Get-Acl -LiteralPath 'C:\'`))).toBe(
      true,
    )
    expect(
      scripts.some((script) => script.includes(String.raw`Get-Acl -LiteralPath 'C:\real'`)),
    ).toBe(true)
    for (const response of [result(0, 'false'), result(1, 'true'), result(0, '"true"')]) {
      io.run.mockResolvedValueOnce(response)
      await expect(
        trustedBackgroundPath(String.raw`C:\link\node.exe`, 'win32', 0, io),
      ).rejects.toThrow(String.raw`C:\link\node.exe`)
    }
  })
  it('refuses self-unloading launchd wake maintenance before changing a file or job', async () => {
    const run = vi.fn(),
      files = {
        read: vi.fn(),
        write: vi.fn(),
        remove: vi.fn(),
        trustedPath: vi.fn(),
        waitForWake: vi.fn(),
        prepare: vi.fn(),
        hash: vi.fn(),
      }
    const entry = new NativeScheduleBackground({
      platform: 'darwin',
      homeDir: '/home/rig',
      dataDir: '/data',
      executable: '/usr/bin/node',
      agentFile: '/agent/dist/acp.js',
      uid: 1000,
      now: () => 1000,
      isWakeProcess: true,
      authorization: () => Promise.resolve({ scheduledPrompts: false }),
      files,
      run,
    })
    await expectLaunchdMaintenanceRefusal(entry, 61_000)
    expect(run).not.toHaveBeenCalled()
    expect(files.write).not.toHaveBeenCalled()
  })
  it.each(['win32', 'darwin', 'linux'] as const)(
    'creates, checks, rearms and removes the per-user entry on %s',
    async (platform) => {
      const { entry, files, state, run } = setup(platform)
      expect(await entry.status()).toEqual({ registered: false })
      for (const choice of ['notNow', 'never'] as const)
        await expect(entry.register(61_000, { choice, decidedAtMs: 1000 })).rejects.toThrow(
          UI_TEXT.scheduleV2.runtime.consentRequired,
        )
      expect(state.registered).toBe(false)
      expect(files.size).toBe(0)
      await entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })
      expect(await entry.status()).toEqual({
        registered: true,
        nextWakeAtMs: platform === 'darwin' ? 120_000 : 61_000,
      })
      await entry.register(121_000, { choice: 'yes', decidedAtMs: 1000 })
      const rearmed = await entry.status()
      expect(rearmed.nextWakeAtMs).toBe(platform === 'darwin' ? 180_000 : 121_000)
      if (platform === 'linux')
        expect(run).toHaveBeenCalledWith('systemctl', [
          '--user',
          'restart',
          expect.stringContaining('.timer'),
        ])
      await entry.remove()
      expect(await entry.status()).toEqual({ registered: false })
      expect(files.size).toBe(0)
      await entry.remove()
    },
  )
  it('never reports failed registration, query or removal as success', async () => {
    const { entry, state, files } = setup('win32')
    state.createFails = true
    await expect(entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow()
    expect(await entry.status()).toEqual({ registered: false })
    state.createFails = false
    state.silentCreate = true
    await expect(entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow()
    state.silentCreate = false
    state.reportsFailureAfterCreate = true
    await expect(entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow()
    state.reportsFailureAfterCreate = false
    await entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })
    state.deleteFails = true
    await expect(entry.remove()).rejects.toThrow()
    expect(files.size).toBeGreaterThan(0)
    state.deleteFails = false
    state.staysRegistered = true
    await expect(entry.remove()).rejects.toThrow()
    state.queryFails = true
    await expect(entry.status()).rejects.toThrow()
  })
  it('validates the kernel owner and boolean status before trusting the Windows helper', async () => {
    const { entry, state, files } = setup('win32')
    state.invalidQuery = true
    await expect(entry.status()).rejects.toThrow()
    state.invalidQuery = false
    state.queryFails = true
    await expect(entry.status()).rejects.toThrow()
    state.queryFails = false
    state.ownerFails = true
    await expect(entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow()
    state.ownerFails = false
    state.invalidOwner = true
    await expect(
      entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 }),
    ).rejects.toMatchObject({
      name: '$ZodError',
    })
    expect(files.size).toBe(0)
  })
  it('refuses unknown launchd and systemd query failures instead of reporting absence', async () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const { entry, run } = setup(platform)
      run.mockResolvedValue(result(1, 'enabled', 'Unexpected OS failure'))
      await expect(entry.status()).rejects.toThrow()
    }
    await expect(setup('freebsd').entry.status()).rejects.toThrow()
  })
  it('observes a crash orphan without claiming an invented next wake, and rejects corrupt wake state', async () => {
    const { entry, state, files } = setup('linux')
    state.registered = true
    expect(await entry.status()).toEqual({ registered: true })
    await entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })
    const stateFile = '/data/background-wake.json'
    expect(files.has(stateFile)).toBe(true)
    files.set(stateFile, '{bad')
    await expect(entry.status()).rejects.toThrow()
    files.set(stateFile, '{"nextWakeAtMs":-1}')
    await expect(entry.status()).rejects.toThrow()
  })
  it('uses owner-only atomic files and bounded state reads', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'm115-background-'))
    try {
      const files = nodeBackgroundFiles(),
        file = path.join(directory, 'entry.json')
      expect(await files.read(file)).toBeUndefined()
      await files.write(file, '{"nextWakeAtMs":61000}')
      expect(await readFile(file, 'utf8')).toBe('{"nextWakeAtMs":61000}')
      const xmlFile = path.join(directory, 'task.xml')
      await files.write(
        xmlFile,
        '<?xml version="1.0" encoding="UTF-16"?><Task>日本語</Task>',
        'utf16le',
      )
      const xmlBytes = await readFile(xmlFile)
      expect([...xmlBytes.subarray(0, 2)]).toEqual([0xff, 0xfe])
      expect(xmlBytes.toString('utf16le')).toContain('日本語')
      expect(await files.hash(xmlFile)).toBe(createHash('sha256').update(xmlBytes).digest('hex'))
      expect(await files.hash(path.join(directory, 'missing.xml'))).toBeUndefined()
      if (process.platform !== 'win32') {
        const info = await stat(file)
        expect(info.mode & 0o777).toBe(0o600)
      }
      await writeFile(file, 'x'.repeat(5000))
      await expect(files.read(file)).rejects.toThrow()
      await writeFile(file, Buffer.from([0xff]))
      await expect(files.read(file)).rejects.toThrow()
      await expect(files.read(directory)).rejects.toThrow(
        UI_TEXT.scheduleV2.runtime.invalidResponse,
      )
      await files.remove(file)
      await files.remove(file)
      expect(await files.read(file)).toBeUndefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('fences credential variables from actual OS helper children and reports their failures', async () => {
    const run = backgroundProcessRunner({ SAFE_MARKER: 'allowed', FIXTURE_API_KEY: 'withheld' })
    const result = await run(process.execPath, [
      '-e',
      'process.stdout.write(JSON.stringify({safe:process.env.SAFE_MARKER,keyPresent:process.env.FIXTURE_API_KEY!==undefined}))',
    ])
    expect(JSON.parse(result.stdout)).toEqual({ safe: 'allowed', keyPresent: false })
    expect(
      await run(process.execPath, [
        '-e',
        'process.stderr.write("bounded failure");process.exitCode=1',
      ]),
    ).toEqual({ exitCode: 1, stdout: '', stderr: 'bounded failure' })
    await expect(run(path.join(os.tmpdir(), 'm115-nonexistent-program'), [])).rejects.toThrow(
      UI_TEXT.scheduleV2.runtime.unavailable,
    )
  })
  it('uses the system helper despite a replacement executable on PATH and refuses an invalid root', async () => {
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from("ConvertTo-Json -Compress -InputObject 'system-helper'", 'utf16le').toString(
        'base64',
      ),
    ]
    if (process.platform === 'win32') {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'm115-helper-shadow-'))
      try {
        await copyFile(process.execPath, path.join(directory, 'powershell.exe'))
        const run = backgroundProcessRunner({
          SystemRoot: process.env['SystemRoot'],
          PATH: directory,
        })
        const result = await run('powershell.exe', args)
        expect(result.exitCode).toBe(0)
        expect(JSON.parse(result.stdout)).toBe('system-helper')
      } finally {
        expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir()))
        await rm(directory, { recursive: true, force: true })
      }
    }
    for (const SystemRoot of [undefined, 'relative', 'C:\\Windows\n']) {
      const run = backgroundProcessRunner({ SystemRoot })
      await expect(run('powershell.exe', args)).rejects.toMatchObject({
        cause: { message: UI_TEXT.scheduleV2.runtime.backgroundUnavailable },
      })
    }
  })
})
