import { copyFile, mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  NativeScheduleBackground,
  type BackgroundProcessResult,
} from '../../src/runtime/schedules/nativeBackground'
import {
  backgroundProcessRunner,
  nodeBackgroundFiles,
} from '../../src/runtime/schedules/nodeBackgroundIo'
import { UI_TEXT } from '../../src/shared/constants'

function result(exitCode = 0, stdout = '', stderr = ''): BackgroundProcessResult {
  return { exitCode, stdout, stderr }
}
function setup(platform: NodeJS.Platform) {
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
          ? result(1, JSON.stringify('S-1-5-21-1-2-3-1000'))
          : result(0, JSON.stringify(state.invalidOwner ? 'invalid' : 'S-1-5-21-1-2-3-1000')),
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
      const registered = state.registered ? result(0, 'enabled') : result(1, 'disabled')
      return Promise.resolve(state.queryFails ? result(1) : registered)
    }
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
  const entry = new NativeScheduleBackground({
    platform,
    isWakeProcess: false,
    homeDir: isWindows ? String.raw`C:\Users\rig` : '/home/rig',
    dataDir: isWindows ? String.raw`C:\data` : '/data',
    executable: isWindows ? String.raw`C:\node.exe` : '/usr/bin/node',
    agentFile: isWindows ? String.raw`C:\agent\dist\acp.js` : '/agent/dist/acp.js',
    uid: 1000,
    now: () => 1000,
    files: {
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
  })
  return { entry, files, state, run }
}
describe('native background lifecycle', () => {
  it('refuses self-unloading launchd wake maintenance before changing a file or job', async () => {
    const run = vi.fn(),
      files = { read: vi.fn(), write: vi.fn(), remove: vi.fn() }
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
    await expect(entry.register(61_000, { choice: 'yes', decidedAtMs: 1000 })).rejects.toThrow(
      UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable,
    )
    await expect(entry.remove()).rejects.toThrow(
      UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable,
    )
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
