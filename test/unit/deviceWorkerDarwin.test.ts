import { execFile } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { deviceWorkerDarwin } from '../../src/host/backend/deviceWorkerDarwin'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { workerEnvironment } from '../../src/core/team/refFence'
import {
  DeviceWorkerHost,
  parseDeviceWorkerQuery,
  selectDeviceWorkerDriver,
  type DeviceWorkerJob,
  type DeviceWorkerDriver,
} from '../../src/host/devices/deviceWorkerHost'
import type { RunProgram } from '../../src/host/processTree'
import { deviceCheck, deviceGrant } from './helpers/deviceFixtures'

const run: RunProgram = (file, args, env) =>
  new Promise((resolve, reject) => {
    if (file === '/bin/launchctl' && args[0] === 'bootstrap' && args[2] !== undefined)
      state.labels.add(path.basename(path.dirname(args[2])).slice('attempt-'.length))
    const child = execFile(
      file,
      [...args],
      { env, maxBuffer: DEVICE_LIMITS.frameBytes },
      (error, stdout) => {
        if (error === null) resolve(stdout)
        else reject(new Error('native command failed', { cause: error }))
      },
    )
    child.stdin?.end()
  })
const usage = {
  settlementId: 'a'.repeat(32),
  payer: 'local',
  certainty: 'known',
  inputTokens: 0,
  outputTokens: 0,
  returnedUsd: 0,
  retainedLiabilityUsd: 0,
} as const
const boundary = { beforeAction: () => Promise.resolve(), beforePaidUse: () => Promise.resolve() }
const state: { directory: string; native?: DeviceWorkerDriver; labels: Set<string> } = {
  directory: '',
  labels: new Set(),
}
function uid() {
  if (process.getuid === undefined) throw new Error('native Darwin UID unavailable')
  return process.getuid()
}
function native() {
  if (state.native === undefined) throw new Error('native fixture not prepared')
  return state.native
}
function freshDriver(invoke: RunProgram = run) {
  return deviceWorkerDarwin({ storageDir: state.directory, environment: process.env, run: invoke })
}
function launch(
  script: string,
  driver: DeviceWorkerDriver = native(),
  environment?: Record<string, string>,
) {
  const env =
    environment ??
    Object.fromEntries(
      Object.entries(workerEnvironment(process.env, 'darwin')).flatMap(([name, value]) =>
        value === undefined ? [] : [[name, value]],
      ),
    )
  return driver.launch(
    { executable: process.execPath, args: ['-e', script], cwd: state.directory, requiredTools: [] },
    env,
  )
}
async function ready(marker: string) {
  await expect
    .poll(async () => {
      try {
        await access(marker)
        return true
      } catch {
        return false
      }
    })
    .toBe(true)
}
async function attempts() {
  const root = path.join(state.directory, 'device-workers-darwin')
  const names = await readdir(root)
  return names.filter((name) => name.startsWith('attempt-'))
}
async function assertions() {
  return await run('/usr/bin/pmset', ['-g', 'assertions'], {})
}
async function clean(job: DeviceWorkerJob) {
  await job.cancel()
  await job.retirement
  await job.remove()
}
async function recover(job: DeviceWorkerJob) {
  const context = parseDeviceWorkerQuery(job.query).context
  await run('/bin/launchctl', ['bootout', `gui/${String(uid())}/${context.desktop}`], {})
  await rm(path.join(state.directory, 'device-workers-darwin', `attempt-${context.desktop}`), {
    recursive: true,
    force: true,
  })
}

