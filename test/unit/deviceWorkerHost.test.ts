import { readFile, readdir, mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import {
  DeviceWorkerHost,
  DeviceWorkerHostError,
  type DeviceWorkerAttempt,
  type DeviceWorkerHostDeps,
  type DeviceWorkerJob,
} from '../../src/host/devices/deviceWorkerHost'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { deviceWorkerNative } from '../../src/host/backend/deviceWorkerNative'
import type { RunProgram } from '../../src/host/processTree'
import type { DeviceDispatch } from '../../src/shared/devices'
import { AttemptJournal } from '../../src/core/devices/attemptJournal'
import { DeviceReceiver } from '../../src/host/devices/deviceReceiver'
import { deviceCheck, deviceGrant } from './helpers/deviceFixtures'
import { executionProtection, signedDispatch } from './helpers/deviceExecutionFixtures'

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
function admittedRequest(attemptDigit: string, processes: number): DeviceDispatch {
  return {
    ...request,
    identity: { ...request.identity, attemptId: attemptDigit.repeat(32) },
    caps: { ...request.caps, processes },
  }
}
function attemptOf(sent: DeviceDispatch): DeviceWorkerAttempt {
  return { identity: sent.identity, caps: sent.caps }
}
const fakeCompile: RunProgram = async (_file, args) => {
  const output = args.find((arg) => arg.startsWith('/out:'))
  if (output !== undefined) await writeFile(output.slice('/out:'.length), 'fake test helper')
  return ''
}
const selfTestAnswer = { jobProbe: true, query: true, power: 'unknown', scheduler: 'untested' }
/** The real Windows driver over a fake compiled helper: compile and self-test succeed. */
function fakeHelperDriver(
  directory: string,
  respond: (args: readonly string[]) => Promise<string>,
) {
  const run: RunProgram = (_file, args) =>
    args[0] === '--self-test' ? Promise.resolve(JSON.stringify(selfTestAnswer)) : respond(args)
  return nativeDriver(directory, run, fakeCompile)
}
function nativeDriver(directory: string, run: RunProgram, compile?: RunProgram) {
  return deviceWorkerNative({
    storageDir: directory,
    systemRoot: '',
    sourceFile: path.resolve('native/windows/MuseSparkDeviceWorker.cs'),
    environment: {},
    run,
    ...(compile !== undefined && { compile }),
  })
}
/** The real phase-1 receiver and journal over this host. */
async function throughReceiver(
  host: DeviceWorkerHost,
  body: (receiver: DeviceReceiver, journal: AttemptJournal) => Promise<void>,
): Promise<void> {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(), 'm100-worker-receiver-')))
  try {
    const journal = await AttemptJournal.create(
      path.join(parent, 'durable'),
      { assertOwner: () => Promise.resolve() },
      executionProtection,
    )
    const grant = deviceGrant('a'.repeat(32))
    const receiver = await DeviceReceiver.open(grant.offer.receiverIncarnationId, journal, host, {
      currentGrant: () => Promise.resolve(grant),
      assertAllowed: () => Promise.resolve(),
      approve: () => Promise.resolve(true),
      paidGate: { isOn: () => true },
      paidConsent: { allows: () => Promise.resolve(true) },
      assertPaidBinding: () => Promise.resolve(),
    })
    receiver.resumeQueue()
    await body(receiver, journal)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
}
async function inStorage(body: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'm100-worker-caps-'))
  try {
    await body(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
const helperRequestSchema = z.object({ cwd: z.string(), maxProcesses: z.number() })

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
    expect(f.deps.driver.launch).toHaveBeenCalledWith(
      expect.anything(),
      recorded,
      attemptOf(request),
    )
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
    // Nothing ran: the reservation settles as refused, never as retired work.
    expect(await attempt.retirement).toEqual({ refused: true, usage })
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
    expect(await attempt.retirement).toEqual({ refused: true, usage })
  })
  it('refuses launches after a failed helper self-test without fallback', async () => {
    const f = fixture()
    vi.mocked(f.deps.driver.selfTest).mockResolvedValue(false)
    const attempt = await f.host.admit(request)
    await expect(attempt.start(boundary)).rejects.toMatchObject({ detail: 'helper' })
    expect(f.deps.driver.launch).not.toHaveBeenCalled()
    expect(await attempt.retirement).toEqual({ refused: true, usage })
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
    expect(await attempt.retirement).toEqual({ refused: true, usage })
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
      attemptOf(request),
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
      const native = nativeDriver(directory, run)
      await expect(
        native.launch(
          { executable: 'worker', args: [], cwd: directory, requiredTools: [] },
          {},
          attemptOf(request),
        ),
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
      const native = fakeHelperDriver(directory, (args) => {
        if (args[0] === '--launch') {
          launches += 1
          return Promise.resolve('')
        }
        return Promise.resolve(
          args[0] === '--task-state'
            ? JSON.stringify({ state: 'unknown', lastExitCode: Number('0xc0000142') })
            : '',
        )
      })
      const launch = native.launch(
        { executable: 'worker', args: [], cwd: directory, requiredTools: [] },
        {},
        attemptOf(request),
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
  it('passes each simultaneous attempt only its own validated identity and caps', async () => {
    const f = fixture()
    const narrow = admittedRequest('1', 1)
    const wide = admittedRequest('2', DEVICE_LIMITS.processes)
    const second = Promise.withResolvers<unknown>()
    vi.mocked(f.deps.driver.launch)
      .mockResolvedValueOnce(f.job)
      .mockResolvedValueOnce({ ...f.job, retirement: second.promise })
    const attempts = await Promise.all([f.host.admit(narrow), f.host.admit(wide)])
    await Promise.all(attempts.map((attempt) => attempt.start(boundary)))
    // The fake driver records every launch's third argument.
    const launched = vi.mocked(f.deps.driver.launch).mock.calls.map((call) => call[2])
    expect(launched).toHaveLength(2)
    for (const sent of [narrow, wide])
      expect(
        launched.filter((attempt) => attempt.identity.attemptId === sent.identity.attemptId),
      ).toStrictEqual([attemptOf(sent)])
    for (const attempt of launched) {
      expect(Object.isFrozen(attempt)).toBe(true)
      expect(Object.isFrozen(attempt.identity)).toBe(true)
      expect(Object.isFrozen(attempt.caps)).toBe(true)
    }
    f.retired.resolve(success)
    second.resolve(success)
    expect(await Promise.all(attempts.map((attempt) => attempt.retirement))).toEqual([
      { usage },
      { usage },
    ])
  })
  it('the Windows driver bounds each simultaneous job at its own admitted cap', async () => {
    await inStorage(async (directory) => {
      const written = new Map<string, number>()
      const native = fakeHelperDriver(directory, async (args) => {
        const [verb, operand] = args
        if (verb === '--launch' && operand !== undefined) {
          const sent = helperRequestSchema.parse(JSON.parse(await readFile(operand, 'utf8')))
          written.set(sent.cwd, sent.maxProcesses)
          await writeFile(path.join(path.dirname(operand), 'ready.json'), JSON.stringify(query))
        }
        if (verb === '--stop' && operand !== undefined)
          await writeFile(
            path.join(directory, 'device-workers', operand, 'result.json'),
            JSON.stringify({ exitCode: 1, stdout: '', failure: 'none' }),
          )
        return ''
      })
      const launch = (cwd: string, sent: DeviceDispatch) =>
        native.launch(
          { executable: 'worker', args: [], cwd, requiredTools: [] },
          {},
          attemptOf(sent),
        )
      const jobs = await Promise.all([
        launch('narrow', admittedRequest('1', 1)),
        launch('wide', admittedRequest('2', DEVICE_LIMITS.processes)),
      ])
      expect(Object.fromEntries(written)).toEqual({ narrow: 1, wide: DEVICE_LIMITS.processes })
      for (const job of jobs) {
        await job.cancel()
        await job.retirement
        await job.remove()
      }
      expect(await readdir(path.join(directory, 'device-workers'))).toEqual([])
    })
  })
  it.each([0, DEVICE_LIMITS.processes + 1])(
    'the Windows driver refuses an admitted process cap of %s before any helper call',
    async (processes) => {
      await inStorage(async (directory) => {
        const run = vi.fn(() => Promise.resolve(''))
        const native = nativeDriver(directory, run)
        await expect(
          native.launch(
            { executable: 'worker', args: [], cwd: directory, requiredTools: [] },
            {},
            { identity: request.identity, caps: { ...request.caps, processes } },
          ),
        ).rejects.toMatchObject({ reason: 'unsupported-host', detail: 'preflight' })
        expect(run).not.toHaveBeenCalled()
        expect(await readdir(directory)).toEqual([])
      })
    },
  )
  it('an admitted zero-process attempt is refused before launch or activation', async () => {
    await inStorage(async (directory) => {
      const f = fixture()
      const verbs: string[] = []
      const driver = fakeHelperDriver(directory, (args) => {
        verbs.push(args[0] ?? '')
        return Promise.resolve(args[0] === '--query' ? JSON.stringify(query) : '')
      })
      const attempt = await new DeviceWorkerHost({ ...f.deps, driver }).admit(
        admittedRequest('1', 0),
      )
      await expect(attempt.start(boundary)).rejects.toMatchObject({
        reason: 'unsupported-host',
        message: UI_TEXT.devices.unsupportedHost,
      })
      expect(verbs).toEqual(['--query'])
      expect(await attempt.retirement).toEqual({ refused: true, usage })
    })
  })
  it.each([
    [
      'a failed helper self-test',
      0,
      (f: ReturnType<typeof fixture>) => {
        vi.mocked(f.deps.driver.selfTest).mockResolvedValue(false)
      },
    ],
    [
      'a failed hook preflight',
      0,
      (f: ReturnType<typeof fixture>) => {
        vi.mocked(f.deps.resolveTool!).mockImplementation((name) =>
          name === 'gitleaks'
            ? Promise.reject(new DeviceWorkerHostError('preflight'))
            : Promise.resolve(name),
        )
      },
    ],
    [
      'a scheduler startup heap failure at launch',
      1,
      (f: ReturnType<typeof fixture>) => {
        vi.mocked(f.deps.driver.launch).mockRejectedValue(new DeviceWorkerHostError('desktop-heap'))
      },
    ],
    [
      'an unenforceable admitted cap at launch',
      1,
      (f: ReturnType<typeof fixture>) => {
        vi.mocked(f.deps.driver.launch).mockRejectedValue(new DeviceWorkerHostError('preflight'))
      },
    ],
  ])(
    'the receiver journals %s as refused not-run work and releases it once',
    async (_failure, launches, inject) => {
      const f = fixture()
      inject(f)
      await throughReceiver(f.host, async (receiver, journal) => {
        const signed = signedDispatch(request)
        // A late failure cannot claim that admission never happened; the journal says what ran.
        const reply = await receiver.dispatch(signed)
        expect(reply.body).toEqual({ kind: 'failure', reason: 'uncertain' })
        await vi.waitFor(() => {
          expect(f.reservation.release).toHaveBeenCalledOnce()
        })
        const occupied = Object.fromEntries(Object.keys(request.caps).map((name) => [name, 0]))
        expect(await journal.lookup(signed.identity)).toMatchObject({
          kind: 'receiver-record',
          outcome: { state: 'refused', occupied, usage },
        })
        expect(f.deps.driver.launch).toHaveBeenCalledTimes(launches)
        expect(f.job.activate).not.toHaveBeenCalled()
        const [reconciled] = await receiver.reconcile([signed.identity])
        expect(reconciled?.body).toMatchObject({
          kind: 'reconciled',
          outcomes: [{ state: 'refused', usage }],
        })
      })
    },
  )
  it.each([
    [{ launch: true, query: true, power: 'unknown' }, false],
    [{ ...selfTestAnswer, scheduler: 'qualified' }, false],
    [selfTestAnswer, true],
  ])('a helper self-test answer of %j is accepted: %s', async (answer, isAccepted) => {
    const run: RunProgram = (_file, args) =>
      Promise.resolve(args[0] === '--self-test' ? JSON.stringify(answer) : '')
    await inStorage(async (directory) => {
      // Only the in-process job probe is claimed; the scheduler is never reported as tested.
      expect(await nativeDriver(directory, run, fakeCompile).selfTest()).toBe(isAccepted)
    })
  })
  it("compiles with compileJob's own runner, never the frame-deadline helper runner", async () => {
    await inStorage(async (directory) => {
      const run = vi.fn<RunProgram>(() => Promise.resolve(JSON.stringify(selfTestAnswer)))
      // No compiler at this system root: the default compiler fails closed without `run`.
      expect(await nativeDriver(directory, run).selfTest()).toBe(false)
      expect(run).not.toHaveBeenCalled()
      const compile = vi.fn(fakeCompile)
      expect(await nativeDriver(directory, run, compile).selfTest()).toBe(true)
      expect(compile).toHaveBeenCalledOnce()
      expect(run.mock.calls.map((call) => call[1][0])).toEqual(['--self-test'])
    })
  })
})
