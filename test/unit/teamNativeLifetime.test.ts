import process from 'node:process'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'
import * as z from 'zod/mini'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { jobSourceReader } from '../../src/host/backend/jobSource'
import { createNativeOrphanDriver, createOrphanRecovery } from '../../src/host/team/orphanRecovery'
import * as processOwnership from '../../src/host/team/processOwnership'
import * as orphanRecovery from '../../src/host/team/orphanRecovery'
import * as timeouts from '../../src/core/timeouts'
import * as processTree from '../../src/host/processTree'
import {
  createNativeTeamProcessDriver,
  createTeamProcessLifetime,
  startNativeTeamLifetime,
  startTeamMuseCodeHost,
  type TeamProcessDriver,
} from '../../src/host/team/processLifetime'
import { createTeamJournal } from '../../src/host/team/teamJournal'
import { createWindowAuthority, createWindowIdentity } from '../../src/host/team/windowIdentity'

const directories: string[] = []
const stops: (() => Promise<unknown>)[] = []
const native: { driver: TeamProcessDriver | undefined; directory: string } = {
  driver: undefined,
  directory: '',
}
function windowsOptions() {
  return {
    storageDir: native.directory,
    systemRoot: process.env['SystemRoot'] ?? String.raw`C:\Windows`,
    readJobSource: jobSourceReader(process.cwd()),
    log: () => {
      /* Preparation must succeed. */
    },
  }
}
beforeAll(async () => {
  native.directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'm96-driver-')))
  native.driver = await createNativeTeamProcessDriver({
    killGraceMs: 100,
    windows: windowsOptions(),
  })
})
afterAll(async () => {
  await rm(native.directory, { recursive: true, force: true })
})
afterEach(async () => {
  vi.restoreAllMocks()
  for (const stop of stops.splice(0)) await stop()
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function fixture() {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'm96-native-')))
  directories.push(directory)
  const driver = native.driver
  if (driver === undefined) throw new Error('native driver not prepared')
  const owner = createWindowIdentity(Date.now())
  const journal = createTeamJournal({
    storageDirectory: directory,
    owner,
    authority: createWindowAuthority(owner, () => Promise.reject(new Error('unexpected takeover'))),
    maxRecordBytes: 1024 * 1024,
    platform: process.platform,
  })
  const lifetime = createTeamProcessLifetime({ journal, driver, isHostBusy: () => false })
  stops.push(() => lifetime.dispose())
  const request = (code: string) => ({
    command: process.execPath,
    args: ['-e', code],
    cwd: directory,
    taskId: 'native-task',
    env: { PATH: process.env['PATH'], SystemRoot: process.env['SystemRoot'] },
    priority: 'belowNormal' as const,
  })
  return { directory, lifetime, journal, request }
}

async function until(isReady: () => Promise<boolean>) {
  const deadline = Date.now() + 4000
  while (!(await isReady())) {
    if (Date.now() >= deadline) throw new Error('native observation deadline')
    await delay(10)
  }
}

async function standaloneOwner(directory: string, code: string, env?: NodeJS.ProcessEnv) {
  const launcher = path.join(directory, 'owner.cjs')
  await build({
    stdin: {
      contents: String.raw`const {createNativeTeamProcessDriver}=require('./src/host/team/processLifetime'); const sources=require('./src/host/backend/jobSource'); (async()=>{ const driver=await createNativeTeamProcessDriver({killGraceMs:100,windows:{storageDir:${JSON.stringify(native.directory)},systemRoot:process.env.SystemRoot,readJobSource:sources.jobSourceReader(process.cwd()),log:()=>{}}});const child=driver.launch({command:process.execPath,args:['-e',${JSON.stringify(code)}],cwd:process.cwd(),taskId:'owner',env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH},priority:'belowNormal'},${JSON.stringify(randomUUID())}); const confirmation=await child.confirmation; await child.resume?.(confirmation);process.stdout.write("READY\n");setInterval(()=>{},1000) })().catch(error=>{process.stderr.write(String(error));process.exit(1)})`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    outfile: launcher,
    bundle: true,
    platform: 'node',
    format: 'cjs',
  })
  const parent = spawn(process.execPath, [launcher], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(env !== undefined && { env }),
  })
  const parentExited = new Promise<void>((resolve) =>
    parent.once('exit', () => {
      resolve()
    }),
  )
  const parentClosed = new Promise<void>((resolve) =>
    parent.once('close', () => {
      resolve()
    }),
  )
  stops.push(async () => {
    parent.kill()
    await parentClosed
  })
  // A crash fixture must have a confirmed live owner before the observation
  // clock starts. Preparation still runs within Vitest's unchanged deadline.
  await new Promise<void>((resolve, reject) => {
    let status = ''
    let errors = ''
    parent.stderr.on('data', (chunk: Buffer) => {
      errors += chunk.toString('utf8')
    })
    parent.stdout.on('data', (chunk: Buffer) => {
      status += chunk.toString('utf8')
      if (status === 'READY\n') resolve()
    })
    parent.once('error', reject)
    parent.once('exit', () => {
      reject(new Error(`native owner exited before readiness: ${errors}`))
    })
  })
  return { parent, parentExited }
}