describe('M100/H Darwin unsupported manager port', () => {
  it('retained attempts refuse capacity before bootstrap, including a cold self-test', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'm100-darwin-cap-'))
    const owner = await lstat(directory)
    const invoke = vi.fn<RunProgram>(async (_file, args) => {
      if (args[0] === 'print') return 'session = Aqua'
      if (args[0] === 'bootstrap') throw new Error('capacity guard allowed bootstrap')
      const output = args[args.indexOf('-o') + 1]
      if (output !== undefined && args.includes('-o')) {
        await writeFile(output, 'fake helper')
        return ''
      }
      return JSON.stringify({
        context: { session: owner.uid, station: 'gui', desktop: 'transport' },
        power: 'unknown',
        sleepInhibited: false,
        activeProcesses: 0,
        cpu100ns: 0,
        peakMemoryBytes: 0,
      })
    })
    try {
      const root = path.join(directory, 'device-workers-darwin')
      await mkdir(root, { mode: 0o700 })
      for (let index = 0; index < DEVICE_LIMITS.unresolvedAttempts; index += 1)
        await mkdir(path.join(root, `attempt-${String(index)}`))
      const driver = deviceWorkerDarwin({
        storageDir: directory,
        environment: {},
        uid: owner.uid,
        run: invoke,
      })
      await expect(
        driver.launch(
          { executable: process.execPath, args: [], cwd: directory, requiredTools: [] },
          {},
        ),
      ).rejects.toMatchObject({ reason: 'capacity' })
      expect(invoke.mock.calls.every(([, args]) => args[0] !== 'bootstrap')).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('refuses a missing GUI domain before compilation or launch, without fallback', async () => {
    const invoke = vi.fn<RunProgram>().mockRejectedValue(new Error('manager unavailable'))
    const driver = deviceWorkerDarwin({
      storageDir: tmpdir(),
      environment: {},
      uid: 502,
      run: invoke,
    })
    expect(await driver.selfTest()).toBe(false)
    await expect(
      driver.launch(
        { executable: process.execPath, args: [], cwd: tmpdir(), requiredTools: [] },
        {},
      ),
    ).rejects.toMatchObject({ reason: 'unsupported-host', detail: 'helper' })
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      '/bin/launchctl',
      ['print', 'gui/502'],
      expect.anything(),
    )
  })
  it('refuses a non-Aqua domain and caches the per-factory self-test', async () => {
    const invoke = vi.fn<RunProgram>().mockResolvedValue('session = Background')
    const driver = deviceWorkerDarwin({
      storageDir: tmpdir(),
      environment: {},
      uid: 502,
      run: invoke,
    })
    expect(await driver.selfTest()).toBe(false)
    expect(await driver.selfTest()).toBe(false)
    expect(invoke).toHaveBeenCalledOnce()
  })
})

