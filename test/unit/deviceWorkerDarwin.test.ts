import { ChildProcess, execFile, spawn } from 'node:child_process'
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  lstat,
  realpath,
  rename,
  symlink,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { deviceWorkerDarwin } from '../../src/host/backend/deviceWorkerDarwin'
import {
  DEVICE_LIMITS,
  POSIX_TREE_EXIT_POLL_MS,
  MILLISECONDS_PER_SECOND,
} from '../../src/shared/constants'
import { workerEnvironment } from '../../src/core/team/refFence'
import {
  DeviceWorkerHost,
  parseDeviceWorkerQuery,
  selectDeviceWorkerDriver,
  type DeviceWorkerJob,
  type DeviceWorkerDriver,
  type DeviceWorkerAttempt,
} from '../../src/host/devices/deviceWorkerHost'
import type { RunProgram } from '../../src/host/processTree'
import { deviceCheck, deviceGrant } from './helpers/deviceFixtures'
import { darwinEscapeTree, survivors } from './helpers/deviceDarwinEscape'
import { AttemptJournal } from '../../src/core/devices/attemptJournal'
import { executionProtection, signedDispatch } from './helpers/deviceExecutionFixtures'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { deviceFailureText } from '../../src/webview/models/sections/agents/devicePresentation'
import type { DeviceWorkerCommand } from '../../src/host/devices/deviceWorkerHost'
import type * as FsPromises from 'node:fs/promises'
import type * as ChildProcessModule from 'node:child_process'
import { openWorkerReceiver } from './helpers/deviceWorkerReceiver'
import {
  darwinSpawnFixture,
  darwinSpawnSites,
  darwinSpawnFailures,
} from './helpers/deviceDarwinSpawn'

