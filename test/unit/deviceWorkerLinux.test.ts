import { ChildProcess, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deviceWorkerLinux } from '../../src/host/backend/deviceWorkerLinux'
import {
  selectDeviceWorkerDriver,
  DeviceWorkerHost,
  DeviceWorkerHostError,
  type DeviceWorkerJob,
} from '../../src/host/devices/deviceWorkerHost'
import { workerEnvironment } from '../../src/core/team/refFence'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { deviceCheck, deviceGrant } from './helpers/deviceFixtures'
import { DeviceReceiver } from '../../src/host/devices/deviceReceiver'
import { executionUsage, useExecutionFixture } from './helpers/deviceExecutionFixtures'
import { launchedJob } from './helpers/deviceWorkerReceiver'

function wrongPlatformFactory(): never {
  throw new Error('wrong platform factory')
}

const request = deviceCheck(deviceGrant('a'.repeat(32)))
const environment: Record<string, string> = {}
const environmentEntries = Object.entries(
  workerEnvironment({ PATH: '/usr/bin:/bin', HOME: '/tmp' }, 'linux'),
)
for (const [key, value] of environmentEntries) {
  if (value !== undefined) environment[key] = value
}
const command = {
  executable: process.execPath,
  args: ['-e', 'process.stdout.write(JSON.stringify({usage:{}}))'],
  cwd: '/',
  requiredTools: [],
}
const children = new Set<ChildProcessWithoutNullStreams>()
afterEach(() => {
  for (const child of children) child.kill()
  children.clear()
})

