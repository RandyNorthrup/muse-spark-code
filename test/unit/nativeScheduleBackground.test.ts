import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  stat,
  writeFile,
  rm,
  symlink,
  lstat,
  chmod,
  realpath,
} from 'node:fs/promises'
import { ChildProcess, type SpawnOptions } from 'node:child_process'
import os from 'node:os'
import process from 'node:process'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
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
import type { TrustedPathVerifier } from '../../src/runtime/trustedPathPort'
import { verifySystemdSearchDirectories } from '../../src/runtime/schedules/effectiveDefinition'

function nativeFixtureVerifier(uid: number, stopAt?: string): TrustedPathVerifier {
  return {
    async verify(file: string, options: { leafKind: 'file' | 'directory' }) {
      let component = file
      for (;;) {
        const info = await lstat(component)
        const isLeaf = component === file
        if (
          info.isSymbolicLink() ||
          (info.uid !== 0 && info.uid !== uid) ||
          (info.mode & 0o022) !== 0 ||
          (isLeaf && options.leafKind === 'file' ? !info.isFile() : !info.isDirectory())
        )
          return { refused: true, component, reason: 'native fixture owner/mode/kind' }
        // A test-owned trust anchor ends the walk: the fixture asserts the
        // anchor itself and enforces everything below it, so world-writable
        // system temp ancestry above the anchor stays out of the case.
        if (stopAt !== undefined && component === stopAt)
          return { ok: true, path: await realpath(file) }
        const parent = path.dirname(component)
        if (parent === component) return { ok: true, path: await realpath(file) }
        component = parent
      }
    },
  }
}