vi.mock('node:fs/promises', { spy: true })
vi.mock('node:child_process', { spy: true })

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
// Native output/failure transformations live in the fixture's injected spawn;
// the production driver always starts children through its one primitive.
function fromRun(invoke: RunProgram) {
  return (file: string, args: readonly string[], options: ChildProcessModule.SpawnOptions) => {
    const child = new ChildProcess()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    child.stdout = stdout
    child.stderr = stderr
    vi.spyOn(child, 'kill').mockReturnValue(false)
    void invoke(file, args, options.env ?? {})
      .then((output) => {
        stdout.end(`${output}\n`)
        child.emit('close', 0)
      })
      .catch((error: unknown) => {
        const code =
          typeof error === 'object' &&
          error !== null &&
          'detail' in error &&
          error.detail === 'capacity'
            ? 'EAGAIN'
            : 'ENOENT'
        child.emit('error', Object.assign(new Error('native fixture failure'), { code }))
        child.emit('close', -1)
      })
    return child
  }
}
const usage = {
  settlementId: 'a'.repeat(32),
  payer: 'local',
  certainty: 'known',
  inputTokens: 0,
  outputTokens: 0,
  returnedUsd: 0,
  retainedLiabilityUsd: 0,
} as const
function attemptWith(processes: number = DEVICE_LIMITS.processes): DeviceWorkerAttempt {
  const request = deviceCheck(deviceGrant('a'.repeat(32)))
  return { identity: request.identity, caps: { ...request.caps, processes } }
}
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
function escapeTree(processes: number) {
  return darwinEscapeTree(run, native(), state.directory, attemptWith(processes))
}
function freshDriver(invoke: RunProgram = run) {
  return deviceWorkerDarwin({
    storageDir: state.directory,
    environment: process.env,
    spawn: fromRun(invoke),
  })
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
    attemptWith(),
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
async function helperFile() {
  const root = path.join(state.directory, 'device-workers-darwin')
  const names = await readdir(root)
  const name = names.find((entry) => entry.startsWith('worker-'))
  if (name === undefined) throw new Error('native helper missing')
  return path.join(root, name)
}
async function clean(job: DeviceWorkerJob) {
  await job.cancel()
  await job.retirement
  await job.remove()
}
async function complete(job: DeviceWorkerJob, verify?: () => Promise<void>) {
  try {
    await verify?.()
    await job.activate()
    expect(await job.retirement).toEqual({ exitCode: 0, stdout: '', failure: 'none' })
  } finally {
    await clean(job)
  }
}
async function recover(job: DeviceWorkerJob) {
  const context = parseDeviceWorkerQuery(job.query).context
  await run('/bin/launchctl', ['bootout', `gui/${String(uid())}/${context.desktop}`], {})
  await rm(path.join(state.directory, 'device-workers-darwin', `attempt-${context.desktop}`), {
    recursive: true,
    force: true,
  })
}

async function fakeDarwinDirectories() {
  // Preserve real file identities; only fake Darwin directory mode bits.
  const actualFs = await vi.importActual<typeof FsPromises>('node:fs/promises')
  vi.mocked(lstat).mockImplementation(async (...args) => {
    const info = await actualFs.lstat(...args)
    const mode = info.mode
    if (typeof mode === 'number' && info.isDirectory()) info.mode = mode & ~0o077
    return info
  })
}

async function spawnBoundaryFixture(...args: Parameters<typeof darwinSpawnFixture>) {
  const fixture = await darwinSpawnFixture(...args)
  // Fence both process APIs even when exercising the pre-redesign baseline.
  vi.mocked(spawn).mockImplementation(fixture.spawn)
  vi.mocked(execFile).mockImplementation(() => {
    throw Object.assign(new Error('forbidden primitive bypass'), { code: 'ENOMEM' })
  })
  await fakeDarwinDirectories()
  const driver = deviceWorkerDarwin({
    storageDir: fixture.directory,
    environment: {},
    uid: fixture.uid,
    spawn: fixture.spawn,
  })
  const start = () =>
    driver.launch(
      { executable: '/usr/bin/true', args: [], cwd: fixture.directory, requiredTools: [] },
      {},
      attemptWith(),
    )
  return { ...fixture, driver, start }
}

const attemptNames = async (directory: string) => {
  const names = await readdir(path.join(directory, 'device-workers-darwin'))
  return names.filter((name) => name.startsWith('attempt-'))
}
const reclamationFixture = async (site: 'retirement-print' | 'count') => {
  const failure = darwinSpawnFailures[0]
  if (failure === undefined) throw new Error('failure fixture missing')
  const fixture = await spawnBoundaryFixture(site, failure)
  fixture.repeatFailure()
  fixture.immediateProbes()
  return fixture
}
const restoreFixture = async (fixture: Awaited<ReturnType<typeof reclamationFixture>>) => {
  vi.mocked(spawn).mockRestore()
  vi.mocked(execFile).mockRestore()
  vi.mocked(lstat).mockRestore()
  await fixture.clean()
}
async function recoverFixture(fixture: Awaited<ReturnType<typeof reclamationFixture>>) {
  const calls = fixture.calls.length
  fixture.disableFailure()
  const job = await fixture.start()
  expect(fixture.calls.slice(calls)).toContain('bootstrap')
  await complete(job)
  expect(await attemptNames(fixture.directory)).toEqual([])
  expect(await fixture.driver.query()).toMatchObject({ activeProcesses: 0 })
}
describe('M100/H spawn boundary', () => {
  const cases = darwinSpawnSites.flatMap((site) =>
    darwinSpawnFailures.map((failure) => ({ site, failure, name: `${site}: ${failure.name}` })),
  )
  it('reclaims the probe after 200 consecutive retryable observation failures', async () => {
    const fixture = await reclamationFixture('retirement-print')
    try {
      for (let index = 0; index < 200; index += 1) {
        await expect(fixture.start()).rejects.toMatchObject({ reason: 'uncertain' })
        expect(await attemptNames(fixture.directory)).toEqual([])
        expect(fixture.jobs.size).toBe(0)
      }
      await recoverFixture(fixture)
    } finally {
      await restoreFixture(fixture)
    }
  })
  it('sweeps 128 dead pending probes before a recovered preparation and launch', async () => {
    const fixture = await reclamationFixture('count')
    try {
      for (let index = 0; index < DEVICE_LIMITS.unresolvedAttempts; index += 1)
        await expect(fixture.start()).rejects.toMatchObject({ reason: 'uncertain' })
      expect(await attemptNames(fixture.directory)).toHaveLength(DEVICE_LIMITS.unresolvedAttempts)
      expect(fixture.jobs.size).toBe(0)
      await recoverFixture(fixture)
    } finally {
      await restoreFixture(fixture)
    }
  })
  it('sweeps gone ordinary attempts before allocation refuses capacity', async () => {
    const fixture = await reclamationFixture('count')
    try {
      fixture.disableFailure()
      expect(await fixture.driver.selfTest()).toBe(true)
      fixture.repeatFailure()
      for (let index = 0; index < DEVICE_LIMITS.unresolvedAttempts; index += 1) {
        const job = await fixture.start()
        await expect(job.retirement).rejects.toMatchObject({ reason: 'uncertain' })
      }
      expect(await attemptNames(fixture.directory)).toHaveLength(DEVICE_LIMITS.unresolvedAttempts)
      // The manager has lost every job, independently of the driver's store.
      fixture.jobs.clear()
      fixture.disableFailure()
      await complete(await fixture.start())
      expect(await attemptNames(fixture.directory)).toEqual([])
      expect(await fixture.driver.query()).toMatchObject({ activeProcesses: 0 })
    } finally {
      await restoreFixture(fixture)
    }
  })
  it.each(['coalition', 'group'])(
    'retains a pending probe while its %s membership lives',
    async (kind) => {
      const fixture = await reclamationFixture('retirement-print')
      try {
        fixture.membership(kind === 'coalition' ? 1 : 0, kind === 'group' ? '2\n' : '')
        await expect(fixture.start()).rejects.toMatchObject({ reason: 'uncertain' })
        expect(await attemptNames(fixture.directory)).toHaveLength(1)
        expect(fixture.jobs.size).toBe(0)
        fixture.membership(0)
        fixture.disableFailure()
        await complete(await fixture.start())
        expect(await attemptNames(fixture.directory)).toEqual([])
      } finally {
        await restoreFixture(fixture)
      }
    },
  )
  it.each(['directory', 'symlink'])(
    'leaves an identity-substituted %s and unowned attempts untouched',
    async (kind) => {
      const fixture = await reclamationFixture('count')
      try {
        await expect(fixture.start()).rejects.toMatchObject({ reason: 'uncertain' })
        const root = path.join(fixture.directory, 'device-workers-darwin')
        const names = await attemptNames(fixture.directory)
        const name = names[0]
        if (name === undefined) throw new Error('pending attempt missing')
        const directory = path.join(root, name)
        const held = path.join(fixture.directory, 'held')
        await rename(directory, held)
        if (kind === 'symlink') await symlink(held, directory, 'junction')
        else await mkdir(directory)
        const unowned = path.join(
          root,
          'attempt-com.musespark.device.00000000000000000000000000000000',
        )
        await mkdir(unowned)
        await writeFile(path.join(unowned, 'sentinel'), 'keep')
        fixture.disableFailure()
        await complete(await fixture.start())
        expect(await attemptNames(fixture.directory)).toHaveLength(2)
        expect(await readFile(path.join(unowned, 'sentinel'), 'utf8')).toBe('keep')
        expect(await readFile(path.join(held, 'ready.json'), 'utf8')).toContain('coalition')
      } finally {
        await restoreFixture(fixture)
      }
    },
  )
  it('refuses a substituted store identity without touching the held attempts', async () => {
    const fixture = await reclamationFixture('count')
    try {
      await expect(fixture.start()).rejects.toMatchObject({ reason: 'uncertain' })
      const root = path.join(fixture.directory, 'device-workers-darwin')
      const held = path.join(fixture.directory, 'held-store')
      const names = await attemptNames(fixture.directory)
      const name = names[0]
      if (name === undefined) throw new Error('pending attempt missing')
      await rename(root, held)
      await mkdir(root, { mode: 0o700 })
      fixture.disableFailure()
      const calls = fixture.calls.length
      await expect(fixture.start()).rejects.toMatchObject({ detail: 'preflight' })
      expect(fixture.calls.slice(calls)).not.toContain('bootout')
      expect(fixture.calls.slice(calls)).not.toContain('bootstrap')
      expect(await readdir(root)).toEqual([])
      expect(await readFile(path.join(held, name, 'ready.json'), 'utf8')).toContain('coalition')
    } finally {
      await restoreFixture(fixture)
    }
  })
  it('concurrent launches share preparation, then retry one transient outcome together', async () => {
    const failure = darwinSpawnFailures[0]
    if (failure === undefined) throw new Error('failure fixture missing')
    const fixture = await spawnBoundaryFixture('aqua', failure)
    const { driver, start } = fixture
    try {
      const first = await Promise.allSettled([start(), start(), driver.selfTest()])
      for (const result of first)
        expect(result).toMatchObject({ status: 'rejected', reason: { detail: 'capacity' } })
      expect(fixture.calls).toEqual(['aqua'])
      fixture.disableFailure()
      const [left, right, supported] = await Promise.all([start(), start(), driver.selfTest()])
      expect(supported).toBe(true)
      expect(fixture.calls.filter((site) => site === 'aqua')).toHaveLength(2)
      expect(fixture.calls.filter((site) => site === 'self-test')).toHaveLength(1)
      expect(fixture.calls.filter((site) => site === 'bootstrap')).toHaveLength(3)
      for (const job of [left, right]) {
        await job.activate()
        await job.retirement
        await job.remove()
      }
      expect(await driver.selfTest()).toBe(true)
      expect(fixture.calls.filter((site) => site === 'aqua')).toHaveLength(2)
    } finally {
      vi.mocked(spawn).mockRestore()
      vi.mocked(execFile).mockRestore()
      vi.mocked(lstat).mockRestore()
      await fixture.clean()
    }
  })
  it.each(cases)(
    '$name has a typed result and correct preparation caching',
    async ({ site, failure }) => {
      const fixture = await spawnBoundaryFixture(site, failure)
      const { driver, start } = fixture
      let job: DeviceWorkerJob | undefined
      try {
        if (site === 'query' || site === 'active-print') {
          expect(await driver.selfTest()).toBe(true)
          fixture.disableFailure()
          if (site === 'active-print') job = await start()
          fixture.ready()
        }
        if (failure.delivery === 'timeout')
          vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const operation = site === 'query' || site === 'active-print' ? driver.query() : start()
        const result = (async () => {
          try {
            return await operation
          } catch (error) {
            return error
          }
        })()
        if (failure.delivery === 'timeout') {
          await fixture.injected
          await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.frameDeadlineMs)
        }
        const expected = {
          kind: failure.kind,
          detail: failure.detail,
          isRetryable: failure.retryable,
        }
        const isObserving = ['retirement-print', 'count', 'ps'].includes(site)
        expect(await result).toMatchObject(
          isObserving ? { reason: 'uncertain', cause: expected } : expected,
        )
        const aquaReads = fixture.calls.filter((current) => current === 'aqua').length
        const calls = fixture.calls.length
        fixture.disableFailure()
        vi.useRealTimers()
        if (isObserving) expect(await attemptNames(fixture.directory)).toEqual([])
        const isCached =
          !failure.retryable && !isObserving && site !== 'query' && site !== 'active-print'
        if (isCached) {
          await expect(start()).rejects.toMatchObject(expected)
          expect(fixture.calls).toHaveLength(calls)
        } else {
          const retry = await start()
          await retry.activate()
          await retry.retirement
          await retry.remove()
          expect(fixture.calls.slice(calls)).toContain('bootstrap')
          expect(fixture.calls.filter((current) => current === 'aqua')).toHaveLength(
            aquaReads + (site === 'query' || site === 'active-print' ? 0 : 1),
          )
        }
        if (job !== undefined) {
          await job.cancel()
          await job.retirement
          await job.remove()
        }
      } finally {
        vi.useRealTimers()
        vi.mocked(spawn).mockRestore()
        vi.mocked(execFile).mockRestore()
        vi.mocked(lstat).mockRestore()
        await fixture.clean()
      }
    },
  )
})

