import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deviceWorkerLinux } from '../../src/host/backend/deviceWorkerLinux'
import {
  deviceWorkerDriverForPlatform,
  type DeviceWorkerJob,
} from '../../src/host/devices/deviceWorkerHost'
import { workerEnvironment } from '../../src/core/team/refFence'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { deviceCheck, deviceGrant } from './helpers/deviceFixtures'

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

function fixture() {
  const supplies: string[] = []
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
  }
  const calls: { file: string; args: readonly string[]; env: NodeJS.ProcessEnv }[] = []
  let worker: ChildProcessWithoutNullStreams | undefined
  let inhibitor: ChildProcessWithoutNullStreams | undefined
  const start = vi.fn((file: string, args: readonly string[], env: NodeJS.ProcessEnv) => {
    calls.push({ file, args, env })
    const isInhibitor = args.includes('/usr/bin/systemd-inhibit')
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
    children.add(child)
    if (isInhibitor) inhibitor = child
    else worker = child
    return child
  })
  const run = vi.fn((_file: string, args: readonly string[]) => {
    if (state.isManagerLost) return Promise.reject(new Error('manager lost'))
    if (args.includes('stop')) worker?.kill()
    return args.includes('--property=Version')
      ? Promise.resolve('257\n')
      : Promise.resolve(
          `LoadState=loaded\nActiveState=active\nSubState=running\nControlGroup=${state.group}\nTasksMax=${String(state.tasksMax)}\nResult=${state.result}\n`,
        )
  })
  const read = vi.fn((file: string) => {
    if (state.failRead && file.startsWith('/sys/class/power_supply/'))
      return Promise.reject(new Error('unreadable'))
    if (file.endsWith('cgroup.events'))
      return Promise.resolve(`populated ${state.isEmpty ? '0' : '1'}\n`)
    if (file === '/proc/self/cgroup') return Promise.resolve(`0::${state.transport}\n`)
    if (file.endsWith('pids.max')) return Promise.resolve(String(state.kernelLimit))
    if (file.endsWith('pids.current')) return Promise.resolve('1\n')
    if (file.endsWith('cgroup.procs')) return Promise.resolve('11\n')
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
    inhibitor: () => inhibitor,
  }
}
async function retire(f: ReturnType<typeof fixture>, job: DeviceWorkerJob) {
  f.state.isEmpty = true
  const result = await job.retirement
  await job.remove()
  return result
}
describe('M100/H Linux platform port (fake manager/cgroup/inhibitor)', () => {
  it('creates an independently owned, bounded unit with the admitted TasksMax and exact recorded environment', async () => {
    const f = fixture()
    const job = await f.driver.launch(command, environment, request)
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
    const job = await f.driver.launch(command, environment, request)
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
    const job = await f.driver.launch(command, environment, request)
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
    const job = await f.driver.launch(command, environment, request)
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
      await expect(
        f.driver.launch(command, environment, { ...request, caps: { ...request.caps, processes } }),
      ).rejects.toMatchObject({ reason: 'unsupported-host' })
      expect(f.start).not.toHaveBeenCalled()
      expect(f.run).not.toHaveBeenCalled()
    },
  )
  it.each(['tasksMax', 'kernelLimit'] as const)(
    'refuses when %s differs from the admitted ceiling before activation',
    async (field) => {
      const f = fixture()
      f.state[field] += 1
      await expect(f.driver.launch(command, environment, request)).rejects.toMatchObject({
        reason: 'unsupported-host',
        detail: 'preflight',
      })
      expect(f.worker()?.stdin.writableEnded).toBe(false)
      expect(f.inhibitor()?.exitCode).toBe(0)
    },
  )
  it('refuses a unit reported in the transport cgroup before activation', async () => {
    const f = fixture()
    f.state.transport = f.state.group
    await expect(f.driver.launch(command, environment, request)).rejects.toMatchObject({
      reason: 'unsupported-host',
      detail: 'context',
    })
    expect(f.worker()?.stdin.writableEnded).toBe(false)
  })
  it('resource pressure is typed with recovery prose, one launch and no silent retry', async () => {
    const f = fixture()
    f.state.result = 'resources'
    await expect(f.driver.launch(command, environment, request)).rejects.toMatchObject({
      reason: 'capacity',
      detail: 'capacity',
      message: UI_TEXT.devices.capacityHelp,
    })
    expect(f.start).toHaveBeenCalledTimes(2)
    expect(f.worker()?.stdin.writableEnded).toBe(false)
  })
  it('even a working injected manager cannot launch without its runtime directory', async () => {
    const f = fixture()
    const driver = deviceWorkerLinux({ environment: {}, run: f.run, start: f.start })
    await expect(driver.launch(command, environment, request)).rejects.toMatchObject({
      reason: 'unsupported-host',
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
      await expect(driver.launch(command, environment, request)).rejects.toMatchObject({
        reason: 'unsupported-host',
      })
      expect(start).not.toHaveBeenCalled()
    },
  )
  it('manager failure never falls back to a transport spawn', async () => {
    const f = fixture()
    f.state.isManagerLost = true
    await expect(f.driver.launch(command, environment, request)).rejects.toMatchObject({
      reason: 'unsupported-host',
    })
    expect(f.start).not.toHaveBeenCalled()
    expect(await f.driver.selfTest()).toBe(false)
  })
  it('rejects noncanonical credential and loader variables before starting', async () => {
    const f = fixture()
    await expect(
      f.driver.launch(
        command,
        { ...environment, META_API_KEY: 'fixture-not-a-key', NODE_OPTIONS: 'loader' },
        request,
      ),
    ).rejects.toMatchObject({ reason: 'unsupported-host' })
    expect(f.start).not.toHaveBeenCalled()
  })
  it('stderr banners never become structured results and stdin is EOF', async () => {
    const f = fixture()
    const job = await f.driver.launch(
      {
        ...command,
        args: [
          '-e',
          'process.stdin.on("data",()=>process.exit(1));process.stdin.on("end",()=>{process.stderr.write("banner");process.stdout.write(JSON.stringify({usage:{}}))})',
        ],
      },
      environment,
      request,
    )
    await job.activate()
    expect(await retire(f, job)).toEqual({ exitCode: 0, stdout: '{"usage":{}}', failure: 'none' })
  })
  it('bounds output and requests whole-unit stop', async () => {
    const f = fixture()
    const job = await f.driver.launch(
      {
        ...command,
        executable: process.execPath,
        args: ['-e', `process.stdout.write('x'.repeat(${String(DEVICE_LIMITS.frameBytes + 1)}))`],
      },
      environment,
      request,
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
    const job = await f.driver.launch(command, environment, request)
    const failure = expect(job.retirement).rejects.toMatchObject({ reason: 'uncertain' })
    f.inhibitor()?.kill()
    await failure
    expect(f.run.mock.calls.some(([, args]) => args.includes('stop'))).toBe(true)
  })
  it('normalizes Windows separators in observed cgroup paths', async () => {
    const f = fixture()
    f.state.group = String.raw`\user.slice\test.service`
    const job = await f.driver.launch(command, environment, request)
    expect(f.read.mock.calls.map(([file]) => file)).toContain(
      '/sys/fs/cgroup/user.slice/test.service/cgroup.events',
    )
    await job.activate()
    await retire(f, job)
  })
  it('reports battery, mains and unknown honestly without changing admitted work', async () => {
    const f = fixture()
    const job = await f.driver.launch(command, environment, request)
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
    const f = fixture()
    f.state.tasksMax = 1
    f.state.kernelLimit = 1
    const check = f.driver.selfTest()
    await vi.waitFor(() => {
      expect(f.worker()?.exitCode).toBe(0)
    })
    f.state.isEmpty = true
    // Readiness must first see populated=1; query/retirement then observe empty.
    expect(await check).toBe(true)
    expect(await f.driver.selfTest()).toBe(true)
    expect(f.start).toHaveBeenCalledTimes(2)
  })
  it('selects Linux lazily in the host factory; unsupported platforms refuse', async () => {
    const native = { ...fixture().driver, platform: 'win32' as const }
    const load = vi.fn(() => Promise.resolve(deviceWorkerLinux({ environment: {} })))
    const selected = await deviceWorkerDriverForPlatform(native, load, 'linux')
    expect(selected.platform).toBe('linux')
    expect(await deviceWorkerDriverForPlatform(native, load, 'win32')).toBe(native)
    await expect(deviceWorkerDriverForPlatform(native, load, 'darwin')).rejects.toMatchObject({
      reason: 'unsupported-host',
    })
    expect(load).toHaveBeenCalledOnce()
  })
})