function result(exitCode = 0, stdout = '', stderr = ''): BackgroundProcessResult {
  return { exitCode, stdout, stderr }
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
      run: deps.run,
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
    now: 1000,
    dropIns: new Array<string>(),
    sourcePath: '',
    taskXml: 'exported XML',
    taskFolderTrusted: true,
    taskTrusted: true,
    unitPaths: ['/home/rig/.config/systemd/user', '/etc/systemd/user'],
    actionPath: String.raw`C:\node.exe`,
  }
  const run = vi.fn((file: string, args: readonly string[]): Promise<BackgroundProcessResult> => {
    if (
      file === 'powershell.exe' &&
      args.includes('-EncodedCommand') &&
      Buffer.from(args.at(-1) ?? '', 'base64')
        .toString('utf16le')
        .includes('$principal =')
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
    if (
      file === 'powershell.exe' &&
      Buffer.from(args.at(-1) ?? '', 'base64')
        .toString('utf16le')
        .includes('GetTask(')
    )
      return Promise.resolve(
        result(
          0,
          JSON.stringify({
            xml: state.taskXml,
            actionPath: state.actionPath,
            folderTrusted: state.taskFolderTrusted,
            ...(Buffer.from(args.at(-1) ?? '', 'base64')
              .toString('utf16le')
              .includes('$task.GetSecurityDescriptor(') && { taskTrusted: state.taskTrusted }),
          }),
        ),
      )
    if (
      file === 'powershell.exe' &&
      Buffer.from(args.at(-1) ?? '', 'base64')
        .toString('utf16le')
        .includes('GetSecurityDescriptor')
    )
      return Promise.resolve(
        result(
          0,
          JSON.stringify(
            state.taskFolderTrusted &&
              (!state.registered ||
                state.taskTrusted ||
                !Buffer.from(args.at(-1) ?? '', 'base64')
                  .toString('utf16le')
                  .includes('(Test-TrustedAcl $taskAcl $false $false $true)')),
          ),
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
          ? result(0, 'state = not running\n')
          : result(1, '', 'Could not find service'),
      )
    if (file === 'systemd-analyze') return Promise.resolve(result(0, state.unitPaths.join('\n')))
    if (file === 'systemctl' && args[1] === 'show') {
      const unit = args.at(-1) ?? ''
      let fragment = ''
      for (const file of files.keys()) if (file.endsWith(`/${unit}`)) fragment = file
      return Promise.resolve(
        result(
          0,
          `FragmentPath=${fragment}\nDropInPaths=${unit.endsWith('.service') ? state.dropIns.join(' ') : ''}\nSourcePath=${state.sourcePath}\n`,
        ),
      )
    }
    if (file === 'systemctl' && args[1] === 'is-enabled') {
      const registered = state.registered
        ? result(0, 'enabled')
        : result(1, files.size > 0 ? 'disabled' : 'not-found')
      return Promise.resolve(state.queryFails ? result(1) : registered)
    }
    if (file === 'systemctl' && args[1] === 'is-active')
      return Promise.resolve(state.active ? result(0, 'active') : result(3, 'inactive'))
    if (
      file === 'systemctl' &&
      (args[1] === 'stop' || args.includes('--now')) &&
      !state.refusesStop
    )
      state.active = false
    if (args.includes('/Create') || args.includes('bootstrap') || args.includes('enable')) {
      if (state.createFails) return Promise.resolve(result(1, '', 'OS refused'))
      if (!state.silentCreate) state.registered = true
      if (state.reportsFailureAfterCreate)
        return Promise.resolve(result(1, '', 'Partial OS failure'))
    }
    if (
      args.includes('/Delete') ||
      args.includes('bootout') ||
      (file === 'systemctl' && args.includes('disable'))
    ) {
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
    now: () => state.now,
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
  it.each(['root', 'unit', 'type', 'prefix'] as const)(
    'refuses an empty writable systemd %s directory at registration, rearm and fire',
    async (kind) => {
      const { entry, state, deps, trustedPath, run } = setup('linux')
      const id = backgroundRegistrationId(deps.homeDir)
      const root = '/etc/systemd/user'
      const names = {
        root: '',
        unit: `${id}.service.d`,
        type: 'timer.d',
        prefix: 'muse-.service.d',
      }
      const unsafe = path.posix.join(root, names[kind])
      let shouldRefuse = true
      trustedPath.mockImplementation((file) =>
        file === unsafe && shouldRefuse ? Promise.reject(new Error(unsafe)) : Promise.resolve(file),
      )
      await expect(entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow(
        unsafe,
      )
      expect(
        run.mock.calls.some(([, args]) => args.includes('enable') || args.includes('restart')),
      ).toBe(false)
      shouldRefuse = false
      await entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })
      expect(trustedPath).toHaveBeenCalledWith(
        `${root}/${id}.timer.d`,
        'linux',
        1000,
        'search-directory',
      )
      state.active = true
      shouldRefuse = true
      await expect(verifyRegisteredWake(deps)).rejects.toThrow(unsafe)
      await expect(entry.register(121_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow(
        unsafe,
      )
      expect(state.active).toBe(false)
      expect(state.registered).toBe(false)
      expect(run).toHaveBeenCalledWith('systemctl', ['--user', 'disable', '--now', `${id}.timer`])
    },
  )
  it('refuses unavailable or malformed systemd search paths before activation and fire', async () => {
    const { entry, state, deps, run } = setup('linux')
    await entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })
    // Each broken manager environment refuses honestly: an empty listing is a
    // malformed response (an unset runtime directory falls back inside
    // systemd, so only its empty answer is observable here), a relative root
    // names itself as unsafe, and a failed query is unavailable, as in a
    // session without a user manager.
    for (const [paths, message] of [
      [[], UI_TEXT.scheduleV2.runtime.invalidResponse],
      [['/safe', '', '/other'], UI_TEXT.scheduleV2.runtime.invalidResponse],
      [['relative'], 'relative'],
      [[String.raw`/safe\escape`], String.raw`/safe\escape`],
      // A forged newline splits into two roots in the line protocol; the
      // relative half is refused by name, so it cannot slip through either.
      [['/safe\nforged'], 'forged'],
      [['/safe', '/safe'], UI_TEXT.scheduleV2.runtime.invalidResponse],
    ] as const) {
      state.unitPaths = [...paths]
      await expect(verifyRegisteredWake(deps)).rejects.toThrow(message)
      await expect(entry.register(121_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow(
        message,
      )
    }
    const original = run.getMockImplementation()!
    run.mockImplementation((file, args) =>
      file === 'systemd-analyze' ? Promise.resolve(result(1)) : original(file, args),
    )
    await expect(verifyRegisteredWake(deps)).rejects.toThrow(UI_TEXT.scheduleV2.runtime.unavailable)
  })
  it('refuses an unsafe Windows task descriptor at registration and each fire', async () => {
    const { entry, state, deps, run } = setup('win32')
    state.registered = true // Existing task security must be checked before updating it.
    state.taskTrusted = false
    await expect(entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow()
    expect(run.mock.calls.some(([, args]) => args.includes('/Create'))).toBe(false)
    state.taskTrusted = true
    await entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })
    expect(await verifyRegisteredWake(deps)).toEqual({ scheduledPrompts: false })
    state.taskTrusted = false
    await expect(verifyRegisteredWake(deps)).rejects.toThrow()
    const scripts = run.mock.calls.map(([, args]) =>
      Buffer.from(args.at(-1) ?? '', 'base64').toString('utf16le'),
    )
    expect(
      scripts.some(
        (script) =>
          script.includes('$task.GetSecurityDescriptor(7)') &&
          script.includes('Test-TrustedAcl $taskAcl $false $false $true'),
      ),
    ).toBe(true)
  })
  it('disables launchd before record publication and blocks a start after the final idle print', async () => {
    const { entry, state, files, deps, run } = setup('darwin')
    await entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })
    const recordFile = backgroundRecordPath('darwin', deps.dataDir)
    const original = run.getMockImplementation()!
    let isDisabled = false
    let wasFinalStartAttempted = false
    run.mockImplementation((file, args) => {
      if (args[0] === 'disable') {
        const record = backgroundWakeRecordSchema.parse(JSON.parse(files.get(recordFile)!))
        if (!isDisabled) expect(record.disabledAtMs).toBeUndefined()
        isDisabled = true
      }
      if (args[0] === 'print' && state.now > 1000) {
        wasFinalStartAttempted = true
        if (!isDisabled) state.wakeActive = true
      }
      if (args[0] === 'bootout') expect(state.wakeActive).toBe(false)
      return original(file, args)
    })
    await expect(entry.remove()).rejects.toThrow(
      UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable,
    )
    await expect(verifyRegisteredWake(deps)).rejects.toThrow(recordFile)
    state.now += 60_000
    await entry.remove()
    expect(wasFinalStartAttempted).toBe(true)
    expect(files.size).toBe(0)
  })

  it.each(['drop-in', 'symlinked drop-in', 'writable drop-in directory'])(
    'refuses a Linux %s before activation and on every fire',
    async (kind) => {
      const { entry, state, deps, trustedPath, files, run } = setup('linux')
      const dropIn = `/home/rig/.config/systemd/user/${backgroundRegistrationId(deps.homeDir)}.service.d/override.conf`
      files.set(dropIn, '[Service]\nExecStart=\nExecStart=/untrusted/payload\n')
      state.dropIns = [dropIn]
      if (kind !== 'drop-in')
        trustedPath.mockImplementation((file) =>
          file === dropIn ? Promise.reject(new Error(`${kind}: ${file}`)) : Promise.resolve(file),
        )
      await expect(entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow(
        dropIn,
      )
      expect(
        run.mock.calls.some(([, args]) => args.includes('enable') || args.includes('restart')),
      ).toBe(false)
      expect(trustedPath).toHaveBeenCalledWith(dropIn, 'linux', 1000, 'definition')
      state.dropIns = []
      await entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })
      state.dropIns = [dropIn]
      await expect(verifyRegisteredWake(deps)).rejects.toThrow(dropIn)
      state.active = true
      await expect(entry.register(121_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow(
        dropIn,
      )
      expect(state.active).toBe(false)
      expect(state.registered).toBe(false)
    },
  )
  it('refuses unaccounted systemd SourcePath and missing or malformed manager properties', async () => {
    const { entry, state, run, deps } = setup('linux')
    state.sourcePath = '/etc/generated-source'
    await expect(entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow(
      state.sourcePath,
    )
    state.sourcePath = ''
    await entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })
    const original = run.getMockImplementation()!
    for (const output of [
      'FragmentPath=/x\nSourcePath=',
      'DropInPaths=\nSourcePath=\nFragmentPath=',
      'unexpected',
    ]) {
      run.mockImplementation((file, args) =>
        args[1] === 'show' ? Promise.resolve(result(0, output)) : original(file, args),
      )
      await expect(verifyRegisteredWake(deps)).rejects.toThrow()
    }
  })
  it('binds exported Task Scheduler XML, action path and task folder ACL to the record', async () => {
    const { entry, state, deps, run } = setup('win32')
    state.taskFolderTrusted = false
    await expect(entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow()
    expect(run.mock.calls.some(([, args]) => args.includes('/Create'))).toBe(false)
    state.taskFolderTrusted = true
    await entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })
    const id = backgroundRegistrationId(deps.homeDir)
    const create = run.mock.calls.find(([, args]) => args.includes('/Create'))
    expect(create?.[1]).toContain(path.win32.join(path.win32.sep, id, id))
    const folderScript = run.mock.calls
      .map(([, args]) => Buffer.from(args.at(-1) ?? '', 'base64').toString('utf16le'))
      .find((script) => script.includes('CreateFolder('))
    expect(folderScript).toContain(`GetFolder('${path.win32.join(path.win32.sep, id)}')`)
    expect(folderScript).toContain(`O:${state.sid}D:P`)
    expect(folderScript).not.toContain('Set-Acl')
    expect(await verifyRegisteredWake(deps)).toEqual({ scheduledPrompts: false })
    state.taskXml += '<Exec>replacement</Exec>'
    await expect(verifyRegisteredWake(deps)).rejects.toThrow()
    state.taskXml = 'exported XML'
    state.actionPath = String.raw`C:\untrusted\payload.exe`
    await expect(verifyRegisteredWake(deps)).rejects.toThrow(state.actionPath)
    state.actionPath = deps.executable
    state.taskFolderTrusted = false
    await expect(verifyRegisteredWake(deps)).rejects.toThrow()
  })
  it('never unloads a macOS wake that starts after the old idle check', async () => {
    const { entry, state, files, run, deps } = setup('darwin')
    await entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })
    const original = run.getMockImplementation()!
    let hasStarted = false
    run.mockImplementation((file, args) => {
      if (args[0] === 'disable') {
        const record = backgroundWakeRecordSchema.parse(
          JSON.parse(files.get(backgroundRecordPath('darwin', deps.dataDir))!),
        )
        if (!hasStarted) expect(record.disabledAtMs).toBeUndefined()
        hasStarted = true
      }
      return hasStarted && args[0] === 'print'
        ? Promise.resolve(result(0, 'state = starting\n'))
        : original(file, args)
    })
    await expect(entry.remove()).rejects.toThrow(
      UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable,
    )
    expect(files.size).toBeGreaterThan(0)
    state.now += 60_000
    await expect(entry.remove()).rejects.toThrow(
      UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable,
    )
    await expect(entry.register(181_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow()
    expect(run.mock.calls.some(([, args]) => args[0] === 'bootout')).toBe(false)
    await expect(verifyRegisteredWake(deps)).rejects.toThrow()
  })
  it('starts the full launchd retirement interval only after native disable succeeds', async () => {
    const { entry, state, files, deps, run } = setup('darwin')
    await entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })
    const original = run.getMockImplementation()!
    run.mockImplementation((file, args) =>
      args[0] === 'disable' ? Promise.resolve(result(1)) : original(file, args),
    )
    await expect(entry.remove()).rejects.toThrow()
    const recordFile = backgroundRecordPath('darwin', deps.dataDir)
    expect(backgroundWakeRecordSchema.parse(JSON.parse(files.get(recordFile)!))).toMatchObject({
      nextWakeAtMs: 120_000,
    })
    expect(
      backgroundWakeRecordSchema.parse(JSON.parse(files.get(recordFile)!)).disabledAtMs,
    ).toBeUndefined()
    state.now += 60_000
    run.mockImplementation(original)
    await expect(entry.remove()).rejects.toThrow(
      UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable,
    )
    expect(run.mock.calls.some(([, args]) => args[0] === 'bootout')).toBe(false)
    state.now += 60_000
    await entry.remove()
    expect(files.size).toBe(0)
    expect(run.mock.calls.filter(([, args]) => args[0] === 'bootout')).toHaveLength(1)
  })
  it('requires the disabled record publication to verify before launchd retirement', async () => {
    const { entry, files, deps, run } = setup('darwin')
    await entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })
    const recordFile = backgroundRecordPath('darwin', deps.dataDir)
    const original = files.get(recordFile)!
    vi.spyOn(deps.files, 'write').mockImplementation((file, text) => {
      files.set(file, file === recordFile ? original : text)
      return Promise.resolve()
    })
    await expect(entry.remove()).rejects.toThrow(recordFile)
    expect(run.mock.calls.some(([, args]) => args[0] === 'disable')).toBe(true)
    expect(run.mock.calls.some(([, args]) => args[0] === 'bootout')).toBe(false)
  })
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
      authorization.mockResolvedValue({ scheduledPrompts: true, maxBudgetUsd: '1' })
      await entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })
      const fire = () => verifyRegisteredWake(deps)
      expect(await fire()).toEqual({ scheduledPrompts: true, maxBudgetUsd: '1' })
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
      for (const maxBudgetUsd of [undefined, '0', 'NaN', 'Infinity', 0, NaN, Infinity]) {
        authorization.mockResolvedValue({ scheduledPrompts: true, maxBudgetUsd })
        await expect(entry.register(121_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow(
          UI_TEXT.scheduleV2.runtime.paidAuthorizationRequired,
        )
      }
    },
  )
  it('refuses a writable unit drop-in directory under a reported search root with its exact path', async () => {
    // Posix-only: the reported search roots below use posix separators.
    if (process.platform === 'win32') return
    const uid = process.getuid?.() ?? 0
    // A hermetic trust anchor the fixture owns: every directory from the
    // anchor down is created with an explicit 0700 mode (chmod, never the
    // umask) and asserted before use, and the verifier stops at the anchor,
    // so world-writable system temp ancestry can neither pass nor fail this
    // case. Only the deliberately writable drop-in below may refuse.
    const anchor = await realpath(await mkdtemp(path.join(os.tmpdir(), 'm115-anchor-')))
    try {
      await chmod(anchor, 0o700)
      const anchorInfo = await lstat(anchor)
      expect(anchorInfo.uid).toBe(uid)
      expect(anchorInfo.mode & 0o777).toBe(0o700)
      const directory = await mkdtemp(path.join(anchor, 'm115-search-'))
      await chmod(directory, 0o700)
      const directoryInfo = await lstat(directory)
      expect(directoryInfo.uid).toBe(uid)
      expect(directoryInfo.mode & 0o777).toBe(0o700)
      const id = backgroundRegistrationId(directory)
      const root = path.join(directory, 'units')
      const dropDirectory = path.posix.join(root, `${id}.service.d`)
      await mkdir(root, { recursive: true, mode: 0o700 })
      await chmod(root, 0o700)
      const rootInfo = await lstat(root)
      expect(rootInfo.uid).toBe(uid)
      expect(rootInfo.mode & 0o777).toBe(0o700)
      await mkdir(dropDirectory, { recursive: true, mode: 0o700 })
      await chmod(dropDirectory, 0o777)
      const files = nodeBackgroundFiles(nativeFixtureVerifier(uid, anchor))
      const run = (file: string): Promise<BackgroundProcessResult> =>
        file === 'systemd-analyze'
          ? Promise.resolve(result(0, root))
          : Promise.reject(new Error(`unexpected native call ${file}`))
      await expect(
        verifySystemdSearchDirectories({
          platform: 'linux',
          id,
          definitions: backgroundDefinitionPaths('linux', directory, directory),
          executable: process.execPath,
          uid,
          trustedPath: files.trustedPath,
          hash: files.hash,
          read: files.read,
          run,
        }),
      ).rejects.toThrow(dropDirectory)
    } finally {
      await rm(anchor, { recursive: true, force: true })
    }
  })
  it('natively refuses an empty writable systemd drop-in without leaving a disposable timer armed', async () => {
    if (process.platform !== 'linux') return
    const uid = process.getuid?.() ?? 0
    // Empty or relative runtime directories never reach the manager:
    // `systemd-analyze` prints compiled-in paths without touching the bus, so
    // search-root verification passes, and then the `systemctl` children
    // inherit the broken variable, cannot reach the bus, and production maps
    // their failure to `unavailable` at `daemon-reload` — before `enable`
    // could arm anything, and through the same broken runner, so nothing is
    // left armed. Only an unset variable falls back inside systemd, so no
    // fallback shape is asserted here.
    const probe = await backgroundProcessRunner(process.env)('systemctl', [
      '--user',
      'show-environment',
    ])
    const hasManager = probe.exitCode === 0
    for (const shape of ['', 'relative']) {
      const run = backgroundProcessRunner({ ...process.env, XDG_RUNTIME_DIR: shape })
      const shapeDir = await mkdtemp(path.join(os.tmpdir(), 'm115-native-xdg-'))
      try {
        const shapeId = backgroundRegistrationId(shapeDir)
        const shapeAgent = path.join(shapeDir, 'agent.js')
        await writeFile(shapeAgent, 'process.exitCode = 0', { mode: 0o600 })
        const entry = new NativeScheduleBackground({
          platform: 'linux',
          homeDir: shapeDir,
          dataDir: shapeDir,
          executable: process.execPath,
          agentFile: shapeAgent,
          uid,
          effectiveUid: uid,
          isWakeProcess: false,
          now: Date.now,
          files: {
            ...nodeBackgroundFiles(),
            trustedPath: (file: string) => Promise.resolve(file),
          },
          authorization: () => Promise.resolve({ scheduledPrompts: false }),
          run,
        })
        await expect(
          entry.register(Date.now() + 600_000, { choice: 'yes', decidedAtMs: Date.now() }),
        ).rejects.toThrow(UI_TEXT.scheduleV2.runtime.unavailable)
        if (hasManager) {
          const check = backgroundProcessRunner(process.env)
          const active = await check('systemctl', ['--user', 'is-active', `${shapeId}.timer`])
          expect(active.exitCode).not.toBe(0)
        }
      } finally {
        await rm(shapeDir, { recursive: true, force: true })
      }
    }
    const runNative = backgroundProcessRunner(process.env)
    const manager = await runNative('systemctl', ['--user', 'show-environment'])
    // Without a user manager there is no systemd path to plant into or assert on.
    if (manager.exitCode !== 0) return
    // The planting case needs the manager's absolute runtime directory: an
    // unset variable falls back to `/run/user/<uid>` inside systemd, while
    // the empty and relative shapes are refused by the loop above.
    const configured = process.env['XDG_RUNTIME_DIR']
    const runtimeDir =
      configured === undefined || configured === '' ? `/run/user/${String(uid)}` : configured
    if (!path.posix.isAbsolute(runtimeDir)) return
    const directory = await mkdtemp(path.join(runtimeDir, 'm115-native-'))
    const id = backgroundRegistrationId(directory)
    const dropDirectory = path.join(runtimeDir, 'systemd', 'user', `${id}.service.d`)
    try {
      const verifier = nativeFixtureVerifier(uid)
      const files = nodeBackgroundFiles(verifier)
      const agentFile = path.join(directory, 'agent.js')
      await writeFile(agentFile, 'process.exitCode = 0', { mode: 0o600 })
      // Hosted runners keep node in a world-writable tool cache
      // (/opt/hostedtoolcache), which production rightly refuses as the
      // launcher before it reaches the drop-in; launch a private copy instead.
      const launcher = path.join(directory, 'node')
      await copyFile(process.execPath, launcher)
      await chmod(launcher, 0o700)
      // Create only what is missing and chmod only what this fixture created:
      // pre-existing system directories keep their own modes.
      for (const dir of [path.dirname(path.dirname(dropDirectory)), path.dirname(dropDirectory)]) {
        try {
          await mkdir(dir, { mode: 0o700 })
        } catch (error: unknown) {
          if (
            typeof error !== 'object' ||
            error === null ||
            !('code' in error) ||
            error.code !== 'EEXIST'
          )
            throw error
          continue
        }
        await chmod(dir, 0o700)
      }
      await mkdir(dropDirectory, { mode: 0o700 })
      await chmod(dropDirectory, 0o777)
      const deps: NativeBackgroundDeps = {
        platform: 'linux',
        homeDir: directory,
        dataDir: directory,
        executable: launcher,
        agentFile,
        uid,
        effectiveUid: uid,
        isWakeProcess: false,
        now: Date.now,
        files,
        authorization: () => Promise.resolve({ scheduledPrompts: false }),
        run: runNative,
      }
      const entry = new NativeScheduleBackground(deps)
      const register = () =>
        entry.register(Date.now() + 600_000, { choice: 'yes', decidedAtMs: Date.now() })
      // The deliberately writable drop-in directory itself is the reported
      // refusal: the expectation names it directly and never derives it by
      // executing production's own verifier.
      await expect(register()).rejects.toThrow(dropDirectory)
      const active = await runNative('systemctl', ['--user', 'is-active', `${id}.timer`])
      const enabled = await runNative('systemctl', ['--user', 'is-enabled', `${id}.timer`])
      expect(active.exitCode).not.toBe(0)
      expect(enabled.stdout.trim()).toBe('not-found')
    } finally {
      await runNative('systemctl', ['--user', 'disable', '--now', `${id}.timer`, `${id}.service`])
      for (const extension of ['timer', 'service'])
        await rm(path.join(path.dirname(dropDirectory), `${id}.${extension}`), { force: true })
      await rm(dropDirectory, { recursive: true, force: true })
      await rm(directory, { recursive: true, force: true })
      await runNative('systemctl', ['--user', 'daemon-reload'])
    }
  })
  it('verifies missing systemd directory ancestry and rejects links, wrong kinds and unsafe ancestors', async () => {
    if (process.platform === 'win32') return
    const directory = await mkdtemp(path.join(os.tmpdir(), 'm115-search-'))
    try {
      const missing = path.join(directory, 'absent', 'unit.service.d')
      const verify = vi.fn().mockResolvedValue({ ok: true, path: directory })
      await trustedBackgroundPath(missing, 'linux', 1000, { verify }, 'search-directory')
      expect(verify).toHaveBeenCalledWith(directory, { leafKind: 'directory' })
      verify.mockResolvedValue({ refused: true, component: directory, reason: 'untrusted writer' })
      await expect(
        trustedBackgroundPath(missing, 'linux', 1000, { verify }, 'search-directory'),
      ).rejects.toThrow(directory)
      await expect(
        trustedBackgroundPath(missing, 'linux', 1000, undefined, 'search-directory'),
      ).rejects.toThrow(missing)
      const linked = path.join(directory, 'linked')
      await symlink(directory, linked, 'junction')
      verify.mockImplementation(async (file: string) => {
        const info = await lstat(file)
        return info.isSymbolicLink() || !info.isDirectory()
          ? { refused: true, component: file, reason: 'link or wrong kind' }
          : { ok: true, path: file }
      })
      await expect(
        trustedBackgroundPath(
          path.join(linked, 'missing'),
          'linux',
          1000,
          { verify },
          'search-directory',
        ),
      ).rejects.toThrow(linked)
      const plainFile = path.join(directory, 'plain')
      await writeFile(plainFile, 'fixture')
      await expect(
        trustedBackgroundPath(plainFile, 'linux', 1000, { verify }, 'search-directory'),
      ).rejects.toThrow(plainFile)
      await expect(
        trustedBackgroundPath(
          path.join(plainFile, 'missing'),
          'linux',
          1000,
          { verify },
          'search-directory',
        ),
      ).rejects.toThrow(plainFile)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('uses the shared TrustedPathVerifier for launchers and definitions and refuses missing POSIX bindings', async () => {
    const verify = vi.fn().mockResolvedValue({ ok: true, path: '/canonical/node' })
    const port = { verify }
    expect(await trustedBackgroundPath('/named/node', 'linux', 1000, port)).toBe('/canonical/node')
    expect(verify).toHaveBeenCalledWith('/named/node', { leafKind: 'file' })
    await trustedBackgroundPath('/private', 'darwin', 1000, port, 'directory')
    expect(verify).toHaveBeenCalledWith('/private', { leafKind: 'directory' })
    verify.mockResolvedValue({ refused: true, component: '/writable', reason: 'unsafe ancestor' })
    await expect(trustedBackgroundPath('/named/node', 'linux', 1000, port)).rejects.toThrow(
      '/writable',
    )
    await expect(trustedBackgroundPath('/node', 'linux', 1000)).rejects.toThrow('/node')
  })
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
  it('disables macOS and its record before retirement and refuses rearm without unloading a running wake', async () => {
    const { entry, run, state, files, deps } = setup('darwin')
    state.wakeActive = true
    await expect(entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow()
    expect(files.size).toBe(0)
    state.wakeActive = false
    await entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })
    await expect(entry.remove()).rejects.toThrow(
      UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable,
    )
    await expect(verifyRegisteredWake(deps)).rejects.toThrow('background-wake.json')
    expect(run.mock.calls.some(([, args]) => args[0] === 'bootout')).toBe(false)
    state.now += 60_000
    const originalRun = run.getMockImplementation()!
    run.mockImplementation((file, args) =>
      args[0] === 'print'
        ? Promise.resolve(result(0, 'state = running\n pid = 123\n'))
        : originalRun(file, args),
    )
    await expect(entry.remove()).rejects.toThrow(
      UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable,
    )
    await expect(entry.register(121_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow()
    expect(run.mock.calls.some(([, args]) => args[0] === 'bootout')).toBe(false)
  })
  it('keeps a pid/start-identity lock while live, bounds retry and removes it only after exit or pid reuse', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'm115-wake-lock-'))
    try {
      const lock = path.join(directory, 'background-wakes', '123-fixture.json')
      const files = nodeBackgroundFiles()
      // This tests lock reading/identity/removal; durable publication is covered
      // separately. Avoid repeated fsyncs competing with CI's bundle builds.
      await mkdir(path.dirname(lock))
      await writeFile(lock, JSON.stringify({ pid: 123, startIdentity: 'start-a' }))
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
      await writeFile(lock, JSON.stringify({ pid: 123, startIdentity: 'start-a' }))
      identity.mockResolvedValueOnce('start-a').mockResolvedValue(undefined)
      await waitForScheduleWake(directory, { now: () => now, pause, identity })
      expect(await files.read(lock)).toBeUndefined()
      await writeFile(lock, '{invalid')
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
      if (platform === 'darwin') {
        await expect(entry.register(121_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow(
          UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable,
        )
        state.now += 60_000
      }
      await entry.register(181_000, { choice: 'yes', decidedAtMs: 1000 })
      const rearmed = await entry.status()
      expect(rearmed.nextWakeAtMs).toBe(platform === 'darwin' ? 240_000 : 181_000)
      if (platform === 'linux')
        expect(run).toHaveBeenCalledWith('systemctl', [
          '--user',
          'restart',
          expect.stringContaining('.timer'),
        ])
      if (platform === 'darwin') {
        await expect(entry.remove()).rejects.toThrow(
          UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable,
        )
        expect(await entry.status()).toEqual({ registered: true })
        state.now += 60_000
        await entry.remove()
      } else await entry.remove()
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