/** Readiness churn tests need no OS process: pipes and close events are the boundary. */
function instantChild(isInhibitor: boolean): ChildProcessWithoutNullStreams {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdio: [PassThrough, PassThrough, PassThrough, null, null] = [
    stdin,
    stdout,
    stderr,
    null,
    null,
  ]
  const child = Object.assign(new ChildProcess(), { stdin, stdout, stderr, stdio })
  vi.spyOn(stdout, 'on').mockImplementation((event, listener) => {
    if (event === 'data' && isInhibitor) listener(Buffer.from('ready'))
    return stdout
  })
  vi.spyOn(stdin, 'end').mockImplementation(() => {
    child.emit('close', 0, null)
    return stdin
  })
  vi.spyOn(child, 'kill').mockImplementation(() => {
    child.emit('close', 0, null)
    return true
  })
  return child
}
function fixture(isInstant = false) {
  const supplies: string[] = []
  const units: string[] = []
  const state = {
    isEmpty: false,
    tasksMax: request.caps.processes,
    isManagerLost: false,
    supplies,
    group: '/user.slice/test.service',
    failRead: false,
    result: 'success',
    kernelLimit: request.caps.processes,
    transport: '/transport.scope',
    units,
    isOrphanStopped: false,
    canStopOrphan: true,
    isOwnerAlive: false,
    isOwnerReused: false,
    isOwnerUnreadable: false,
    canStopUnit: true,
    isStopRefused: false,
    readinessFailures: 0,
    areUnitsAbsent: false,
    isLauncherStuck: false,
    failProcs: false,
  }
  // The manager's view: a stopped unit, or an inhibitor whose client closed, shows no cgroup.
  const goneUnits = new Set<string>()
  const calls: { file: string; args: readonly string[]; env: NodeJS.ProcessEnv }[] = []
  let worker: ChildProcessWithoutNullStreams | undefined
  let inhibitor: ChildProcessWithoutNullStreams | undefined
  // The first real worker child's own exit event, awaited instead of polled.
  const firstWorkerExit = Promise.withResolvers<number | null>()
  const start = vi.fn((file: string, args: readonly string[], env: NodeJS.ProcessEnv) => {
    calls.push({ file, args, env })
    const isInhibitor = args.includes('/usr/bin/systemd-inhibit')
    const name = args.find((arg) => arg.startsWith('--unit='))?.slice('--unit='.length) ?? ''
    const collect = (child: ChildProcessWithoutNullStreams) => {
      if (isInhibitor) child.once('close', () => goneUnits.add(name))
      return child
    }
    if (isInstant) {
      const child = collect(instantChild(isInhibitor))
      // A launcher that never ends, so it could still submit its unit.
      if (!isInhibitor && state.isLauncherStuck) vi.spyOn(child, 'kill').mockReturnValue(true)
      if (isInhibitor) inhibitor = child
      else worker = child
      return child
    }
    const gate = `process.stdout.write('ready');process.stdin.once('data',()=>process.exit(0));process.stdin.on('end',()=>process.exit(0))`
    const commandIndex = args.indexOf('device-worker')
    const target = args.slice(commandIndex + 1)
    const isProbe = target[0] === '/bin/sh' && target.at(-1) === 'printf probe'
    const targetArgs = isProbe ? [process.execPath, '-e', "process.stdout.write('probe')"] : target
    const script = String.raw`process.stdin.once('data',b=>{if(b.toString()!=='go\n')process.exit(1);const child=require('node:child_process').spawn(${JSON.stringify(targetArgs[0])},${JSON.stringify(targetArgs.slice(1))},{stdio:['ignore','inherit','inherit']});child.once('exit',c=>process.exit(c??1))})`
    const child = spawn(process.execPath, ['-e', isInhibitor ? gate : script], {
      stdio: 'pipe',
      env: {},
    })
    children.add(collect(child))
    if (!isInhibitor) child.once('exit', firstWorkerExit.resolve)
    if (isInhibitor) inhibitor = child
    else worker = child
    return child
  })
  const run = vi.fn((_file: string, args: readonly string[]) => {
    if (state.isManagerLost) return Promise.reject(new Error('manager lost'))
    if (args.includes('list-units'))
      return Promise.resolve(JSON.stringify(state.units.map((unit) => ({ unit }))))
    const name = args[2] ?? ''
    const isWorkerUnit = name.endsWith('.service') && !state.units.includes(name)
    if (isWorkerUnit && state.isStopRefused && args.includes('stop'))
      return Promise.reject(new Error('stop refused'))
    const isReadinessShow = isWorkerUnit && args[1] === 'show' && !name.endsWith('-inhibit.service')
    if (isReadinessShow && state.readinessFailures > 0) {
      state.readinessFailures -= 1
      return Promise.reject(new Error('manager query failed'))
    }
    if (
      state.canStopOrphan &&
      args.includes('stop') &&
      args.some((arg) => state.units.includes(arg))
    )
      state.isOrphanStopped = true
    if (args.includes('stop')) {
      worker?.kill()
      // Orphans keep their own stop model (canStopOrphan) below.
      if (state.canStopUnit && !state.units.includes(args[2] ?? '')) goneUnits.add(args[2] ?? '')
    }
    const isGone = state.isOrphanStopped || state.areUnitsAbsent || goneUnits.has(args[2] ?? '')
    return args.includes('--property=Version')
      ? Promise.resolve('257\n')
      : Promise.resolve(
          `LoadState=loaded\nActiveState=${isGone ? 'inactive' : 'active'}\nSubState=${isGone ? 'dead' : 'running'}\nControlGroup=${isGone ? '' : state.group}\nTasksMax=${String(state.tasksMax)}\nResult=${state.result}\n`,
        )
  })
  const read = vi.fn((file: string) => {
    if (file.endsWith('/stat') && file.startsWith('/proc/')) {
      if (file !== '/proc/self/stat' && state.isOwnerUnreadable)
        return Promise.reject(Object.assign(new Error('unreadable owner'), { code: 'EACCES' }))
      if (file !== '/proc/self/stat' && !state.isOwnerAlive)
        return Promise.reject(Object.assign(new Error('dead owner'), { code: 'ENOENT' }))
      const fields = Array.from({ length: 20 }, () => '0')
      fields[0] = 'S'
      fields[19] = state.isOwnerReused ? '124' : '123'
      return Promise.resolve(`1 (node ) name) ${fields.join(' ')}`)
    }
    if (state.failRead && file.startsWith('/sys/class/power_supply/'))
      return Promise.reject(new Error('unreadable'))
    if (file.endsWith('cgroup.events'))
      return Promise.resolve(`populated ${state.isEmpty ? '0' : '1'}\n`)
    if (file === '/proc/self/cgroup') return Promise.resolve(`0::${state.transport}\n`)
    if (file.endsWith('pids.max')) return Promise.resolve(String(state.kernelLimit))
    if (file.endsWith('pids.current')) return Promise.resolve('1\n')
    if (file.endsWith('cgroup.procs'))
      return state.failProcs
        ? Promise.reject(Object.assign(new Error('unreadable procs'), { code: 'EACCES' }))
        : Promise.resolve('11\n')
    if (file.endsWith('cpu.stat')) return Promise.resolve('usage_usec 12\n')
    if (file.endsWith('memory.peak')) return Promise.resolve('4096\n')
    if (file.endsWith('type'))
      return Promise.resolve(file.includes('BAT0') ? 'Battery\n' : 'Mains\n')
    return file.endsWith('status') ? Promise.resolve('Discharging\n') : Promise.resolve('1\n')
  })
  const driver = deviceWorkerLinux({
    environment: { XDG_RUNTIME_DIR: '/run/user/1000' },
    run,
    start,
    read,
    entries: () => Promise.resolve(state.supplies),
  })
  return {
    state,
    driver,
    calls,
    start,
    run,
    read,
    worker: () => worker,
    firstWorkerExit: firstWorkerExit.promise,
    inhibitor: () => inhibitor,
  }
}
/** Starts the cached self-test probe and waits for its real child to exit. */
async function probing() {
  const f = fixture()
  f.state.tasksMax = 1
  f.state.kernelLimit = 1
  const check = f.driver.selfTest()
  // The real probe child's exit event, inside the case's own deadline: a
  // loaded machine may take longer than a 1 s poll to start it (RVM100J2 2).
  expect(await f.firstWorkerExit).toBe(0)
  return { f, check }
}
async function retire(f: ReturnType<typeof fixture>, job: DeviceWorkerJob) {
  f.state.isEmpty = true
  const result = await job.retirement
  await job.remove()
  return result
}
describe('M100/H Linux platform port (fake manager/cgroup/inhibitor)', () => {
  it.each(['resources', 'tasksMax'])(
    'releases every readiness-failure slot after 200 %s refusals in one factory',
    async (failure) => {
      const f = fixture(true)
      if (failure === 'resources') f.state.result = 'resources'
      else f.state.tasksMax += 1
      // Each stopped, never-activated unit is shown gone by the manager: a proved refusal.
      for (let index = 0; index < 200; index += 1) {
        expect(await f.driver.launch(command, environment, request)).toMatchObject({
          kind: 'refused',
          error: { detail: failure === 'resources' ? 'capacity' : 'preflight' },
        })
        expect(f.start).toHaveBeenCalledTimes((index + 1) * 2)
      }
      expect(await f.driver.launch(command, environment, request)).toMatchObject({
        kind: 'refused',
        error: { detail: failure === 'resources' ? 'capacity' : 'preflight' },
      })
      expect(f.start).toHaveBeenCalledTimes(402)
    },
  )
  it('creates an independently owned, bounded unit with the admitted TasksMax and exact recorded environment', async () => {
    const f = fixture()
    const job = await launchedJob(f.driver.launch(command, environment, request))
    expect(f.calls[1]?.args).toEqual(
      expect.arrayContaining([
        '--user',
        '--collect',
        '--wait',
        '--pipe',
        '--property=ExitType=cgroup',
        '--property=KillMode=control-group',
        `--property=TasksMax=${String(request.caps.processes)}`,
        '--expand-environment=no',
      ]),
    )
    expect(f.calls[1]?.args).toEqual(
      expect.arrayContaining(
        Object.entries(environment).map(([name, value]) => `${name}=${value}`),
      ),
    )
    expect(f.calls[0]?.args).toEqual(
      expect.arrayContaining(['--what=sleep:idle', '--mode=block', '--no-ask-password']),
    )
    const inhibitorUnit = f.calls[0]?.args
      .find((arg) => arg.startsWith('--unit='))
      ?.slice('--unit='.length)
    expect(f.calls[1]?.args).toEqual(
      expect.arrayContaining([
        `--property=BindsTo=${inhibitorUnit ?? ''}`,
        `--property=After=${inhibitorUnit ?? ''}`,
      ]),
    )
    const unit = f.calls[1]?.args.find((arg) => arg.startsWith('--unit=')) ?? ''
    expect(unit).toContain(request.identity.receiverIncarnationId)
    expect(unit).toContain(request.identity.attemptId)
    expect(f.calls[1]?.env['META_API_KEY']).toBeUndefined()
    expect(job.query).toMatchObject({
      context: { station: 'systemd-user', desktop: '/user.slice/test.service' },
      sleepInhibited: true,
      cpu100ns: 120,
      peakMemoryBytes: 4096,
    })
    expect(f.worker()?.stdin.writableEnded).toBe(false)
    await job.activate()
    expect(f.worker()?.stdin.writableEnded).toBe(true)
    expect(await retire(f, job)).toEqual({ exitCode: 0, stdout: '{"usage":{}}', failure: 'none' })
    expect(f.inhibitor()?.exitCode).toBe(0)
  })
  it('keeps retirement and inhibition pending after direct-parent and pipe exit until the cgroup is empty', async () => {
    const f = fixture()
    const job = await launchedJob(f.driver.launch(command, environment, request))
    let isRetired = false
    void job.retirement.then(() => {
      isRetired = true
    })
    await job.activate()
    await vi.waitFor(() => {
      expect(f.worker()?.exitCode).toBe(0)
    })
    await delay(100)
    expect(isRetired).toBe(false)
    expect(f.inhibitor()?.exitCode).toBeNull()
    expect(await f.driver.query()).toMatchObject({ sleepInhibited: true, activeProcesses: 1 })
    await retire(f, job)
    expect(await f.driver.query()).toMatchObject({ sleepInhibited: false, activeProcesses: 0 })
  })
  it('counts distinct processes rather than thread tasks or duplicated PID lines', async () => {
    const f = fixture()
    const job = await launchedJob(f.driver.launch(command, environment, request))
    const read = f.read.getMockImplementation()!
    f.read.mockImplementation((file) =>
      file.endsWith('cgroup.procs') ? Promise.resolve('11\n11\n22\n') : read(file),
    )
    expect(await f.driver.query()).toMatchObject({ activeProcesses: 2 })
    await job.activate()
    await retire(f, job)
  })
  it('cancel and removal cannot prove retirement; helper loss rejects as uncertain', async () => {
    const f = fixture()
    const job = await launchedJob(f.driver.launch(command, environment, request))
    expect(() => job.remove()).toThrow()
    const rejected = expect(job.retirement).rejects.toMatchObject({ reason: 'uncertain' })
    await job.cancel()
    await rejected
    expect(f.run.mock.calls.some(([, args]) => args.includes('stop'))).toBe(true)
    expect(() => job.remove()).toThrow()
    expect(await f.driver.query()).toMatchObject({ sleepInhibited: false, activeProcesses: 1 })
  })
  it.each([0, DEVICE_LIMITS.processes + 1])(
    'refuses an unenforceable cap %s before activation or helper start',
    async (processes) => {
      const f = fixture()
      expect(
        await f.driver.launch(command, environment, {
          ...request,
          caps: { ...request.caps, processes },
        }),
      ).toMatchObject({ kind: 'refused', error: { reason: 'unsupported-host' } })
      expect(f.start).not.toHaveBeenCalled()
      expect(f.run).not.toHaveBeenCalled()
    },
  )
  it.each(['tasksMax', 'kernelLimit'] as const)(
    'refuses when %s differs from the admitted ceiling before activation',
    async (field) => {
      const f = fixture()
      f.state[field] += 1
      expect(await f.driver.launch(command, environment, request)).toMatchObject({
        kind: 'refused',
        error: { reason: 'unsupported-host', detail: 'preflight' },
      })
      expect(f.worker()?.stdin.writableEnded).toBe(false)
      expect(f.inhibitor()?.exitCode).toBe(0)
    },
  )
  it('refuses a unit reported in the transport cgroup before activation', async () => {
    const f = fixture()
    f.state.transport = f.state.group
    expect(await f.driver.launch(command, environment, request)).toMatchObject({
      kind: 'refused',
      error: { reason: 'unsupported-host', detail: 'context' },
    })
    expect(f.worker()?.stdin.writableEnded).toBe(false)
  })
  it('resource pressure is typed with recovery prose, one launch and no silent retry', async () => {
    const f = fixture()
    f.state.result = 'resources'
    expect(await f.driver.launch(command, environment, request)).toMatchObject({
      kind: 'refused',
      error: { reason: 'capacity', detail: 'capacity', message: UI_TEXT.devices.capacityHelp },
    })
    expect(f.start).toHaveBeenCalledTimes(2)
    expect(f.worker()?.stdin.writableEnded).toBe(false)
  })
  it.each([
    [
      'before its retirement observer exists',
      (f: ReturnType<typeof fixture>) => {
        // Readiness reports resource pressure; Stop cannot make the unit gone.
        f.state.result = 'resources'
        f.state.canStopUnit = false
      },
    ],
    [
      'after its retirement observer started',
      (f: ReturnType<typeof fixture>) => {
        // Readiness passes, the final query cannot read the cgroup, and Stop is refused.
        f.state.failProcs = true
        f.state.isStopRefused = true
      },
    ],
  ])(
    'a never-activated unit left unproved %s stays uncertain and keeps its slot',
    async (_case, inject) => {
      const f = fixture(true)
      inject(f)
      for (let index = 0; index < DEVICE_LIMITS.unresolvedAttempts; index += 1) {
        const launched = await f.driver.launch(command, environment, request)
        expect(launched).toMatchObject({ kind: 'uncertain' })
        // No sweep can observe this unit later: the attempt stays uncertain until recovery.
        expect(launched).not.toHaveProperty('reclaimed')
      }
      const starts = f.start.mock.calls.length
      expect(await f.driver.launch(command, environment, request)).toMatchObject({
        kind: 'refused',
        error: { detail: 'capacity' },
      })
      expect(f.start).toHaveBeenCalledTimes(starts)
    },
  )
  it.each([
    ['uncertain while its launcher has not ended', true, 'uncertain'],
    ['refused once its launcher has ended', false, 'refused'],
  ])('absent units after a failed readiness query are %s', async (_case, isLauncherStuck, kind) => {
    const f = fixture(true)
    f.state.readinessFailures = 1
    f.state.isStopRefused = true
    f.state.areUnitsAbsent = true
    f.state.isLauncherStuck = isLauncherStuck
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const launched = f.driver.launch(command, environment, request)
      const isSettled = await Promise.race([
        (async () => {
          await launched
          return true
        })(),
        (async () => {
          await vi.waitFor(() => {
            expect(f.worker()?.kill).toHaveBeenCalled()
          })
          return false
        })(),
      ])
      // The launcher gets the frame deadline to end; a stuck one is never proof.
      if (!isSettled) vi.setSystemTime(Date.now() + DEVICE_LIMITS.frameDeadlineMs)
      expect(await launched).toMatchObject({ kind, error: { detail: 'helper' } })
      expect(f.worker()?.kill).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
    // No activation was ever sent to the worker.
    expect(f.worker()?.stdin.writableEnded).toBe(false)
  })
  it('even a working injected manager cannot launch without its runtime directory', async () => {
    const f = fixture()
    const driver = deviceWorkerLinux({ environment: {}, run: f.run, start: f.start })
    expect(await driver.launch(command, environment, request)).toMatchObject({
      kind: 'refused',
      error: { reason: 'unsupported-host' },
    })
    expect(f.start).not.toHaveBeenCalled()
  })
  it.each([undefined, 'relative'])(
    'missing/invalid runtime directory %s refuses with no fallback',
    async (runtime) => {
      const start = vi.fn(fixture().start)
      const driver = deviceWorkerLinux({
        environment: runtime === undefined ? {} : { XDG_RUNTIME_DIR: runtime },
        start,
      })
      expect(await driver.selfTest()).toBe(false)
      expect(await driver.launch(command, environment, request)).toMatchObject({
        kind: 'refused',
        error: { reason: 'unsupported-host' },
      })
      expect(start).not.toHaveBeenCalled()
    },
  )
  it('manager failure never falls back to a transport spawn', async () => {
    const f = fixture()
    f.state.isManagerLost = true
    expect(await f.driver.launch(command, environment, request)).toMatchObject({
      kind: 'refused',
      error: { reason: 'unsupported-host' },
    })
    expect(f.start).not.toHaveBeenCalled()
    expect(await f.driver.selfTest()).toBe(false)
  })
  it('rejects noncanonical credential and loader variables before starting', async () => {
    const f = fixture()
    expect(
      await f.driver.launch(
        command,
        { ...environment, META_API_KEY: 'fixture-not-a-key', NODE_OPTIONS: 'loader' },
        request,
      ),
    ).toMatchObject({ kind: 'refused', error: { reason: 'unsupported-host' } })
    expect(f.start).not.toHaveBeenCalled()
  })
  it('stderr banners never become structured results and stdin is EOF', async () => {
    const f = fixture()
    const job = await launchedJob(
      f.driver.launch(
        {
          ...command,
          args: [
            '-e',
            'process.stdin.on("data",()=>process.exit(1));process.stdin.on("end",()=>{process.stderr.write("banner");process.stdout.write(JSON.stringify({usage:{}}))})',
          ],
        },
        environment,
        request,
      ),
    )
    await job.activate()
    expect(await retire(f, job)).toEqual({ exitCode: 0, stdout: '{"usage":{}}', failure: 'none' })
  })
  it('bounds output and requests whole-unit stop', async () => {
    const f = fixture()
    const job = await launchedJob(
      f.driver.launch(
        {
          ...command,
          executable: process.execPath,
          args: ['-e', `process.stdout.write('x'.repeat(${String(DEVICE_LIMITS.frameBytes + 1)}))`],
        },
        environment,
        request,
      ),
    )
    await job.activate()
    await vi.waitFor(() => {
      expect(f.run.mock.calls.some(([, args]) => args.includes('stop'))).toBe(true)
    })
    f.state.isEmpty = true
    let result: unknown
    try {
      result = await job.retirement
    } catch (error) {
      result = error
    }
    // A signaled launcher is uncertain; a clean exit retains the typed capacity result.
    expect(result).toSatisfy(
      (value: unknown) =>
        typeof value === 'object' &&
        value !== null &&
        (('failure' in value && value.failure === 'capacity') ||
          ('reason' in value && value.reason === 'uncertain')),
    )
  })
  it('inhibitor loss never yields a successful retirement', async () => {
    const f = fixture()
    const job = await launchedJob(f.driver.launch(command, environment, request))
    const failure = expect(job.retirement).rejects.toMatchObject({ reason: 'uncertain' })
    f.inhibitor()?.kill()
    await failure
    expect(f.run.mock.calls.some(([, args]) => args.includes('stop'))).toBe(true)
  })
  it('normalizes Windows separators in observed cgroup paths', async () => {
    const f = fixture()
    f.state.group = String.raw`\user.slice\test.service`
    const job = await launchedJob(f.driver.launch(command, environment, request))
    expect(f.read.mock.calls.map(([file]) => file)).toContain(
      '/sys/fs/cgroup/user.slice/test.service/cgroup.events',
    )
    await job.activate()
    await retire(f, job)
  })
  it('reports battery, mains and unknown honestly without changing admitted work', async () => {
    const f = fixture()
    const job = await launchedJob(f.driver.launch(command, environment, request))
    f.state.supplies = ['BAT0']
    expect(await f.driver.query()).toMatchObject({ power: 'battery' })
    f.state.supplies.push('AC')
    expect(await f.driver.query()).toMatchObject({ power: 'ac' })
    f.state.failRead = true
    expect(await f.driver.query()).toMatchObject({ power: 'unknown', sleepInhibited: true })
    expect(f.run.mock.calls.some(([, args]) => args.includes('stop'))).toBe(false)
    await job.activate()
    await retire(f, job)
  })
  it('caches a real per-factory probe including query and inhibitor release', async () => {
    const { f, check } = await probing()
    f.state.isEmpty = true
    // Readiness must first see populated=1; query/retirement then observe empty.
    expect(await check).toBe(true)
    expect(await f.driver.selfTest()).toBe(true)
    expect(f.start).toHaveBeenCalledTimes(2)
  })
  it('answers false, never a rejection, when a probe fails with its job unretired', async () => {
    const { f, check } = await probing()
    // The cgroup never shows empty and the inhibitor is lost: retirement stays
    // unproved, so the probe's cleanup cannot remove its job.
    f.inhibitor()?.kill()
    await expect(check).resolves.toBe(false)
    expect(await f.driver.selfTest()).toBe(false)
    expect(f.start).toHaveBeenCalledTimes(2)
  })
  it('selects Linux lazily in the host factory; unsupported platforms refuse', async () => {
    const native = { ...fixture().driver, platform: 'win32' as const }
    const load = vi.fn(() => Promise.resolve(deviceWorkerLinux({ environment: {} })))
    const wrong = wrongPlatformFactory
    const selected = await selectDeviceWorkerDriver('linux', {
      darwin: wrong,
      win32: () => native,
      linux: load,
    })
    expect(selected.platform).toBe('linux')
    expect(
      await selectDeviceWorkerDriver('win32', { darwin: wrong, win32: () => native, linux: load }),
    ).toBe(native)
    await expect(
      selectDeviceWorkerDriver('darwin', { darwin: wrong, win32: () => native, linux: load }),
    ).rejects.toThrow('wrong platform factory')
    await expect(
      selectDeviceWorkerDriver('freebsd', {
        darwin: wrong,
        win32: wrong,
        linux: wrong,
      }),
    ).rejects.toMatchObject({ reason: 'unsupported-host' })
    expect(load).toHaveBeenCalledOnce()
  })
  it('refuses a factory whose driver names another platform (RVM100W 14)', async () => {
    const native = { ...fixture().driver, platform: 'win32' as const }
    const linuxDriver = deviceWorkerLinux({ environment: {} })
    const wrong = wrongPlatformFactory
    // The deleted selector's guard: one OS's driver never stands in for another's.
    const darwinMismatch = selectDeviceWorkerDriver('darwin', {
      darwin: () => native,
      win32: wrong,
      linux: wrong,
    })
    await expect(darwinMismatch).rejects.toBeInstanceOf(DeviceWorkerHostError)
    await expect(darwinMismatch).rejects.toMatchObject({
      reason: 'unsupported-host',
      detail: 'helper',
    })
    await expect(
      selectDeviceWorkerDriver('win32', { darwin: wrong, win32: () => linuxDriver, linux: wrong }),
    ).rejects.toMatchObject({ reason: 'unsupported-host', detail: 'helper' })
    await expect(
      selectDeviceWorkerDriver('linux', {
        darwin: wrong,
        win32: wrong,
        linux: () => Promise.resolve(native),
      }),
    ).rejects.toMatchObject({ reason: 'unsupported-host', detail: 'helper' })
  })
})