describe('M96 K real native lifetime', () => {
  it('starts a separate journalled team Muse Code host over real fake-CLI pipes', async () => {
    const f = await fixture()
    const host = await startTeamMuseCodeHost({
      lifetime: f.lifetime,
      request: {
        ...f.request(''),
        args: [path.join(process.cwd(), 'test/e2e/fake-muse/serve.mjs'), 'serve'],
      },
      extensionVersion: 'test',
      log: {
        trace: () => {
          /* Synthetic protocol trace is not model traffic. */
        },
        info: () => {
          /* Fake host diagnostics are not credentials or model traffic. */
        },
        warn: () => {
          /* Assertions cover host creation. */
        },
        error: () => {
          /* Assertions cover host creation. */
        },
      },
    })
    expect(host.info.kind).toBe('museCode')
    const records = await f.lifetime.recoveryRecords(f.journal)
    expect(records).toHaveLength(1)
    expect(records[0]?.confirmation).toBeDefined()
    await host.close()
  })
  it('rejects MSP writes to closed stdin without an unhandled pipe error', async () => {
    const f = await fixture()
    // Use the direct pipe on every platform; a Windows helper has a separate stdin copier.
    const child = spawn(
      process.execPath,
      [
        '-e',
        String.raw`require('node:fs').closeSync(0);process.stdout.write('READY\n');setTimeout(()=>{},20000)`,
      ],
      { cwd: f.directory, env: f.request('').env, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    const closed = new Promise<void>((resolve) => {
      child.once('close', () => {
        resolve()
      })
    })
    const retire = async () => {
      child.kill()
      await closed
      return { childExited: true, descendants: 'uncertain' as const }
    }
    stops.push(retire)
    await new Promise<void>((resolve) => {
      child.stdout.once('data', () => {
        resolve()
      })
    })
    await expect(
      startTeamMuseCodeHost({
        lifetime: {
          launch: () =>
            Promise.resolve({
              child,
              launchId: randomUUID(),
              confirmation: Promise.resolve({
                pid: child.pid ?? 1,
                group: 'fixture',
                startTime: 'fixture',
                container: 'processGroup' as const,
              }),
              ended: (async () => {
                await closed
                return { childExited: true, descendants: 'uncertain' as const }
              })(),
              retire,
            }),
          dispose: () => Promise.resolve([]),
          recoveryRecords: () => Promise.resolve([]),
        },
        request: f.request(''),
        extensionVersion: 'test',
        log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }),
    ).rejects.toMatchObject({ code: 'EPIPE' })
    expect(child.stdin.listenerCount('error')).toBeGreaterThan(0)
  })
  it('preserves the real command exit code through its native container', async () => {
    const f = await fixture()
    const launched = await f.lifetime.launch(f.request('setTimeout(()=>process.exit(7),700)'))
    const exit =
      launched.child.exitCode ??
      (await Promise.race([
        new Promise<number | null>((resolve) => {
          launched.child.once('exit', resolve)
        }),
        delay(2000, null),
      ]))
    expect(exit).toBe(7)
    const end = await launched.ended
    if (process.platform !== 'win32') {
      return
    }

    expect(end).toEqual({ childExited: true, descendants: 'proved' })
    expect(await f.lifetime.recoveryRecords(f.journal)).toEqual([])
  })
  it('warns about malformed launch payloads at startup and preserves all foreign bytes', async () => {
    const f = await fixture()
    const child = await f.lifetime.launch(f.request('setTimeout(()=>{},20000)'))
    const record = path.join(
      f.directory,
      'team',
      'journal',
      f.journal.owner.instanceId,
      `launch-${child.launchId}.json`,
    )
    const original = await readFile(record)
    const broken = path.join(path.dirname(record), 'damaged.json')
    await writeFile(broken, '{broken')
    const malformed = path.join(path.dirname(record), 'launch-damaged.json')
    const damaged: unknown = JSON.parse(original.toString('utf8'))
    const envelope = z
      .object({ owner: z.unknown(), value: z.record(z.string(), z.unknown()) })
      .parse(damaged)
    const malformedBytes = JSON.stringify({
      version: 1,
      owner: envelope.owner,
      value: { ...envelope.value, confirmation: { pid: 'broken' } },
    })
    await writeFile(malformed, malformedBytes)
    const owner = createWindowIdentity(Date.now())
    const journal = createTeamJournal({
      storageDirectory: f.directory,
      owner,
      authority: createWindowAuthority(owner, () =>
        Promise.reject(new Error('unexpected takeover')),
      ),
      maxRecordBytes: 1024 * 1024,
      platform: process.platform,
    })
    const started = await startNativeTeamLifetime({
      journal,
      isHostBusy: () => false,
      killGraceMs: 100,
      windows: windowsOptions(),
    })
    stops.push(() => started.lifetime.dispose())
    expect(started.records.map((row) => row.id)).toEqual([child.launchId])
    expect(started.unreadable).toEqual([broken, malformed])
    if (process.platform !== 'win32')
      expect(started.orphans.map((row) => row.launchId)).toContain(child.launchId)
    expect(await readFile(record)).toEqual(original)
    expect(await readFile(broken, 'utf8')).toBe('{broken')
    expect(await readFile(malformed, 'utf8')).toBe(malformedBytes)
  })
  it('runs marked child at below-normal priority with intent and OS confirmation on disk', async () => {
    const f = await fixture()
    const output = path.join(f.directory, 'observed.json')
    const code = `require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({marker:process.env.MUSE_SPARK_LAUNCH_ID, priority:require('node:os').getPriority()})); setTimeout(()=>{}, 20000)`
    const child = await f.lifetime.launch(f.request(code))
    await until(async () => {
      try {
        JSON.parse(await readFile(output, 'utf8'))
        return true
      } catch {
        return false
      }
    })
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual({
      marker: child.launchId,
      priority: os.constants.priority.PRIORITY_BELOW_NORMAL,
    })
    const records = await f.lifetime.recoveryRecords(f.journal)
    expect(records).toHaveLength(1)
    expect(records[0]?.confirmation?.pid).toBeGreaterThan(1)
    expect(records[0]?.confirmation?.startTime).not.toBe('')
    expect(records[0]?.confirmation?.executable).toBe(await realpath(process.execPath))
    expect(records[0]?.confirmation?.uid).toEqual(
      process.platform === 'win32' ? expect.stringMatching(/^S-1-/) : process.getuid?.(),
    )
    expect(records[0]?.confirmation?.container).toEqual(
      process.platform === 'win32'
        ? 'windowsJob'
        : expect.stringMatching(/linuxScope|processGroup/),
    )
    const outcome = await child.retire()
    if (process.platform === 'win32') expect(child.child.exitCode).not.toBeNull()
    expect(outcome.childExited).toBe(true)
    if (process.platform === 'win32') expect(outcome.descendants).toBe('proved')
  })

  it('aborts a held confirmation on dispose without releasing the real command', async () => {
    const f = await fixture()
    const barrier = new EventTarget()
    const saved = new Promise<void>((resolve) => {
      barrier.addEventListener(
        'saved',
        () => {
          resolve()
        },
        { once: true },
      )
    })
    const release = new Promise<void>((resolve) => {
      barrier.addEventListener(
        'release',
        () => {
          resolve()
        },
        { once: true },
      )
    })
    const write = f.journal.write
    vi.spyOn(f.journal, 'write').mockImplementation(async (name, value, schema) => {
      await write(name, value, schema)
      const record = z.object({ confirmation: z.optional(z.unknown()) }).parse(value)
      if (record.confirmation === undefined) return
      barrier.dispatchEvent(new Event('saved'))
      await release
    })
    const output = path.join(f.directory, 'executed-after-dispose')
    const pending = f.lifetime.launch(
      f.request(`require('node:fs').writeFileSync(${JSON.stringify(output)},'executed')`),
    )
    const rejected = expect(pending).rejects.toThrow('DISPOSED')
    await saved
    const disposing = f.lifetime.dispose()
    barrier.dispatchEvent(new Event('release'))
    await rejected
    await disposing
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  if (process.platform !== 'win32') {
    async function fallbackDriver() {
      const runProgram = processTree.runProgram
      vi.spyOn(processTree, 'runProgram').mockImplementation((file, args, env) =>
        file === 'systemd-run'
          ? Promise.reject(new Error('fixture-no-scope'))
          : runProgram(file, args, env),
      )
      const observer = createNativeOrphanDriver()
      vi.spyOn(orphanRecovery, 'createNativeOrphanDriver').mockReturnValue(observer)
      const driver = await createNativeTeamProcessDriver({ killGraceMs: 100 })
      return { driver, observer }
    }

    async function fallbackFixture() {
      const f = await fixture()
      const { driver, observer } = await fallbackDriver()
      const lifetime = createTeamProcessLifetime({
        journal: f.journal,
        driver,
        isHostBusy: () => false,
      })
      return { ...f, lifetime, observer }
    }

    async function runningFallbackFixture() {
      const f = await fallbackFixture()
      const child = await f.lifetime.launch(f.request('setTimeout(()=>{},20000)'))
      stops.push(() => f.lifetime.dispose())
      return { ...f, child }
    }

    for (const wasReportedUnowned of [true, false]) {
      it(`retirement and dispose never await an unowned primary after survivor signals: ${String(wasReportedUnowned)}`, async () => {
        const f = await fallbackFixture()
        const original = processOwnership.createProcessOwnership
        const signalLaunch = vi.fn(() =>
          Promise.resolve({ signalled: [42_043], notOwned: [42_042] }),
        )
        vi.spyOn(processOwnership, 'createProcessOwnership').mockImplementation((driver) => ({
          ...original(driver),
          isOwned: () => Promise.resolve(false),
          signalLaunch: async (expected) => {
            const result = await signalLaunch()
            return { ...result, notOwned: wasReportedUnowned ? [expected.pid] : [] }
          },
        }))
        const child = await f.lifetime.launch(f.request('setInterval(()=>{},1000)'))
        stops.push(async () => {
          const closed = new Promise<void>((resolve) =>
            child.child.once('close', () => {
              resolve()
            }),
          )
          child.child.kill()
          await closed
          await child.ended
          await f.lifetime.dispose()
        })
        const { pid } = await child.confirmation
        const retirement = child.retire()
        expect(await Promise.race([retirement, delay(1000, 'pending')])).toEqual({
          childExited: false,
          descendants: 'uncertain',
          notOwned: [pid],
        })
        expect(await Promise.race([f.lifetime.dispose(), delay(1000, 'pending')])).toEqual([
          { childExited: false, descendants: 'uncertain', notOwned: [pid] },
        ])
        expect(signalLaunch).toHaveBeenCalledTimes(4)
      })
    }

    it('bounds the exit wait even when an owned primary does not acknowledge signals', async () => {
      const f = await runningFallbackFixture()
      const { child, observer } = f
      const retired = child.retire
      vi.spyOn(observer, 'signal').mockResolvedValue(true)
      const originalDeadline = timeouts.withDeadline
      const entered = Promise.withResolvers<number>()
      vi.spyOn(timeouts, 'withDeadline').mockImplementation(
        <T>(work: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
          const bounded = originalDeadline(work, timeoutMs, message)
          if (message === 'TEAM_RETIREMENT_TIMEOUT') entered.resolve(timeoutMs)
          return bounded
        },
      )
      // Real native ownership/signalling stays live; only the long deadline's
      // clock advances. The fixed five-second test gate no longer waits five
      // seconds just to prove that production's five-second deadline fires.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const retirement = retired()
      let hasSettled = false
      const result = (async () => {
        try {
          await retirement
          return 'retired'
        } catch (error: unknown) {
          return error instanceof Error ? error.message : 'unexpected error'
        } finally {
          hasSettled = true
        }
      })()
      try {
        const deadlineMs = await Promise.race([
          entered.promise,
          (async () => {
            await result
            return -1
          })(),
          delay(7000, -1),
        ])
        expect(deadlineMs).toBe(5000)
        await vi.advanceTimersByTimeAsync(deadlineMs - 1)
        expect(hasSettled).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(await result).toBe('TEAM_RETIREMENT_TIMEOUT')
      } finally {
        vi.useRealTimers()
        child.child.kill()
        await result
        await child.ended
      }
    })

    if (process.platform === 'darwin') {
      function macChild(
        directory: string,
        env: NodeJS.ProcessEnv,
        extraArgs: readonly string[] = [],
      ) {
        const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', ...extraArgs], {
          cwd: directory,
          env,
          detached: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        const closed = new Promise<void>((resolve) => {
          child.once('close', () => {
            resolve()
          })
        })
        stops.push(async () => {
          child.kill()
          await closed
        })
        return child
      }

      it('native macOS reads libproc identity and never mistakes argv for an environment marker', async () => {
        const f = await fixture()
        const id = randomUUID()
        const child = macChild(f.directory, {}, [`MUSE_SPARK_LAUNCH_ID=${id}`])
        await delay(100)
        const driver = createNativeOrphanDriver()
        const identity = await driver.observe(child.pid ?? 0)
        expect(identity).toMatchObject({
          pid: child.pid,
          executable: await realpath(process.execPath),
          uid: process.getuid?.(),
          launchId: undefined,
        })
        const recovery = createOrphanRecovery(driver)
        const found = await recovery.find([
          { id, command: process.execPath, cwd: f.directory, taskId: 'argv-only' },
        ])
        expect(found.some((row) => row.pid === child.pid)).toBe(false)
        expect(child.exitCode).toBeNull()
      })

      it('native macOS ignores an invalid marker without aborting valid process discovery', async () => {
        const f = await fixture()
        const child = macChild(f.directory, {
          MUSE_SPARK_LAUNCH_ID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        })
        await delay(100)
        const found = await createNativeOrphanDriver().scan([])
        expect(found.some((row) => row.pid === process.pid)).toBe(true)
        expect(found.some((row) => row.pid === child.pid)).toBe(false)
      })

      it('native macOS environment markers locate candidates but cannot supply journal ownership', async () => {
        const f = await fixture()
        const id = randomUUID()
        const child = macChild(f.directory, { MUSE_SPARK_LAUNCH_ID: id })
        await delay(100)
        const driver = createNativeOrphanDriver()
        expect(await driver.observe(child.pid ?? 0)).toMatchObject({ launchId: id })
        const recovery = createOrphanRecovery(driver)
        const found = await recovery.find([
          { id, command: process.execPath, cwd: f.directory, taskId: 'env-only' },
        ])
        const orphan = found.find((row) => row.pid === child.pid)
        if (orphan === undefined) throw new Error('environment fixture missing')
        expect(orphan.match).toBe('uncertain')
        const signal = vi.spyOn(driver, 'signal')
        expect(await recovery.stop(orphan, true)).toBe('changed')
        expect(signal).not.toHaveBeenCalled()
        expect(child.exitCode).toBeNull()
      })
    }

    it('signals nothing on disposal after PID and process-group reuse', async () => {
      const f = await runningFallbackFixture()
      const { lifetime, observer, child } = f
      const confirmation = await child.confirmation
      child.child.kill()
      await child.ended
      vi.spyOn(observer, 'observe').mockResolvedValue({
        pid: confirmation.pid,
        group: confirmation.group,
        startTime: 'reused-start',
        executable: '/foreign/program',
        uid: process.getuid?.(),
        launchId: child.launchId,
        command: 'unrelated-process',
      })
      const signal = vi.spyOn(process, 'kill').mockReturnValue(true)
      const ownedSignal = vi.spyOn(observer, 'signal')
      expect(await lifetime.dispose()).toMatchObject([
        { childExited: true, descendants: 'uncertain' },
      ])
      expect(signal).not.toHaveBeenCalled()
      expect(ownedSignal).not.toHaveBeenCalled()
      expect(await lifetime.recoveryRecords(f.journal)).toMatchObject([{ id: child.launchId }])
    })

    it('rechecks the leader identity before KILL after TERM', async () => {
      const f = await fallbackFixture()
      const { lifetime, observer } = f
      const child = await lifetime.launch(f.request('setTimeout(()=>{},20000)'))
      stops.push(async () => {
        const closed = new Promise<void>((resolve) => {
          child.child.once('close', () => {
            resolve()
          })
        })
        child.child.kill()
        await closed
        await child.ended
      })
      const confirmation = await child.confirmation
      const observe = observer.observe
      let wasTermSent = false
      vi.spyOn(observer, 'observe').mockImplementation(async (pid) => {
        const current = await observe(pid)
        return current !== undefined && wasTermSent
          ? { ...current, startTime: 'reused-start' }
          : current
      })
      const signal = vi.spyOn(observer, 'signal').mockImplementation(() => {
        wasTermSent = true
        return Promise.resolve(true)
      })
      expect(await lifetime.dispose()).toMatchObject([
        { childExited: false, descendants: 'uncertain' },
      ])
      expect(signal.mock.calls).toEqual([
        [
          expect.objectContaining({ pid: confirmation.pid }),
          'SIGTERM',
          process.platform === 'darwin',
        ],
      ])
    })

    if (process.platform === 'linux') {
      it('reports real unrecorded marked group members after their leader exits', async () => {
        const f = await fallbackFixture()
        const { lifetime, observer } = f
        stops.push(() => lifetime.dispose())
        const output = path.join(f.directory, 'survivor')
        const child = await lifetime.launch(
          f.request(
            `const child=require('node:child_process').spawn('/usr/bin/sleep',['20'],{stdio:'ignore'});child.unref();require('node:fs').writeFileSync(${JSON.stringify(output)},String(child.pid))`,
          ),
        )
        await child.ended
        const pid = Number(await readFile(output, 'utf8'))
        const survivor = await observer.observe(pid)
        if (survivor === undefined) throw new Error('survivor fixture missing')
        stops.push(async () => {
          await createNativeOrphanDriver().signal(survivor, 'SIGKILL', false)
        })
        const signal = vi.spyOn(observer, 'signal')
        const outcome = await child.retire()
        const confirmation = await child.confirmation
        expect(outcome).toMatchObject({
          childExited: true,
          descendants: 'uncertain',
          notOwned: expect.arrayContaining([confirmation.pid, pid]),
        })
        expect(signal).not.toHaveBeenCalled()
        expect(await observer.observe(pid)).toBeDefined()
      })

      it('signals Linux through a stable pidfd and rejects a changed final identity', async () => {
        const f = await fixture()
        const child = await f.lifetime.launch(f.request('setTimeout(()=>{},20000)'))
        const observer = createNativeOrphanDriver()
        const confirmation = await child.confirmation
        const identity = await observer.observe(confirmation.pid)
        if (identity === undefined) throw new Error('pidfd fixture missing')
        expect(await observer.signal({ ...identity, startTime: 'reused' }, 'SIGKILL', false)).toBe(
          false,
        )
        expect(await observer.observe(identity.pid)).toBeDefined()
        const run = processTree.runProgram
        const helper = vi
          .spyOn(processTree, 'runProgram')
          .mockImplementation(async (file, args, env) => {
            if (file !== '/usr/bin/python3') return await run(file, args, env)
            expect(env).toEqual({})
            const code = args[2]
            if (code === undefined) throw new Error('pidfd helper missing')
            const instrumented = code.replace(
              'fd=None',
              () => String.raw`
def forbidden(*args): raise RuntimeError('raw PID signalling is forbidden')
os.kill=forbidden
original_send=signal.pidfd_send_signal
def checked_send(fd,signum):
    with open('/proc/self/fdinfo/'+str(fd)) as file: information=file.read()
    assert re.search(r'^Pid:\s+'+str(expected['pid'])+r'$',information,re.M)
    original_send(fd,signum)
signal.pidfd_send_signal=checked_send
fd=None`,
            )
            return await run(file, [...args.slice(0, 2), instrumented, ...args.slice(3)], env)
          })
        expect(await observer.signal(identity, 'SIGKILL', false)).toBe(true)
        expect(await child.ended).toMatchObject({ childExited: true })
        expect(helper).toHaveBeenCalledTimes(1)
      })

      it('uses a monotonic confirmation deadline through a backward wall-clock jump', async () => {
        const f = await fixture()
        const { driver, observer } = await fallbackDriver()
        const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
        const wall = Date.now()
        vi.spyOn(observer, 'observe').mockImplementation(() => {
          vi.spyOn(Date, 'now').mockReturnValue(wall - 86_400_000)
          clock.mockReturnValue(6000)
          return Promise.resolve(undefined)
        })
        const child = driver.launch(f.request('setTimeout(()=>{},20000)'), randomUUID())
        const outcome = (async () => {
          try {
            await child.confirmation
            return 'confirmed'
          } catch (error: unknown) {
            return error instanceof Error ? error.message : 'unknown'
          }
        })()
        const result = await Promise.race([outcome, delay(100, 'pending')])
        await child.retire()
        await outcome
        expect(result).toBe('TEAM_CONFIRMATION_TIMEOUT')
      })

      it('never signals a foreign Python-led group containing a marked child', async () => {
        const f = await fixture()
        const id = randomUUID()
        const parent = spawn(
          '/usr/bin/python3',
          [
            '-I',
            '-c',
            'import os,subprocess,sys,time; child=subprocess.Popen(["/usr/bin/sleep","20"],env={"MUSE_SPARK_LAUNCH_ID":sys.argv[1]}); print(child.pid,flush=True); time.sleep(20)',
            id,
          ],
          { cwd: f.directory, env: {}, detached: true, stdio: ['pipe', 'pipe', 'pipe'] },
        )
        const pid = await new Promise<number>((resolve, reject) => {
          parent.stdout.once('data', (bytes: Buffer) => {
            resolve(Number(bytes.toString('utf8').trim()))
          })
          parent.once('error', reject)
        })
        const observer = createNativeOrphanDriver()
        const leader = await observer.observe(parent.pid ?? 0)
        const member = await observer.observe(pid)
        if (leader === undefined || member === undefined) throw new Error('foreign fixture missing')
        stops.push(async () => {
          const cleanup = createNativeOrphanDriver()
          await cleanup.signal(member, 'SIGKILL', false)
          await cleanup.signal(leader, 'SIGKILL', false)
        })
        const recovery = createOrphanRecovery(observer)
        const found = await recovery.find([
          { id, command: 'fixture', cwd: f.directory, taskId: 'foreign-group' },
        ])
        const orphan = found.find((row) => row.pid === pid)
        if (orphan === undefined) throw new Error('marked foreign-group member missing')
        const signal = vi.spyOn(observer, 'signal').mockResolvedValue(true)
        const rawKill = vi.spyOn(process, 'kill').mockReturnValue(true)
        expect(orphan.match).toBe('uncertain')
        expect(await recovery.stop(orphan, true)).toBe('changed')
        expect(signal).not.toHaveBeenCalled()
        expect(rawKill).not.toHaveBeenCalled()
        expect(await observer.observe(leader.pid)).toMatchObject({ startTime: leader.startTime })
      })

      it('reproves ownership and retries native retirement after transient EPERM', async () => {
        const f = await runningFallbackFixture()
        const { observer, child } = f
        const confirmation = await child.confirmation
        const identity = await observer.observe(confirmation.pid)
        if (identity === undefined) throw new Error('retry fixture missing')
        stops.push(async () => {
          await createNativeOrphanDriver().signal(identity, 'SIGKILL', false)
        })
        const original = observer.signal
        const signal = vi
          .spyOn(observer, 'signal')
          .mockRejectedValueOnce(Object.assign(new Error('transient EPERM'), { code: 'EPERM' }))
          .mockImplementation(original)
        const observed = vi.spyOn(observer, 'observe')
        await expect(child.retire()).rejects.toThrow('EPERM')
        const samples = observed.mock.calls.length
        expect(await child.retire()).toMatchObject({ childExited: true, descendants: 'uncertain' })
        expect(signal).toHaveBeenCalledTimes(2)
        expect(observed.mock.calls.length).toBeGreaterThan(samples)
      })

      it('uses a monotonic kill grace through a backward wall-clock jump', async () => {
        const f = await fallbackFixture()
        const { lifetime, observer } = f
        const child = await lifetime.launch(f.request('setTimeout(()=>{},20000)'))
        const confirmation = await child.confirmation
        // This deadline fixture scans only the process it created; the real
        // process-table scanner is exercised by the foreign-group regressions.
        vi.spyOn(observer, 'scan').mockImplementation(async () => {
          const current = await observer.observe(confirmation.pid)
          return current === undefined ? [] : [current]
        })
        const original = observer.signal
        const wall = Date.now()
        const signal = vi
          .spyOn(observer, 'signal')
          .mockImplementation(async (identity, name, group) => {
            if (name === 'SIGTERM') {
              setTimeout(() => vi.spyOn(Date, 'now').mockReturnValue(wall - 86_400_000), 1)
              return true
            }
            return await original(identity, name, group)
          })
        const retiring = child.retire()
        const finished = (async () => {
          await retiring
          return 'finished'
        })()
        const result = await Promise.race([finished, delay(1000, 'pending')])
        vi.spyOn(Date, 'now').mockRestore()
        if (result === 'pending') child.child.kill()
        await retiring
        expect(result).toBe('finished')
        expect(signal.mock.calls.map((call) => call[1])).toEqual(['SIGTERM', 'SIGKILL'])
        await lifetime.dispose()
      })
    }

    it('holds short commands until their OS confirmation is durable', async () => {
      const f = await fixture()
      const output = path.join(f.directory, 'short-started')
      const write = f.journal.write
      const saving = vi
        .spyOn(f.journal, 'write')
        .mockImplementation(async (name, value, schema) => {
          await write(name, value, schema)
          const record = z
            .object({ confirmation: z.optional(z.unknown()), end: z.optional(z.unknown()) })
            .parse(value)
          if (record.confirmation === undefined || record.end !== undefined) return
          await delay(100)
          await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' })
        })
      const child = await f.lifetime.launch(
        f.request(`require('node:fs').writeFileSync(${JSON.stringify(output)},'started')`),
      )
      expect(await child.ended).toMatchObject({ childExited: true })
      expect(await readFile(output, 'utf8')).toBe('started')
      saving.mockRestore()
      if (process.platform === 'linux') {
        for (let attempt = 0; attempt < 10; attempt++) {
          const short = await f.lifetime.launch({
            ...f.request(''),
            command: '/usr/bin/true',
            args: [],
          })
          expect(await short.ended).toMatchObject({ childExited: true })
        }
      }
    })

    it('scans real marked descendants but cannot stop them without recorded identity', async () => {
      const f = await fixture()
      const output = path.join(f.directory, 'descendant.json')
      const descendant = `require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({pid:process.pid}));setTimeout(()=>{},20000)`
      const code = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{detached:true,stdio:'ignore'}).unref();setTimeout(()=>{},500)`
      const child = await f.lifetime.launch(f.request(code))
      await until(async () => {
        try {
          JSON.parse(await readFile(output, 'utf8'))
          return true
        } catch {
          return false
        }
      })
      const recovery = createOrphanRecovery(createNativeOrphanDriver())
      const records = await f.lifetime.recoveryRecords(f.journal)
      const pid: unknown = z
        .strictObject({ pid: z.number() })
        .parse(JSON.parse(await readFile(output, 'utf8'))).pid
      const observations = await recovery.find(records)
      const found = observations.find((row) => row.pid === pid)
      expect(found?.match).toBe('uncertain')
      if (found === undefined) throw new Error('marked descendant absent')
      expect(await recovery.stop(found, false)).toBe('kept')
      expect(await createNativeOrphanDriver().observe(found.pid)).toBeDefined()
      expect(await recovery.stop({ ...found, startTime: 'changed' }, true)).toBe('changed')
      expect(await recovery.stop(found, true)).toBe('changed')
      await child.retire()
      const owned = await createNativeOrphanDriver().observe(found.pid)
      if (owned !== undefined) await createNativeOrphanDriver().signal(owned, 'SIGKILL', false)
    })

    it('retains no-scope detached descendants as uncertain after direct child exit', async () => {
      const f = await fixture()
      const output = path.join(f.directory, 'detached.json')
      const code = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(output)}, String(process.pid));setTimeout(()=>{},20000)`)}],{detached:true,stdio:'ignore'}).unref();setTimeout(()=>{},500)`
      const child = await f.lifetime.launch(f.request(code))
      const confirmation = await child.confirmation
      const end = await child.ended
      if (confirmation.container === 'processGroup') expect(end.descendants).toBe('uncertain')
      const records = await f.lifetime.recoveryRecords(f.journal)
      const recovery = createOrphanRecovery(createNativeOrphanDriver())
      const found = await recovery.find(records)
      expect(found.length).toBeGreaterThan(0)
      for (const orphan of found) {
        expect(await recovery.stop(orphan, true)).toBe('changed')
        const owned = await createNativeOrphanDriver().observe(orphan.pid)
        if (owned !== undefined) await createNativeOrphanDriver().signal(owned, 'SIGKILL', false)
      }
      await child.retire()
    })
  }

  if (process.platform === 'win32') {
    describe('prepared Windows owner', () => {
      let owner: Awaited<ReturnType<typeof standaloneOwner>> | undefined
      let output = ''
      beforeEach(async () => {
        const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'm96-owner-')))
        directories.push(directory)
        output = path.join(directory, 'descendant.json')
        const descendant = `require('node:fs').writeFileSync(${JSON.stringify(output)},JSON.stringify({pid:process.pid}));setTimeout(()=>{},20000)`
        const code = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{detached:true,stdio:'ignore'});setTimeout(()=>{},20000)`
        owner = await standaloneOwner(directory, code)
      })
      it('hard host death closes jobs and ends detached grandchildren', async () => {
        if (owner === undefined) throw new Error('native owner not prepared')
        const { parent, parentExited } = owner
        await until(async () => {
          try {
            JSON.parse(await readFile(output, 'utf8'))
            return true
          } catch {
            return false
          }
        })
        const pid: unknown = z
          .strictObject({ pid: z.number() })
          .parse(JSON.parse(await readFile(output, 'utf8'))).pid
        if (typeof pid !== 'number') throw new Error('missing descendant pid')
        expect(() => process.kill(pid, 0)).not.toThrow()
        parent.kill()
        await parentExited
        await until(() => {
          try {
            process.kill(pid, 0)
            return Promise.resolve(false)
          } catch {
            return Promise.resolve(true)
          }
        })
      })
    })
  } else if (process.platform === 'linux') {
    it('hard parent death kills the real direct child under setpriv without a user scope', async () => {
      const f = await fixture()
      const bin = path.join(f.directory, 'bin')
      await mkdir(bin)
      for (const name of ['setpriv', 'nice', 'true'])
        await symlink(`/usr/bin/${name}`, path.join(bin, name))
      const output = path.join(f.directory, 'direct.json')
      const code = `require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({pid:process.pid}));setTimeout(()=>{},20000)`
      const { parent, parentExited } = await standaloneOwner(f.directory, code, { PATH: bin })
      await until(async () => {
        try {
          JSON.parse(await readFile(output, 'utf8'))
          return true
        } catch {
          return false
        }
      })
      const { pid } = z
        .strictObject({ pid: z.number() })
        .parse(JSON.parse(await readFile(output, 'utf8')))
      expect(await createNativeOrphanDriver().observe(pid)).toBeDefined()
      parent.kill('SIGKILL')
      await parentExited
      await until(async () => (await createNativeOrphanDriver().observe(pid)) === undefined)
    })
  }
})