describe('M100/H Darwin unsupported manager port', () => {
  it('reads the Aqua session before an overflowing service listing and stops the query child', async () => {
    const actual = await vi.importActual<typeof ChildProcessModule>('node:child_process')
    const children: ChildProcess[] = []
    const script = String.raw`process.stdout.write('session = Aqua\n'); setInterval(() => process.stdout.write('x'.repeat(${String(DEVICE_LIMITS.frameBytes)})), 1)`
    vi.mocked(execFile).mockImplementation((...args) => {
      const child: unknown = Reflect.apply(actual.execFile, undefined, [
        process.execPath,
        ['-e', script],
        ...args.slice(2),
      ])
      if (!(child instanceof ChildProcess)) throw new Error('query child unavailable')
      children.push(child)
      return child
    })
    vi.mocked(spawn).mockImplementation((_file, _args, options) => {
      const child = actual.spawn(process.execPath, ['-e', script], options)
      children.push(child)
      return child
    })
    const directory = await mkdtemp(path.join(tmpdir(), 'm100-darwin-listing-'))
    try {
      // Refuse after the session probe, before compilation: this observes the
      // default native query without a compiler, launchd job or platform fixture.
      vi.mocked(lstat).mockRejectedValue(new Error('stop before compilation'))
      const driver = deviceWorkerDarwin({ storageDir: directory, environment: {}, uid: 502 })
      expect(await driver.selfTest()).toBe(false)
      expect(lstat).toHaveBeenCalledWith(path.join(directory, 'device-workers-darwin'))
      await expect
        .poll(() => children.every((child) => child.exitCode !== null || child.signalCode !== null))
        .toBe(true)
    } finally {
      for (const child of children) child.kill()
      vi.mocked(execFile).mockRestore()
      vi.mocked(spawn).mockRestore()
      vi.mocked(lstat).mockRestore()
      await rm(directory, { recursive: true, force: true })
    }
  })
  it.each([0, DEVICE_LIMITS.processes + 1])(
    'refuses process cap %s before any native call or attempt directory',
    async (processes) => {
      const directory = await mkdtemp(path.join(tmpdir(), 'm100-darwin-invalid-cap-'))
      const invoke = vi.fn<RunProgram>().mockRejectedValue(new Error('forbidden native call'))
      const driver = deviceWorkerDarwin({
        storageDir: directory,
        environment: {},
        spawn: fromRun(invoke),
      })
      try {
        await expect(
          driver.launch(
            { executable: process.execPath, args: [], cwd: directory, requiredTools: [] },
            {},
            attemptWith(processes),
          ),
        ).rejects.toMatchObject({ reason: 'unsupported-host', detail: 'preflight' })
        expect(invoke).not.toHaveBeenCalled()
        expect(await readdir(directory)).toEqual([])
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  )
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
      if (args[0] === '--self-test')
        return JSON.stringify({
          jobProbe: true,
          query: true,
          power: 'unknown',
          scheduler: 'untested',
        })
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
      // This fake Darwin port needs POSIX mode bits even on Windows. The native
      // suite uses the real filesystem through the default passthrough spy.
      const sample = await lstat(root)
      sample.mode &= ~0o077
      vi.mocked(lstat).mockResolvedValue(sample)
      const driver = deviceWorkerDarwin({
        storageDir: directory,
        environment: {},
        uid: owner.uid,
        spawn: fromRun(invoke),
      })
      const start = () =>
        driver.launch(
          { executable: process.execPath, args: [], cwd: directory, requiredTools: [] },
          {},
          attemptWith(),
        )
      await expect(start()).rejects.toMatchObject({ reason: 'capacity' })
      expect(invoke.mock.calls.every(([, args]) => args[0] !== 'bootstrap')).toBe(true)
      const names = await readdir(root)
      for (const name of names)
        if (name.startsWith('attempt-')) await rm(path.join(root, name), { recursive: true })
      await expect(start()).rejects.toMatchObject({ reason: 'unsupported-host' })
      expect(invoke.mock.calls.some(([, args]) => args[0] === 'bootstrap')).toBe(true)
    } finally {
      vi.mocked(lstat).mockRestore()
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('refuses a missing GUI domain before compilation or launch, without fallback', async () => {
    const invoke = vi.fn<RunProgram>().mockRejectedValue(new Error('manager unavailable'))
    const driver = deviceWorkerDarwin({
      storageDir: tmpdir(),
      environment: {},
      uid: 502,
      spawn: fromRun(invoke),
    })
    expect(await driver.selfTest()).toBe(false)
    await expect(
      driver.launch(
        { executable: process.execPath, args: [], cwd: tmpdir(), requiredTools: [] },
        {},
        attemptWith(),
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
      spawn: fromRun(invoke),
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
    const source = path.join(state.directory, 'uid-limit-probe.c')
    await writeFile(
      source,
      String.raw`
#include <libproc.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>
#include <spawn.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
int main(int argc, char **argv) {
  int bytes = proc_listpids(PROC_UID_ONLY, getuid(), NULL, 0);
  if (bytes <= 0) return 1;
  pid_t *pids = calloc(1, bytes); if (!pids) return 1;
  int actual = proc_listpids(PROC_UID_ONLY, getuid(), pids, bytes);
  free(pids); if (actual <= 0) return 1;
  struct rlimit limit = {2, 2}; if (setrlimit(RLIMIT_NPROC, &limit)) return 1;
  if (argc == 2) {
    char *probe[] = {argv[1], "--self-test", NULL};
    execv(probe[0], probe); return 1;
  }
  char *args[] = {"/usr/bin/true", NULL}, *env[] = {NULL}; pid_t child;
  int error = posix_spawn(&child, args[0], NULL, NULL, args, env);
  if (!error) { int status; if (waitpid(child, &status, 0) != child) return 1; }
  printf("{\"uidProcesses\":%lu,\"cap\":2,\"firstChildRefused\":%s}",
    (unsigned long)(actual / sizeof(pid_t)), error == EAGAIN ? "true" : "false");
  return 0;
}
`,
    )
    await run('/usr/bin/clang', [source, '-o', path.join(state.directory, 'uid-limit-probe')], {})
    await run(
      '/usr/bin/clang',
      [
        path.resolve('test/fixtures/device-workers/darwin-escape.c'),
        '-o',
        path.join(state.directory, 'escape-tree'),
      ],
      {},
    )
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
  it('proves natively that NumberOfProcesses cannot supply two per-job slots for this UID', async () => {
    const answer = z
      .strictObject({
        uidProcesses: z.int(),
        cap: z.literal(2),
        firstChildRefused: z.boolean(),
      })
      .parse(JSON.parse(await run(path.join(state.directory, 'uid-limit-probe'), [], {})))
    expect(answer).toMatchObject({ cap: 2, firstChildRefused: true })
    expect(answer.uidProcesses).toBeGreaterThan(2)
  })
  it('terminates cap 2 overflow including a setsid/double-fork escapee with capacity and no survivors', async () => {
    const fixture = await escapeTree(2)
    try {
      const tree = await fixture.create()
      expect(tree.escapeParent).toBe(1)
      expect(tree.escapeGroup).not.toBe(tree.rootGroup)
      expect(tree.escapeCoalition).toBe(tree.coalition)
      expect(tree.spawnReassignmentDenied).toBe(true)
      await fixture.resume()
      await expect.poll(() => survivors(tree)).toEqual([])
      expect(await fixture.job.retirement).toMatchObject({ failure: 'capacity' })
      expect(await native().query()).toMatchObject({ activeProcesses: 0, sleepInhibited: false })
    } finally {
      await fixture.clean()
    }
  })
  it('journals a supervised macOS capacity kill through the real receiver and host', async () => {
    const grant = deviceGrant('a'.repeat(32))
    const sent = signedDispatch(deviceCheck(grant))
    const journal = await AttemptJournal.create(
      path.join(await realpath(state.directory), 'capacity-journal'),
      { assertOwner: () => Promise.resolve() },
      executionProtection,
    )
    let command: DeviceWorkerCommand | undefined
    let job: DeviceWorkerJob | undefined
    const release = vi.fn(() => Promise.resolve())
    const host = new DeviceWorkerHost({
      driver: {
        ...native(),
        launch: async (...args) => {
          job = await native().launch(...args)
          return job
        },
      },
      environment: process.env,
      retain: () => Promise.resolve(),
      reserve: () => Promise.resolve({ usage, pause: () => Promise.resolve(), release }),
      command: () => {
        if (command === undefined) throw new Error('escape command unavailable')
        return Promise.resolve(command)
      },
      recordEnvironment: () => Promise.resolve(),
      pressure: () => undefined,
    })
    const receiver = await openWorkerReceiver(journal, host, grant)
    const fixture = await darwinEscapeTree(
      run,
      native(),
      state.directory,
      attemptWith(2),
      async (input) => {
        command = input
        const response = await receiver.dispatch(sent)
        expect(response.body).toMatchObject({ kind: 'outcome' })
        if (job === undefined) throw new Error('native job unavailable')
        return job
      },
    )
    try {
      const tree = await fixture.create()
      await fixture.resume()
      await expect.poll(() => survivors(tree)).toEqual([])
      await expect
        .poll(() => journal.lookup(sent.identity))
        .toMatchObject({
          kind: 'receiver-record',
          outcome: {
            state: 'retired',
            failure: 'capacity',
            usage,
            occupied: { workers: 0, processes: 0, heavyChecks: 0 },
          },
        })
      await expect.poll(() => release.mock.calls.length).toBe(1)
      const response = await receiver.dispatch(sent)
      expect(response.body).toMatchObject({
        kind: 'reconciled',
        outcomes: [{ failure: 'capacity', usage }],
      })
      if (response.body.kind !== 'reconciled') throw new Error('capacity result missing')
      const failure = response.body.outcomes[0]?.failure
      if (failure === undefined) throw new Error('capacity failure missing')
      expect(deviceFailureText(failure)).toBe(UI_TEXT.devices.capacityHelp)
      expect(await attempts()).toEqual([])
      expect(release).toHaveBeenCalledOnce()
    } finally {
      await fixture.clean()
    }
  })
  it('runs three processes at cap 3 to completion and counts the escapee', async () => {
    const fixture = await escapeTree(3)
    try {
      const tree = await fixture.create()
      await fixture.resume()
      await expect.poll(() => native().query()).toMatchObject({ activeProcesses: 3 })
      expect(survivors(tree)).toHaveLength(3)
      expect(tree.escapeCoalition).toBe(tree.coalition)
      await writeFile(fixture.release, '')
      expect(await fixture.job.retirement).toEqual({
        exitCode: 0,
        stdout: 'finished',
        failure: 'none',
      })
      expect(survivors(tree)).toEqual([])
    } finally {
      await fixture.clean()
    }
  })
  it('does not report retirement while the reparented escapee lives after root exit', async () => {
    const fixture = await escapeTree(3)
    let isRetired = false
    void fixture.job.retirement.then(() => {
      isRetired = true
    })
    try {
      const tree = await fixture.create()
      await fixture.resume()
      process.kill(tree.held, 'SIGKILL')
      await writeFile(fixture.rootExit, '')
      await expect.poll(() => survivors(tree)).toEqual([tree.escape])
      await expect
        .poll(() => native().query())
        .toMatchObject({ activeProcesses: 1, sleepInhibited: true })
      expect(isRetired).toBe(false)
      await expect(fixture.job.remove()).rejects.toMatchObject({ reason: 'uncertain' })
      await fixture.job.cancel()
      expect(await fixture.job.retirement).toEqual({
        exitCode: 0,
        stdout: 'finished',
        failure: 'none',
      })
      expect(survivors(tree)).toEqual([])
      expect(isRetired).toBe(true)
    } finally {
      await fixture.clean()
    }
  })
  it('settles a native unsupported manager as refused not-run work and releases once', async () => {
    const release = vi.fn(() => Promise.resolve())
    const driver = freshDriver((file, args, env) =>
      args[0] === 'print' ? Promise.reject(new Error('manager unavailable')) : run(file, args, env),
    )
    const host = new DeviceWorkerHost({
      driver,
      environment: process.env,
      retain: () => Promise.resolve(),
      reserve: () => Promise.resolve({ usage, pause: () => Promise.resolve(), release }),
      command: () =>
        Promise.resolve({
          executable: process.execPath,
          args: [],
          cwd: state.directory,
          requiredTools: [],
        }),
      recordEnvironment: () => Promise.resolve(),
      pressure: () => undefined,
    })
    const attempt = await host.admit(deviceCheck(deviceGrant('a'.repeat(32))))
    await expect(attempt.start(boundary)).rejects.toMatchObject({ reason: 'unsupported-host' })
    await expect(attempt.retirement).resolves.toEqual({ refused: true, usage })
    await attempt.release()
    await attempt.release()
    expect(release).toHaveBeenCalledOnce()
    expect(await attempts()).toEqual([])
  })
  it('reports only the native job probe and leaves scheduler qualification unclaimed', async () => {
    const answer: unknown = JSON.parse(await run(await helperFile(), ['--self-test'], {}))
    expect(answer).toEqual({
      jobProbe: true,
      query: true,
      power: expect.stringMatching(/^(?:ac|battery|unknown)$/),
      scheduler: 'untested',
    })
  })
  it('reports native self-test spawn capacity and retries preparation after UID pressure', async () => {
    let shouldLimit = true
    const invoke = vi.fn<RunProgram>(async (file, args, env) => {
      if (shouldLimit && args[0] === '--self-test') {
        shouldLimit = false
        const output = await run(path.join(state.directory, 'uid-limit-probe'), [file], env)
        const answer: unknown = JSON.parse(output)
        expect(answer).toEqual({
          jobProbe: false,
          query: true,
          power: expect.stringMatching(/^(?:ac|battery|unknown)$/),
          scheduler: 'untested',
          failure: 'capacity',
        })
        return output
      }
      return await run(file, args, env)
    })
    const driver = freshDriver(invoke)
    await expect(launch('process.exit(0)', driver)).rejects.toMatchObject({
      reason: 'capacity',
      detail: 'capacity',
    })
    expect(invoke.mock.calls.some(([, args]) => args[0] === 'bootstrap')).toBe(false)
    await complete(await launch('process.exit(0)', driver))
    expect(await attempts()).toEqual([])
  })
  it.each([1, 2, DEVICE_LIMITS.processes])(
    'activates admitted per-job cap %s with the exact limit in the native request',
    async (processes) => {
      const job = await native().launch(
        { executable: '/usr/bin/true', args: [], cwd: state.directory, requiredTools: [] },
        {},
        attemptWith(processes),
      )
      await complete(job, async () => {
        const context = parseDeviceWorkerQuery(job.query).context
        const config: unknown = JSON.parse(
          await readFile(
            path.join(
              state.directory,
              'device-workers-darwin',
              `attempt-${context.desktop}`,
              'request.json',
            ),
            'utf8',
          ),
        )
        expect(config).toMatchObject({
          maxProcesses: processes,
          pollUs: POSIX_TREE_EXIT_POLL_MS * MILLISECONDS_PER_SECOND,
        })
      })
      expect(await attempts()).toEqual([])
    },
  )
  it('self-tests a real GUI job and leaves no registration or inhibitor', async () => {
    const bounded = deviceWorkerDarwin({ storageDir: state.directory, environment: process.env })
    expect(await bounded.selfTest()).toBe(true)
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
  it.each(
    ['EAGAIN', 'ENOMEM'].flatMap((code) =>
      ['error', 'throw'].map((delivery) => ({ code, delivery })),
    ),
  )(
    'retries the Aqua probe after transient spawn $delivery $code and launches a real GUI job',
    async ({ code, delivery }) => {
      vi.mocked(spawn).mockClear()
      vi.mocked(execFile).mockClear()
      vi.mocked(spawn).mockImplementationOnce(() => {
        if (delivery === 'throw')
          throw Object.assign(new Error('injected process pressure'), { code })
        const child = new ChildProcess()
        child.stdout = new PassThrough()
        child.stderr = new PassThrough()
        // An unspawned native handle must never signal the test process group.
        vi.spyOn(child, 'kill').mockReturnValue(false)
        queueMicrotask(() => {
          child.emit('error', Object.assign(new Error('injected process pressure'), { code }))
        })
        return child
      })
      const driver = deviceWorkerDarwin({ storageDir: state.directory, environment: process.env })
      try {
        await expect(launch('process.exit(0)', driver)).rejects.toMatchObject({
          reason: 'capacity',
          detail: 'capacity',
        })
        expect(spawn).toHaveBeenCalledExactlyOnceWith(
          '/bin/launchctl',
          ['print', `gui/${String(uid())}`],
          expect.anything(),
        )
        expect(execFile).not.toHaveBeenCalled()
        expect(await attempts()).toEqual([])
        await complete(await launch('process.exit(0)', driver))
        expect(
          vi
            .mocked(spawn)
            .mock.calls.filter(
              ([, args]) => args[0] === 'print' && args[1] === `gui/${String(uid())}`,
            ),
        ).toHaveLength(2)
        expect(vi.mocked(spawn).mock.calls.some(([, args]) => args[0] === 'bootstrap')).toBe(true)
        expect(await attempts()).toEqual([])
      } finally {
        vi.mocked(spawn).mockRestore()
      }
    },
  )
  it.each(['once', 'until recovery'])(
    'reclaims a real probe after count pressure %s, including a reaped coalition',
    async (delivery) => {
      const actual = await vi.importActual<typeof ChildProcessModule>('node:child_process')
      let isArmed = true
      const driver = deviceWorkerDarwin({
        storageDir: state.directory,
        environment: process.env,
        spawn: (file, args, options) => {
          if (isArmed && args[0] === '--count') {
            isArmed = delivery !== 'once'
            throw Object.assign(new Error('injected count pressure'), { code: 'ENOMEM' })
          }
          if (args[0] === 'bootstrap' && args[2] !== undefined)
            state.labels.add(path.basename(path.dirname(args[2])).slice('attempt-'.length))
          return actual.spawn(file, [...args], options)
        },
      })
      await expect(launch('process.exit(0)', driver)).rejects.toMatchObject({ reason: 'uncertain' })
      expect(await attempts()).toHaveLength(delivery === 'once' ? 0 : 1)
      isArmed = false
      await complete(await launch('process.exit(0)', driver))
      expect(await attempts()).toEqual([])
      expect(await driver.query()).toMatchObject({ activeProcesses: 0 })
    },
  )
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
        attemptWith(),
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
    await writeFile(await helperFile(), 'corrupted native helper')
    const invoke = vi.fn<RunProgram>(run)
    const driver = freshDriver(invoke)
    expect(await driver.selfTest()).toBe(false)
    await expect(
      driver.launch(
        { executable: process.execPath, args: [], cwd: state.directory, requiredTools: [] },
        {},
        attemptWith(),
      ),
    ).rejects.toMatchObject({ reason: 'unsupported-host' })
    expect(invoke.mock.calls.some(([, args]) => args[0] === 'bootstrap')).toBe(false)
    expect(await attempts()).toEqual([])
  })
})