const orphanUnit = `muse-spark-device-987654-123-${request.identity.receiverIncarnationId}-${request.identity.attemptId}-${'c'.repeat(32)}.service`
describe('M100/H dead Linux host recovery', () => {
  it.each(['dead', 'reused'])(
    'stops %s host units before a fresh host query completes',
    async (owner) => {
      const f = fixture(true)
      f.state.units.push(orphanUnit, orphanUnit.replace('.service', '-inhibit.service'))
      f.state.isOwnerAlive = owner === 'reused'
      f.state.isOwnerReused = owner === 'reused'
      await f.driver.query()
      for (const unit of f.state.units)
        expect(f.run.mock.calls).toContainEqual([
          '/usr/bin/systemctl',
          ['--user', 'stop', unit],
          expect.anything(),
        ])
      expect(f.start).not.toHaveBeenCalled()
    },
  )
  it('keeps another live host and unrelated unit untouched', async () => {
    const f = fixture(true)
    f.state.units.push(orphanUnit, 'unrelated.service')
    f.state.isOwnerAlive = true
    await f.driver.query()
    expect(f.run.mock.calls.some(([, args]) => args.includes('stop'))).toBe(false)
  })
  it('unreadable host ownership refuses recovery without assuming death', async () => {
    const f = fixture(true)
    f.state.units.push(orphanUnit)
    f.state.isOwnerUnreadable = true
    await expect(f.driver.query()).rejects.toThrow('unreadable owner')
    expect(f.run.mock.calls.some(([, args]) => args.includes('stop'))).toBe(false)
    expect(f.start).not.toHaveBeenCalled()
  })
  it('an orphan stop acknowledgement without observed emptiness blocks all new launches', async () => {
    const f = fixture(true)
    f.state.units.push(orphanUnit)
    f.state.canStopOrphan = false
    // This attempt allocated nothing; the unresolved orphan's own record stays uncertain.
    expect(await f.driver.launch(command, environment, request)).toMatchObject({
      kind: 'refused',
      error: { reason: 'uncertain' },
    })
    expect(f.start).not.toHaveBeenCalled()
  })
  const durable = useExecutionFixture('check')
  it('cleans orphan units before retaining occupancy and journals original attempts as uncertain', async () => {
    const f = fixture(true)
    const { journal, request: original, policy, lease } = durable()
    await journal.admit(original, executionUsage, Date.now())
    await journal.advance(
      original.identity,
      (previous) => ({ ...previous, revision: previous.revision + 1, state: 'launch-intent' }),
      Date.now(),
    )
    const unit = `muse-spark-device-987654-123-${original.identity.receiverIncarnationId}-${original.identity.attemptId}-${'c'.repeat(32)}.service`
    f.state.units.push(unit)
    const retain = vi.fn(() => {
      expect(f.state.isOrphanStopped).toBe(true)
      return Promise.resolve()
    })
    const host = new DeviceWorkerHost({
      driver: f.driver,
      environment: {},
      retain,
      reserve: () =>
        Promise.resolve({ usage: executionUsage, pause: lease.pause, release: lease.release }),
      command: () => Promise.reject(new Error('recovery must never launch')),
      recordEnvironment: () => Promise.resolve(),
      pressure: () => undefined,
    })
    await DeviceReceiver.open('f'.repeat(32), journal, host, policy)
    const records = await journal.records()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      kind: 'receiver-record',
      outcome: {
        identity: original.identity,
        state: 'uncertain',
        occupied: original.caps,
        usage: executionUsage,
      },
    })
    expect(retain).toHaveBeenCalledOnce()
    expect(lease.release).not.toHaveBeenCalled()
    expect(f.start).not.toHaveBeenCalled()
  })
})