describe.skipIf(process.platform !== 'darwin')('M100/H actual launchd GUI job', () => {
  beforeAll(async () => {
    state.directory = await mkdtemp(path.join(tmpdir(), 'm100-darwin-native-'))
    state.native = selectDeviceWorkerDriver('darwin', {
      darwin: () => freshDriver(),
      win32: () => {
        throw new Error('wrong platform factory')
      },
    })
    expect(await native().selfTest()).toBe(true)
  })
  afterAll(async () => {
    try {
      const root = path.join(state.directory, 'device-workers-darwin')
      const names = await attempts()
      for (const name of names) {
        const label = name.slice('attempt-'.length)
        await writeFile(path.join(root, name, 'stop'), '')
        try {
          await run('/bin/launchctl', ['bootout', `gui/${String(uid())}/${label}`], {})
        } catch {
          /* A test may have already removed its registration. */
        }
      }
      const registrations = await run('/bin/launchctl', ['print', `gui/${String(uid())}`], {})
      for (const label of state.labels) expect(registrations).not.toContain(label)
    } finally {
      await rm(state.directory, { recursive: true, force: true })
    }
  })
  it('self-tests a real GUI job and leaves no registration or inhibitor', async () => {
    expect(await native().query()).toMatchObject({
      context: { station: 'gui' },
      power: expect.stringMatching(/^(?:ac|battery|unknown)$/),
      sleepInhibited: false,
      activeProcesses: 0,
    })
    expect(await attempts()).toEqual([])
    expect(await assertions()).not.toContain('Muse Spark device worker')
    const info = await lstat(path.join(state.directory, 'device-workers-darwin'))
    expect(info.mode & 0o777).toBe(0o700)
  })
  it('closes stdin and validates JSON stdout despite stderr banners and a hostile inherited variable', async () => {
    const recorded = vi.fn()
    const reservation = { release: () => Promise.resolve(), pause: () => Promise.resolve(), usage }
    const host = new DeviceWorkerHost({
      driver: native(),
      environment: {
        ...process.env,
        NODE_OPTIONS: '--invalid-option',
        RANDOM_UNAPPROVED: 'sentinel',
      },
      retain: () => Promise.resolve(),
      reserve: () => Promise.resolve(reservation),
      command: () =>
        Promise.resolve({
          executable: process.execPath,
          args: [
            '-e',
            String.raw`process.stderr.write('warning banner\n');process.stdin.on('end',()=>process.stdout.write(${JSON.stringify(JSON.stringify({ usage }))}));process.stdin.resume()`,
          ],
          cwd: state.directory,
          requiredTools: [],
        }),
      recordEnvironment: (_request, env) => {
        recorded(env)
        return Promise.resolve()
      },
      pressure: () => undefined,
    })
    const attempt = await host.admit(deviceCheck(deviceGrant('a'.repeat(32))))
    try {
      await attempt.start(boundary)
      const result = await attempt.retirement
      expect(result).toEqual({ usage })
      expect(recorded).toHaveBeenCalledWith(
        expect.not.objectContaining({
          NODE_OPTIONS: expect.anything(),
          RANDOM_UNAPPROVED: expect.anything(),
        }),
      )
      await attempt.release()
    } finally {
      await attempt.cancel()
    }
    expect(await attempts()).toEqual([])
  })
  it('waits for a detached double-fork descendant after its direct parent exits', async () => {
    const marker = path.join(state.directory, 'detached-finished')
    const descendant = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'finished'),200)`
    const middle = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore',detached:true}).unref()`
    const job = await launch(
      `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(middle)}],{stdio:'ignore',detached:true}).unref();process.stdout.write('parent result')`,
    )
    try {
      await job.activate()
      expect(await job.retirement).toEqual({
        exitCode: 0,
        stdout: 'parent result',
        failure: 'none',
      })
      expect(await readFile(marker, 'utf8')).toBe('finished')
    } finally {
      await clean(job)
    }
  })
  it('holds an actual assertion through the detached tree and releases it after observed retirement', async () => {
    const marker = path.join(state.directory, 'tree-running')
    const descendant = `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},100);setTimeout(()=>process.exit(0),2000)`
    const job = await launch(
      `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore',detached:true}).unref();process.stdout.write('parent result')`,
    )
    try {
      await job.activate()
      await ready(marker)
      const pid = Number(await readFile(marker, 'utf8'))
      expect(await assertions()).toContain('Muse Spark device worker')
      await expect
        .poll(() => native().query())
        .toMatchObject({ sleepInhibited: true, activeProcesses: 1 })
      const sample = parseDeviceWorkerQuery(await native().query())
      expect(sample.cpu100ns).toBeGreaterThan(0)
      expect(sample.peakMemoryBytes).toBeGreaterThan(0)
      await job.cancel()
      expect(await job.retirement).toEqual({
        exitCode: 0,
        stdout: 'parent result',
        failure: 'none',
      })
      expect(() => process.kill(pid, 0)).toThrow()
      expect(await assertions()).not.toContain('Muse Spark device worker')
    } finally {
      await clean(job)
    }
    expect(await native().query()).toMatchObject({ sleepInhibited: false, activeProcesses: 0 })
  })
  it('bounds stdout and stderr separately and kills a flooding job', async () => {
    for (const channel of ['stdout', 'stderr']) {
      const job = await launch(
        `process.${channel}.write('x'.repeat(${String(DEVICE_LIMITS.frameBytes + 1)}));setInterval(()=>{},100)`,
      )
      try {
        await job.activate()
        expect(await job.retirement).toMatchObject({ failure: 'capacity' })
      } finally {
        await clean(job)
      }
    }
  })
  it('cancellation before activation waits for observed unit exit before removal', async () => {
    const job = await launch('process.exit(0)')
    try {
      await expect(job.remove()).rejects.toMatchObject({ reason: 'uncertain' })
      await job.cancel()
      expect(await job.retirement).toEqual({ exitCode: 1, stdout: '', failure: 'none' })
    } finally {
      await clean(job)
    }
  })
  it('overlapping jobs retain an assertion until the last whole unit exits', async () => {
    const first = await launch('setInterval(()=>{},100)')
    const second = await launch('setInterval(()=>{},100)')
    try {
      await first.activate()
      await second.activate()
      await first.cancel()
      await first.retirement
      await first.remove()
      expect(await native().query()).toMatchObject({ sleepInhibited: true })
      expect(await assertions()).toContain('Muse Spark device worker')
      await second.cancel()
      await second.retirement
      await second.remove()
      expect(await native().query()).toMatchObject({ sleepInhibited: false })
      expect(await assertions()).not.toContain('Muse Spark device worker')
    } finally {
      await clean(first)
      await clean(second)
    }
  })
  it('unknown and battery facts remain honest while admitted work stays owned', async () => {
    for (const power of ['battery', 'unknown']) {
      const invoke: RunProgram = async (file, args, env) => {
        const stdout = await run(file, args, env)
        if (args[0] !== '--query') return stdout
        const query = parseDeviceWorkerQuery(JSON.parse(stdout))
        return JSON.stringify({ ...query, power })
      }
      const driver = freshDriver(invoke)
      const job = await launch('setInterval(()=>{},100)', driver, {})
      try {
        await job.activate()
        expect(await driver.query()).toMatchObject({ power, sleepInhibited: true })
        await job.cancel()
        await job.retirement
      } finally {
        await clean(job)
      }
    }
  })
  it('helper loss releases its assertion but cannot retire a detached descendant', async () => {
    const marker = path.join(state.directory, 'helper-loss-child')
    const descendant = `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},100)`
    const job = await launch(
      `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore',detached:true}).unref();setInterval(()=>{},100)`,
    )
    let child: number | undefined
    try {
      await job.activate()
      await ready(marker)
      child = Number(await readFile(marker, 'utf8'))
      const context = parseDeviceWorkerQuery(job.query).context
      await run(
        '/bin/launchctl',
        ['kill', 'SIGKILL', `gui/${String(uid())}/${context.desktop}`],
        {},
      )
      await expect(job.retirement).rejects.toMatchObject({ reason: 'uncertain' })
      expect(await assertions()).not.toContain('Muse Spark device worker')
      expect(() => process.kill(child!, 0)).not.toThrow()
      await expect(job.remove()).rejects.toMatchObject({ reason: 'uncertain' })
    } finally {
      if (child !== undefined) process.kill(child, 'SIGKILL')
      // Deliberately uncertain attempts are recovered by this test's exact unit;
      // the production driver never marks them observed or removes them.
      await recover(job)
    }
  })
  it('an injected unavailable manager refuses natively without starting a worker', async () => {
    const invoke = vi.fn<RunProgram>((file, args, env) =>
      args[0] === 'print' ? Promise.reject(new Error('manager unavailable')) : run(file, args, env),
    )
    const driver = freshDriver(invoke)
    await expect(
      driver.launch(
        {
          executable: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: state.directory,
          requiredTools: [],
        },
        {},
      ),
    ).rejects.toMatchObject({ reason: 'unsupported-host' })
    expect(invoke).toHaveBeenCalledOnce()
    expect(await attempts()).toEqual([])
  })
  it('manager loss after launch retains uncertainty and forbids removal', async () => {
    let isUnavailable = false
    const invoke: RunProgram = (file, args, env) => {
      return isUnavailable && args[0] === 'print'
        ? Promise.reject(new Error('manager lost'))
        : run(file, args, env)
    }
    const driver = freshDriver(invoke)
    const job = await launch('setInterval(()=>{},100)', driver, {})
    try {
      await job.activate()
      isUnavailable = true
      await expect(job.retirement).rejects.toMatchObject({ reason: 'uncertain' })
      await expect(job.remove()).rejects.toMatchObject({ reason: 'uncertain' })
    } finally {
      isUnavailable = false
      await job.cancel()
      await recover(job)
    }
  })
  it('a corrupt cached helper fails a new factory self-test and never falls back', async () => {
    const root = path.join(state.directory, 'device-workers-darwin')
    const names = await readdir(root)
    const name = names.find((entry) => entry.startsWith('worker-'))
    if (name === undefined) throw new Error('native helper missing')
    await writeFile(path.join(root, name), 'corrupted native helper')
    const invoke = vi.fn<RunProgram>(run)
    const driver = freshDriver(invoke)
    expect(await driver.selfTest()).toBe(false)
    await expect(
      driver.launch(
        { executable: process.execPath, args: [], cwd: state.directory, requiredTools: [] },
        {},
      ),
    ).rejects.toMatchObject({ reason: 'unsupported-host' })
    expect(invoke.mock.calls.some(([, args]) => args[0] === 'bootstrap')).toBe(false)
    expect(await attempts()).toEqual([])
  })
})
