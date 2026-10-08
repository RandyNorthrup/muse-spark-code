import { readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import {
  DeviceWorkerHost,
  DeviceWorkerHostError,
  type DeviceWorkerHostDeps,
  type DeviceWorkerJob,
} from '../../src/host/devices/deviceWorkerHost'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { deviceWorkerNative } from '../../src/host/backend/deviceWorkerNative'
import { deviceCheck, deviceGrant } from './helpers/deviceFixtures'

const usage = {
  settlementId: 'a'.repeat(32),
  payer: 'local',
  certainty: 'known',
  inputTokens: 0,
  outputTokens: 0,
  returnedUsd: 0,
  retainedLiabilityUsd: 0,
} as const
const request = deviceCheck(deviceGrant('a'.repeat(32)))
const boundary = {
  beforeAction: vi.fn(() => Promise.resolve()),
  beforePaidUse: vi.fn(() => Promise.resolve()),
}
const context = { session: 1, station: 'WinSta0', desktop: 'Default' }
const query = {
  context,
  power: 'unknown',
  sleepInhibited: false,
  activeProcesses: 0,
  cpu100ns: 0,
  peakMemoryBytes: 0,
} as const
function fixture(platform: NodeJS.Platform = 'win32') {
  const retired = Promise.withResolvers<unknown>()
  const job: DeviceWorkerJob = {
    query: {
      ...query,
      context: { ...context, desktop: 'MuseSparkDevice-private' },
      sleepInhibited: true,
    },
    retirement: retired.promise,
    activate: vi.fn(() => Promise.resolve()),
    cancel: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
  }
  const reservation = {
    usage,
    pause: vi.fn(() => Promise.resolve()),
    release: vi.fn(() => Promise.resolve()),
  }
  const deps: DeviceWorkerHostDeps = {
    environment: {
      PATH: 'verified-tools',
      TEMP: 'private-temp',
      META_API_KEY: 'fixture-not-a-key',
      NODE_OPTIONS: 'untrusted-loader',
      SSH_AUTH_SOCK: 'private',
      RANDOM_UNAPPROVED: 'private',
    },
    driver: {
      platform,
      selfTest: vi.fn(() => Promise.resolve(true)),
      query: vi.fn(() => Promise.resolve(query)),
      launch: vi.fn(() => Promise.resolve(job)),
    },
    retain: vi.fn(() => Promise.resolve()),
    reserve: vi.fn(() => Promise.resolve(reservation)),
    command: vi.fn(() =>
      Promise.resolve({
        executable: 'worker',
        args: [],
        cwd: 'workspace',
        requiredTools: [{ name: 'gitleaks', verify: vi.fn(() => Promise.resolve(true)) }],
      }),
    ),
    recordEnvironment: vi.fn(() => Promise.resolve()),
    pressure: vi.fn(),
    resolveTool: vi.fn((name) => Promise.resolve(name)),
  }
  return { deps, host: new DeviceWorkerHost(deps), retired, job, reservation }
}
const success = { exitCode: 0, failure: 'none', stdout: JSON.stringify({ usage }) }

describe('M100/H worker host', () => {
  it.each(['win32', 'linux', 'darwin'] as const)(
    'reserves without starting on %s and starts exactly once',
    async (platform) => {
      const f = fixture(platform)
      const attempt = await f.host.admit(request)
      expect(f.deps.driver.launch).not.toHaveBeenCalled()
      await attempt.start(boundary)
      await expect(attempt.start(boundary)).rejects.toBeInstanceOf(DeviceWorkerHostError)
      expect(f.deps.driver.launch).toHaveBeenCalledOnce()
      f.retired.resolve(success)
      expect(await attempt.retirement).toEqual({ usage })
    },
  )
  it('refuses launch under the transport session before activation', async () => {
    const f = fixture()
    const bad = { ...f.job, query }
    vi.mocked(f.deps.driver.launch).mockResolvedValue(bad)
    const attempt = await f.host.admit(request)
    await expect(attempt.start(boundary)).rejects.toMatchObject({
      detail: 'context',
      reason: 'unsupported-host',
    })
    expect(f.job.activate).not.toHaveBeenCalled()
    expect(f.job.cancel).toHaveBeenCalled()
    f.retired.resolve(success)
    await attempt.retirement
  })
  it('refuses a noninteractive desktop even if its name differs', async () => {
    const f = fixture()
    vi.mocked(f.deps.driver.launch).mockResolvedValue({
      ...f.job,
      query: { ...query, context: { ...context, session: 0, desktop: 'different' } },
    })
    const attempt = await f.host.admit(request)
    await expect(attempt.start(boundary)).rejects.toMatchObject({ detail: 'context' })
    f.retired.resolve(success)
    await attempt.retirement
  })
  it.each([Number('0xc0000142'), -Number('0x3ffffebe')])(
    'reports desktop heap exit %s without a silent retry or registry write',
    async (exitCode) => {
      const f = fixture()
      const registryWrite = vi.fn()
      const attempt = await f.host.admit(request)
      await attempt.start(boundary)
      f.retired.resolve({ exitCode, failure: 'none', stdout: '' })
      await expect(attempt.retirement).rejects.toMatchObject({
        reason: 'unsupported-host',
        detail: 'desktop-heap',
        message: UI_TEXT.devices.desktopHeap,
      })
      expect(f.deps.driver.launch).toHaveBeenCalledOnce()
      expect(f.deps.pressure).toHaveBeenCalledExactlyOnceWith('desktop-heap')
      expect(registryWrite).not.toHaveBeenCalled()
      const native = await readFile('native/windows/MuseSparkDeviceWorker.cs', 'utf8')
      expect(native).not.toMatch(/(?:Microsoft\.Win32\.Registry|RegSetValue|Set-ExecutionPolicy)/)
    },
  )
  it('records only the explicit credential-free environment', async () => {
    const f = fixture()
    const attempt = await f.host.admit(request)
    await attempt.start(boundary)
    const recorded = vi.mocked(f.deps.recordEnvironment).mock.calls[0]?.[1]
    expect(recorded).toMatchObject({
      PATH: 'verified-tools',
      TEMP: 'private-temp',
      GIT_TERMINAL_PROMPT: '0',
    })
    expect(recorded).not.toHaveProperty('META_API_KEY')
    expect(recorded).not.toHaveProperty('NODE_OPTIONS')
    expect(recorded).not.toHaveProperty('SSH_AUTH_SOCK')
    expect(recorded).not.toHaveProperty('RANDOM_UNAPPROVED')
    expect(f.deps.driver.launch).toHaveBeenCalledWith(expect.anything(), recorded)
    f.retired.resolve(success)
    await attempt.retirement
  })
  it('stripping the hook tool from PATH fails preflight before start', async () => {
    const f = fixture()
    vi.mocked(f.deps.resolveTool!).mockImplementation((name) =>
      name === 'gitleaks'
        ? Promise.reject(new DeviceWorkerHostError('preflight'))
        : Promise.resolve(name),
    )
    const attempt = await f.host.admit(request)
    await expect(attempt.start(boundary)).rejects.toMatchObject({ detail: 'preflight' })
    expect(f.deps.driver.launch).not.toHaveBeenCalled()
    expect(f.deps.recordEnvironment).not.toHaveBeenCalled()
    await attempt.retirement
  })
  it('rejects an unverified hook tool before start', async () => {
    const f = fixture()
    vi.mocked(f.deps.command).mockResolvedValue({
      executable: 'worker',
      args: [],
      cwd: 'workspace',
      requiredTools: [{ name: 'gitleaks', verify: () => Promise.resolve(false) }],
    })
    const attempt = await f.host.admit(request)
    await expect(attempt.start(boundary)).rejects.toMatchObject({ detail: 'preflight' })
    expect(f.deps.driver.launch).not.toHaveBeenCalled()
  })
  it('refuses launches after a failed helper self-test without fallback', async () => {
    const f = fixture()
    vi.mocked(f.deps.driver.selfTest).mockResolvedValue(false)
    const attempt = await f.host.admit(request)
    await expect(attempt.start(boundary)).rejects.toMatchObject({ detail: 'helper' })
    expect(f.deps.driver.launch).not.toHaveBeenCalled()
  })
  it('does not treat cancellation or direct-parent exit as retirement', async () => {
    const f = fixture()
    const attempt = await f.host.admit(request)
    await attempt.start(boundary)
    await attempt.cancel()
    await expect(attempt.release()).rejects.toMatchObject({ detail: 'result' })
    expect(f.reservation.release).not.toHaveBeenCalled()
    f.retired.resolve(success)
    await attempt.retirement
    await attempt.release()
    await attempt.release()
    expect(f.reservation.release).toHaveBeenCalledOnce()
    await vi.waitFor(() => {
      expect(f.job.remove).toHaveBeenCalledOnce()
    })
  })
  it('releases sleep inhibition on last retirement with overlapping attempts', async () => {
    const f = fixture()
    vi.mocked(f.deps.driver.query).mockResolvedValue({
      ...query,
      power: 'battery',
      sleepInhibited: true,
    })
    const second = Promise.withResolvers<unknown>()
    vi.mocked(f.deps.driver.launch)
      .mockResolvedValueOnce(f.job)
      .mockResolvedValueOnce({ ...f.job, retirement: second.promise })
    const a = await f.host.admit(request)
    const b = await f.host.admit(request)
    await a.start(boundary)
    await b.start(boundary)
    expect(await f.host.facts()).toEqual({ power: 'battery', sleepInhibited: true })
    f.retired.resolve(success)
    await a.retirement
    const activeFacts = await f.host.facts()
    expect(activeFacts.sleepInhibited).toBe(true)
    second.resolve(success)
    await b.retirement
    const retiredFacts = await f.host.facts()
    expect(retiredFacts.sleepInhibited).toBe(false)
  })
  it('helper death releases sleep facts but retains uncertain occupancy', async () => {
    const f = fixture()
    const attempt = await f.host.admit(request)
    await attempt.start(boundary)
    f.retired.reject(new DeviceWorkerHostError('result'))
    await expect(attempt.retirement).rejects.toMatchObject({ reason: 'uncertain' })
    await expect(attempt.release()).rejects.toMatchObject({ reason: 'uncertain' })
    expect(await f.host.facts()).toEqual({ power: 'unknown', sleepInhibited: false })
    expect(f.job.remove).not.toHaveBeenCalled()
  })
  it('power read failure is unknown', async () => {
    const f = fixture()
    vi.mocked(f.deps.driver.query).mockRejectedValue(new Error('power unavailable'))
    expect(await f.host.facts()).toEqual({ power: 'unknown', sleepInhibited: false })
  })
  it('rejects malformed structured result and oversized output', async () => {
    for (const stdout of [
      'warning: banner\n' + success.stdout,
      JSON.stringify({ usage: { ...usage, retainedLiabilityUsd: -1 } }),
      success.stdout + ' '.repeat(DEVICE_LIMITS.frameBytes),
    ]) {
      const f = fixture()
      const attempt = await f.host.admit(request)
      await attempt.start(boundary)
      f.retired.resolve({ ...success, stdout })
      await expect(attempt.retirement).rejects.toBeInstanceOf(Error)
    }
  })
  it('cancels a reservation before start without launching', async () => {
    const f = fixture()
    const attempt = await f.host.admit(request)
    await attempt.cancel()
    await attempt.retirement
    await attempt.release()
    await expect(attempt.start(boundary)).rejects.toBeInstanceOf(DeviceWorkerHostError)
    expect(f.deps.driver.launch).not.toHaveBeenCalled()
  })
  it('sets PowerShell policy per process and disables stdin formatting with Windows paths', async () => {
    const f = fixture()
    vi.mocked(f.deps.command).mockResolvedValue({
      executable: String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
      args: ['-File', 'worker.ps1'],
      cwd: 'workspace',
      requiredTools: [],
    })
    const attempt = await f.host.admit(request)
    await attempt.start(boundary)
    expect(f.deps.driver.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-InputFormat',
          'None',
          '-File',
          'worker.ps1',
        ],
      }),
      expect.anything(),
    )
    f.retired.resolve(success)
    await attempt.retirement
  })
  it('cancellation while launch is pending prevents activation', async () => {
    const f = fixture()
    const launching = Promise.withResolvers<DeviceWorkerJob>()
    vi.mocked(f.deps.driver.launch).mockReturnValue(launching.promise)
    const attempt = await f.host.admit(request)
    const start = attempt.start(boundary)
    const failed = expect(start).rejects.toMatchObject({ detail: 'helper' })
    await vi.waitFor(() => {
      expect(f.deps.driver.launch).toHaveBeenCalledOnce()
    })
    await attempt.cancel()
    launching.resolve(f.job)
    await failed
    expect(f.job.activate).not.toHaveBeenCalled()
    f.retired.resolve(success)
    await attempt.retirement
  })
  it('an empty real PATH refuses the hook tool before any launch', async () => {
    const f = fixture(process.platform)
    const deps = { ...f.deps, environment: { PATH: '' } }
    delete deps.resolveTool
    vi.mocked(deps.command).mockResolvedValue({
      executable: process.execPath,
      args: [],
      cwd: process.cwd(),
      requiredTools: [{ name: 'm100-missing-hook-tool', verify: () => Promise.resolve(true) }],
    })
    const attempt = await new DeviceWorkerHost(deps).admit(request)
    await expect(attempt.start(boundary)).rejects.toMatchObject({ detail: 'preflight' })
    expect(deps.driver.launch).not.toHaveBeenCalled()
  })
  it('retained attempt directories stop allocation at the shared cap', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'm100-worker-cap-'))
    const run = vi.fn(() => Promise.resolve(''))
    try {
      const root = path.join(directory, 'device-workers')
      await mkdir(root)
      await Promise.all(
        Array.from({ length: DEVICE_LIMITS.unresolvedAttempts }, (_, index) =>
          mkdir(path.join(root, String(index))),
        ),
      )
      const native = deviceWorkerNative({
        storageDir: directory,
        systemRoot: '',
        sourceFile: path.resolve('native/windows/MuseSparkDeviceWorker.cs'),
        environment: {},
        run,
      })
      await expect(
        native.launch({ executable: 'worker', args: [], cwd: directory, requiredTools: [] }, {}),
      ).rejects.toMatchObject({ reason: 'capacity' })
      expect(run).not.toHaveBeenCalled()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('a scheduler startup heap failure is typed and never relaunched', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'm100-worker-startup-'))
    let launches = 0
    vi.useFakeTimers()
    try {
      const native = deviceWorkerNative({
        storageDir: directory,
        systemRoot: '',
        sourceFile: path.resolve('native/windows/MuseSparkDeviceWorker.cs'),
        environment: {},
        run: async (_file, args) => {
          const output = args.find((arg) => arg.startsWith('/out:'))
          if (output !== undefined) {
            await writeFile(output.slice('/out:'.length), 'fake test helper')
            return ''
          }
          if (args[0] === '--self-test')
            return JSON.stringify({ launch: true, query: true, power: 'unknown' })
          if (args[0] === '--launch') {
            launches += 1
            return ''
          }
          return args[0] === '--task-state'
            ? JSON.stringify({ state: 'unknown', lastExitCode: Number('0xc0000142') })
            : ''
        },
      })
      const launch = native.launch(
        { executable: 'worker', args: [], cwd: directory, requiredTools: [] },
        {},
      )
      const refused = expect(launch).rejects.toMatchObject({
        detail: 'desktop-heap',
        reason: 'unsupported-host',
      })
      await vi.waitFor(() => {
        expect(launches).toBe(1)
      })
      await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.frameDeadlineMs)
      await refused
      expect(launches).toBe(1)
    } finally {
      vi.useRealTimers()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
