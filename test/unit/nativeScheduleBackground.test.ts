import { copyFile, mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises'
import { ChildProcess, type SpawnOptions } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  NativeScheduleBackground,
  type BackgroundProcessResult,
  type NativeBackgroundDeps,
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
  const trustedPath = vi.fn((file: string) => Promise.resolve(file))
  const entry = new NativeScheduleBackground({
    platform,
    isWakeProcess: false,
    homeDir: isWindows ? String.raw`C:\Users\rig` : '/home/rig',
    dataDir: isWindows ? String.raw`C:\data` : '/data',
    executable: isWindows ? String.raw`C:\node.exe` : '/usr/bin/node',
    agentFile: isWindows ? String.raw`C:\agent\dist\acp.js` : '/agent/dist/acp.js',
    uid: 1000,
    effectiveUid: 1000,
    now: () => 1000,
    files: {
      trustedPath,
      waitForWake: () => Promise.resolve(),
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
  })
  return { entry, files, state, run, trustedPath }
}
describe('native background lifecycle', () => {
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
  it('defers every macOS host until the wake lock releases and refuses a starting launchd process', async () => {
    const held = Promise.withResolvers<undefined>()
    const files = {
      trustedPath: vi.fn((file: string) => Promise.resolve(file)),
      waitForWake: vi.fn().mockReturnValue(held.promise),
      read: vi.fn(),
      write: vi.fn(),
      remove: vi.fn(),
    }
    const { entry, run } = setup('darwin', { files })
    const registration = entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })
    await Promise.resolve()
    expect(files.write).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    held.resolve(undefined)
    await registration
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
    trustedPath.mockImplementation((file) => Promise.resolve(`/real${file}`))
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
      const run = backgroundProcessRunner({ SystemRoot: process.env['SystemRoot'] })
      // The rig runs elevated; fake only the identity so the real ACL operations
      // exercise an ordinary user's policy. Token refusal is tested separately.
      const ordinaryScript = (scripts[0] ?? '')
        .replace(
          '[Security.Principal.WindowsIdentity]::GetCurrent()',
          '[pscustomobject]@{ User = [pscustomobject]@{ Value = $user }; Groups = @(); IsSystem = $false }',
        )
        .replace(
          '([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
          '$false',
        )
      const fixture = `function Get-Acl { param([string]$LiteralPath); $acl = [Security.AccessControl.FileSecurity]::new(); $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($global:testOwner)); if ($global:testWriter) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($global:testWriter), $global:testRights, 'Allow')) }; return $acl }; $user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; foreach ($case in @(@($user,$user,'Write'), @('S-1-5-18',$null,'Read'), @('S-1-5-32-544',$null,'Read'), @('S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464',$null,'Read'), @('S-1-5-32-545',$null,'Read'), @($user,'S-1-1-0','Write'), @($user,'S-1-1-0','ReadAndExecute'))) { $global:testOwner = $case[0]; $global:testWriter = $case[1]; $global:testRights = $case[2]; ${ordinaryScript} }`
      const output = await run('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(fixture, 'utf16le').toString('base64'),
      ])
      expect(output.exitCode).toBe(0)
      expect(
        output.stdout
          .trim()
          .split(/\r?\n/)
          .map((line) => {
            const value: unknown = JSON.parse(line)
            return value
          }),
      ).toEqual([true, true, true, true, false, false, true])
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
