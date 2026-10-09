import './helpers/lspPrivateDirectoryMock'
import type { ResourceTicket } from '../../src/shared/resources'
import type { ResourceSignal } from '../../src/core/resources/trees/actions'
import { processAuthority } from '../../src/runtime/lsp/processAuthority'
import { ResourceTreeRegistry } from '../../src/core/resources/trees/registry'
import * as privateDirectories from '../../src/runtime/privateDirectory'
import { RUNTIME_STOP_SOCKET_BYTES } from '../../src/shared/constants'
import { ownerSchema } from '../../src/runtime/lsp/stopReceipt'
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import * as childProcess from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  superviseRuntime,
  stopWorkspace,
  UnverifiedStopError,
} from '../../src/runtime/lsp/supervisor'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { requireLiveSupervision, trackFixtureTree } from './helpers/liveSupervision'
import { removeFolder } from './helpers/temporaryFolders'

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof childProcess>()),
}))

vi.mock('node:fs/promises', async (importOriginal) => ({ ...(await importOriginal<typeof fs>()) }))

const directory = await mkdtemp(path.join(tmpdir(), 'muse-supervisor-test-'))
const watchdogFile = path.join(directory, 'watchdog.js')
const { installLspNativeFixture, buildLspProcess } = await import('./helpers/lspNativeFixture')
afterAll(await installLspNativeFixture(directory))
await buildLspProcess('src/runtime/lsp/watchdogEntry.ts', watchdogFile)
afterAll(() => removeFolder(directory))

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitFor(file: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await readFile(file, 'utf8')
    } catch {
      await pause(25)
    }
  }
  throw new Error(`no receipt: ${file}`)
}

/** Two verified roots with an owner registry each, for cross-root preflight. */
async function twoRegistries(label: string) {
  const roots = path.join(directory, label)
  const first = path.join(roots, 'first')
  const second = path.join(roots, 'second')
  await fs.mkdir(first, { mode: 0o700, recursive: true })
  await fs.mkdir(second, { mode: 0o700, recursive: true })
  const firstRegistry = path.join(first, `muse-runtime-${workspaceKey(directory)}`)
  const secondRegistry = path.join(second, `muse-runtime-${workspaceKey(directory)}`)
  await fs.mkdir(firstRegistry, { mode: 0o700 })
  await fs.mkdir(secondRegistry, { mode: 0o700 })
  return { roots, first, second, firstRegistry, secondRegistry }
}
async function writeOwnerRecord(registry: string, name: string, owner: unknown) {
  await writeFile(path.join(registry, name), JSON.stringify(owner), { mode: 0o600 })
}

/** Every fixture process this file starts, so a failed assertion or a timeout
 * still reaps the whole tree instead of leaking supervisors and workloads. */
const { track, reap } = trackFixtureTree()
const nativeChildProcess = await vi.importActual<typeof childProcess>('node:child_process')
const nativeKill = ResourceTreeRegistry.prototype.kill
beforeEach(() => {
  vi.spyOn(childProcess, 'spawn').mockImplementation((...args) =>
    track(nativeChildProcess.spawn(...args)),
  )
})
afterEach(async () => {
  // A timed-out test still restores its spies before another case captures them.
  vi.restoreAllMocks()
  await reap()
  await removeFolder(path.join(directory, 'owners'))
})
afterAll(reap)

function captureWorkload(receive: (child: childProcess.ChildProcess) => void) {
  return vi.spyOn(childProcess, 'spawn').mockImplementation((...args) => {
    const child = track(nativeChildProcess.spawn(...args))
    if (Array.isArray(args[1]) && args[1].includes('-e')) receive(child)
    return child
  })
}

function start(cwd: string, source: string, args: readonly string[] = [], guardian?: string) {
  const stdout = new PassThrough()
  stdout.resume()
  const stdin = new PassThrough()
  const done = superviseRuntime({
    registry: path.join(directory, 'owners'),
    cwd,
    file: process.execPath,
    args: ['-e', source, ...args],
    env: {
      PATH: process.env['PATH'],
      SystemRoot: process.env['SystemRoot'],
      M104_API_KEY: 'fake-sentinel',
    },
    packageRoot: process.platform === 'win32' ? process.cwd() : directory,
    watchdogFile: guardian ?? watchdogFile,
    stdin,
    stdout,
  })
  // Observe immediately even when startup fails; the test still awaits the result.
  void done.catch(() => undefined)
  return { stdout, stdin, done }
}

// An owner whose control socket is already closed, as just after STOPPED.
async function closedOwner(pid: number) {
  const registry = path.join(directory, 'owners')
  await fs.mkdir(registry, { mode: 0o700 })
  const ownerId = randomUUID()
  const record = path.join(registry, `${workspaceKey(directory)}-${ownerId}.json`)
  const pipe =
    process.platform === 'win32'
      ? String.raw`\\.\pipe\muse-stop-${randomUUID()}`
      : path.join(directory, 'control')
  // A closed socket must first have been bindable. UUID nesting exceeded
  // Darwin's sun_path and tested EINVAL instead of the owner's closing window.
  const control = createServer()
  await new Promise<void>((resolve, reject) => {
    control.once('error', reject)
    control.listen(pipe, resolve)
  })
  const address = control.address()
  await new Promise<void>((resolve, reject) => {
    control.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
  await writeFile(
    record,
    JSON.stringify({
      trustRoot: await fs.realpath(directory),
      pid,
      pipe,
      token: 'a'.repeat(64),
      generation: 'b'.repeat(32),
      ownerId,
      binding: null,
    }),
    { mode: 0o600 },
  )
  return { registry, record, address }
}

describe('M104H2 runtime supervision', () => {
  it.runIf(process.platform !== 'win32')(
    'keeps Stop sockets within the OS limit even with deeply nested registries',
    async () => {
      const parent = path.join(directory, 'long-registry-'.repeat(10))
      await fs.mkdir(parent, { mode: 0o700 })
      const registry = path.join(parent, 'owners')
      const ready = path.join(directory, 'long-registry.ready')
      const run = superviseRuntime({
        registry,
        cwd: directory,
        file: process.execPath,
        args: [
          '-e',
          `require('node:fs').writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)`,
          ready,
        ],
        env: process.env,
        packageRoot: directory,
        watchdogFile,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
      })
      void run.catch(() => undefined)
      try {
        await waitFor(ready)
        const owners = await readdir(registry)
        const ownerFile = owners.find((file) => file.endsWith('.json'))
        if (ownerFile === undefined) throw new Error('missing owner')
        const owner = ownerSchema.parse(
          JSON.parse(await readFile(path.join(registry, ownerFile), 'utf8')),
        )
        expect(Buffer.byteLength(owner.pipe)).toBeLessThanOrEqual(RUNTIME_STOP_SOCKET_BYTES)
        expect(owner.trustRoot).toBe(await fs.realpath(parent))
        await stopWorkspace(registry, directory, directory)
        expect(await run).toBe(0)
      } finally {
        await stopWorkspace(registry, directory, directory)
        await run
      }
    },
  )

  it.runIf(process.platform !== 'win32')(
    'publishes a closed socket at its real bound address within the portable pathname limit',
    async () => {
      const { record, address } = await closedOwner(process.pid)
      const owner = ownerSchema.parse(JSON.parse(await readFile(record, 'utf8')))
      expect(owner.pipe).toBe(address)
      expect(Buffer.byteLength(owner.pipe)).toBeLessThanOrEqual(RUNTIME_STOP_SOCKET_BYTES)
      await expect(fs.stat(owner.pipe)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(
        new Promise<void>((resolve, reject) => {
          const socket = createConnection(owner.pipe)
          socket.once('error', reject)
          socket.once('connect', () => {
            socket.destroy()
            resolve()
          })
        }),
      ).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )

  it('waits out an owner that closed its control socket and is removing its record', async () => {
    const { registry, record } = await closedOwner(process.pid)
    const removal = setTimeout(() => void fs.rm(record, { force: true }), 200)
    try {
      await expect(stopWorkspace(registry, directory)).resolves.toBeUndefined()
    } finally {
      clearTimeout(removal)
    }
  })

  it('refuses an owner that closed its control socket and died keeping its record', async () => {
    const owner = childProcess.spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      stdio: 'ignore',
    })
    if (owner.pid === undefined) throw new Error('owner did not start')
    const { registry } = await closedOwner(owner.pid)
    const death = setTimeout(() => owner.kill('SIGKILL'), 200)
    try {
      await expect(stopWorkspace(registry, directory)).rejects.toBeInstanceOf(UnverifiedStopError)
    } finally {
      clearTimeout(death)
      owner.kill('SIGKILL')
    }
  })

  it.runIf(process.platform !== 'win32')(
    'refuses an oversized runtime socket root before creating control state or children',
    async () => {
      const root = vi
        .spyOn(privateDirectories, 'trustedPrivateRoot')
        .mockResolvedValue(path.join(directory, 'oversized-'.repeat(20)))
      const creating = vi.spyOn(fs, 'mkdir')
      const spawning = vi.mocked(childProcess.spawn)
      try {
        await expect(start(directory, 'process.exit(0)').done).rejects.toThrow('ESTOP_SOCKET_PATH')
        expect(spawning.mock.calls.some(([file]) => file === process.execPath)).toBe(false)
        expect(creating.mock.calls.every(([file]) => !String(file).includes('oversized-'))).toBe(
          true,
        )
        expect(await readdir(path.join(directory, 'owners'))).toEqual([])
      } finally {
        root.mockRestore()
        creating.mockRestore()
      }
    },
  )

  it.runIf(process.platform !== 'win32')(
    'teardown reaps a detached fixture after parent exit and an assertion failure',
    async () => {
      const fixtures = trackFixtureTree()
      const file = path.join(directory, 'teardown-tree.json')
      const parent = fixtures.track(
        nativeChildProcess.spawn(
          process.execPath,
          [
            '-e',
            `
          const child = require('node:child_process').spawn(process.execPath,
            ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
          require('node:fs').writeFileSync(process.argv[1], JSON.stringify(child.pid));
          setInterval(()=>{},1000);
        `,
            file,
          ],
          { stdio: 'ignore' },
        ),
      )
      const detached: unknown = JSON.parse(await waitFor(file))
      if (typeof detached !== 'number') throw new Error('invalid detached fixture PID')
      try {
        await pause(100)
        const closed = new Promise<void>((resolve) => {
          parent.once('close', () => {
            resolve()
          })
        })
        parent.kill('SIGKILL')
        await closed
        try {
          expect('fixture failure').toBe('fixture success')
        } catch {
          await fixtures.reap()
        }
        expect(() => process.kill(detached, 0)).toThrow()
      } finally {
        // Even the teardown red drill cannot leak this explicitly receipted PID.
        try {
          process.kill(detached, 'SIGKILL')
        } catch {
          /* Already reaped. */
        }
        await fixtures.reap()
      }
    },
  )

  it('accepts a disappearing owner record but preserves other open failures', async () => {
    const registry = path.join(directory, 'race-owners')
    await fs.mkdir(registry, { mode: 0o700 })
    const record = path.join(registry, `${workspaceKey(directory)}-race.json`)
    await writeFile(record, '{}', { mode: 0o600 })
    const actualOpen = fs.open
    let failure = Object.assign(new Error('fixture vanished'), { code: 'ENOENT' })
    const opening = vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      if (file === record) throw failure
      return await actualOpen(file, flags, mode)
    })
    try {
      await expect(stopWorkspace(registry, directory, directory)).resolves.toBeUndefined()
      expect(opening).toHaveBeenCalledWith(record, expect.any(Number))
      // An unreadable owner file is an unusable record, never a fatal Stop:
      // independent Stop reports ESTOP_NO_RUN and names the file, while the
      // in-process string form keeps its tolerant resolve.
      failure = Object.assign(new Error('fixture forbidden'), { code: 'EACCES' })
      const diagnostics: string[] = []
      await expect(
        stopWorkspace([registry], directory, directory, (message) => {
          diagnostics.push(message)
        }),
      ).rejects.toThrow('ESTOP_NO_RUN')
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]).toContain('ESTOP_RECORD_UNUSABLE')
      expect(diagnostics[0]).toContain(record)
      await expect(stopWorkspace(registry, directory, directory)).resolves.toBeUndefined()
    } finally {
      opening.mockRestore()
      await removeFolder(registry)
    }
  })
  it('refuses dead ownership without a completion receipt and retains the record', async () => {
    const registry = path.join(directory, 'missing-receipt')
    await fs.mkdir(registry, { mode: 0o700 })
    const gone = childProcess.spawn(process.execPath, ['-e', 'process.exit(0)'], {
      stdio: 'ignore',
    })
    await new Promise<void>((resolve) => {
      gone.once('close', () => {
        resolve()
      })
    })
    if (gone.pid === undefined) throw new Error('no fixture PID')
    const record = path.join(
      registry,
      `${workspaceKey(directory)}-00000000-0000-4000-8000-000000000001.json`,
    )
    await writeFile(
      record,
      JSON.stringify({
        trustRoot: await fs.realpath(directory),
        pid: gone.pid,
        pipe: 'unused',
        token: 'a'.repeat(64),
        generation: 'b'.repeat(32),
        ownerId: '00000000-0000-4000-8000-000000000001',
        binding: null,
      }),
      { mode: 0o600 },
    )
    try {
      await stopWorkspace(registry, directory, directory)
      throw new Error('Stop falsely succeeded')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(UnverifiedStopError)
      if (!(error instanceof UnverifiedStopError)) throw error
      expect(error.pids).toEqual([gone.pid])
    }
    expect(await readdir(registry)).toHaveLength(1)
    await removeFolder(registry)
  })

  it('parses Stop separately and refuses recursive supervisors', () => {
    expect(parseCommandLine(['stop'])).toEqual({ command: 'stop' })
    expect(parseCommandLine(['stop', 'extra'])).toMatchObject({ command: 'invalid' })
    expect(parseCommandLine(['supervise', '--backend', 'modelApi'])).toEqual({
      command: 'supervise',
      args: ['--backend', 'modelApi'],
    })
    expect(parseCommandLine(['supervise', 'supervise'])).toMatchObject({ command: 'invalid' })
    expect(parseCommandLine(['supervise', 'stop'])).toMatchObject({ command: 'invalid' })
  })

  it.runIf(process.platform !== 'win32')(
    'queues Stop until delayed guardian startup creates the child',
    async () => {
      await requireLiveSupervision()
      const guardian = path.join(directory, 'delayed-watchdog.js')
      const release = path.join(directory, 'release-guardian')
      const ready = path.join(directory, 'startup-child')
      await writeFile(
        guardian,
        String.raw`if (require.main !== module) { require(${JSON.stringify(watchdogFile)}); delete require.cache[__filename]; } else { const fs = require('node:fs'); const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(release)})) { clearInterval(timer); process.stdout.write('READY\n') } }, 10); process.stdin.resume(); process.stdin.on('data', () => process.stdout.write('OWNED\n')); process.stdin.once('end', () => process.exit(0)); }`,
      )
      let owned: childProcess.ChildProcess | undefined
      const spawning = captureWorkload((child) => {
        owned = child
      })
      const run = start(
        directory,
        `require('node:fs').writeFileSync(process.argv[1], String(process.pid));setInterval(()=>{},1000)`,
        [ready],
        guardian,
      )
      let stopping: Promise<void> | undefined
      let didStop = false
      try {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          let owners: string[]
          try {
            owners = await readdir(path.join(directory, 'owners'))
          } catch {
            await pause(10)
            continue
          }
          if (owners.some((file) => file.endsWith('.json'))) break
          await pause(10)
        }
        stopping = (async () => {
          await stopWorkspace(path.join(directory, 'owners'), directory)
          didStop = true
        })()
        void stopping.catch(() => undefined)
        await pause(100)
        expect(didStop).toBe(false)
        await writeFile(release, 'ready')
        await stopping
        expect(await run.done).toBe(0)
        if (owned === undefined) throw new Error('no child spawn')
        expect(owned.pid).toBeTypeOf('number')
        expect(owned.exitCode !== null || owned.signalCode !== null).toBe(true)
      } finally {
        await writeFile(release, 'ready')
        // A red drill can launch after prematurely acknowledging Stop. Wait for
        // its workload admission, so teardown cannot outrun native registration.
        if (owned === undefined || (owned.exitCode === null && owned.signalCode === null)) {
          try {
            await waitFor(ready)
          } catch {
            /* Failed startup has no workload receipt to await. */
          }
        }
        owned?.kill('SIGKILL')
        spawning.mockRestore()
        await stopping
        await run.done
      }
    },
  )
  it.runIf(process.platform !== 'win32')(
    'holds the Node workload until both registry registration and explicit admission',
    async () => {
      await requireLiveSupervision()
      const marker = path.join(directory, 'gated-child')
      const authority = await processAuthority(directory, path.join(directory, 'owners'))
      const held = Promise.withResolvers<undefined>()
      const reached = Promise.withResolvers<undefined>()
      const registering = authority.registry.register.bind(authority.registry)
      const guard = vi.spyOn(authority.registry, 'register').mockImplementation(async (ticket) => {
        reached.resolve(undefined)
        await held.promise
        return await registering(ticket)
      })
      const launching = authority.launch(
        process.execPath,
        [
          '-e',
          `require('node:fs').writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)`,
          marker,
        ],
        directory,
        process.env,
        watchdogFile,
      )
      void launching.catch(() => undefined)
      try {
        await reached.promise
        await pause(100)
        await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
        held.resolve(undefined)
        const launched = await launching
        await pause(100)
        await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
        launched.admit()
        expect(await waitFor(marker)).toBe('ready')
        await authority.stop(launched.ticket)
      } finally {
        held.resolve(undefined)
        guard.mockRestore()
        const launched = await launching
        launched.child.stdio[3]?.destroy()
        if (authority.registry.tickets().some((entry) => entry.id === launched.ticket.id))
          await authority.stop(launched.ticket)
      }
    },
  )

  it.runIf(process.platform !== 'win32')(
    'retires a registered child without admitting it when guardian handoff fails',
    async () => {
      await requireLiveSupervision()
      const guardian = path.join(directory, 'refusing-watchdog.js')
      const marker = path.join(directory, 'refused-child')
      await writeFile(
        guardian,
        String.raw`if (require.main !== module) { require(${JSON.stringify(watchdogFile)}); delete require.cache[__filename]; } else { process.stdout.write('READY\n'); process.stdin.once('data',()=>process.exit(1)); }`,
      )
      let owned: childProcess.ChildProcess | undefined
      const spawning = captureWorkload((child) => {
        owned = child
      })
      try {
        const run = start(
          directory,
          `require('node:fs').writeFileSync(process.argv[1],'admitted');setInterval(()=>{},1000)`,
          [marker],
          guardian,
        )
        await expect(run.done).rejects.toThrow('ESTOP_WATCHDOG')
        if (owned === undefined) throw new Error('no child spawn')
        expect(owned.pid).toBeTypeOf('number')
        expect(owned.exitCode !== null || owned.signalCode !== null).toBe(true)
        await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
        expect(await readdir(path.join(directory, 'owners'))).toEqual([])
      } finally {
        owned?.kill('SIGKILL')
        spawning.mockRestore()
      }
    },
  )

  it('builds its own guardian without a production dist directory', async () => {
    await requireLiveSupervision()
    const run = start(
      directory,
      'process.stdin.resume();process.stdin.on("end",()=>process.exit(0))',
    )
    run.stdin.end()
    expect(await run.done).toBe(0)
  })
  it('preserves binary stdio and child exit status, stripping credentials', async () => {
    await requireLiveSupervision()
    const run = start(
      directory,
      `
      if ('M104_API_KEY' in process.env) process.exit(9);
      process.stderr.write('private test account');
      process.stdin.pipe(process.stdout);
    `,
    )
    const chunks: Buffer[] = []
    run.stdout.on('data', (bytes: Buffer) => {
      chunks.push(bytes)
    })
    const bytes = Buffer.from([0, 128, 255, 10, 13, 0])
    run.stdin.end(bytes)
    expect(await run.done).toBe(0)
    expect(Buffer.concat(chunks)).toEqual(bytes)
    const failed = start(directory, 'process.exit(7)')
    expect(await failed.done).toBe(7)
    expect(await readdir(path.join(directory, 'owners'))).toEqual([])
  })

  it.runIf(process.platform !== 'win32').each(['SIGKILL', 'SIGTERM'] as const)(
    'reports unexpected workload %s as a nonzero signal exit',
    async (signal) => {
      await requireLiveSupervision()
      const onSignalExit = vi.fn()
      const code = await superviseRuntime({
        registry: path.join(directory, 'owners'),
        cwd: directory,
        file: process.execPath,
        args: ['-e', `process.kill(process.pid, ${JSON.stringify(signal)})`],
        env: process.env,
        packageRoot: directory,
        watchdogFile,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        onSignalExit,
      })
      expect(code).toBe(signal === 'SIGKILL' ? 137 : 143)
      expect(onSignalExit).toHaveBeenCalledExactlyOnceWith(signal)
    },
  )

  it.runIf(process.platform !== 'win32').each([143, 137])(
    'maps intentional Stop with workload exit %s to documented exit zero',
    async (code) => {
      await requireLiveSupervision()
      const ready = path.join(directory, `intentional-${String(code)}`)
      const run = start(
        directory,
        `process.on('SIGTERM',()=>process.exit(${String(code)}));require('node:fs').writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)`,
        [ready],
      )
      await waitFor(ready)
      try {
        await stopWorkspace(path.join(directory, 'owners'), directory)
        expect(await run.done).toBe(0)
      } finally {
        await stopWorkspace(path.join(directory, 'owners'), directory)
        await run.done
      }
    },
  )

  it('fails explicitly when the configured child cannot start', async () => {
    await requireLiveSupervision()
    await expect(
      superviseRuntime({
        registry: path.join(directory, 'owners'),
        cwd: directory,
        file: path.join(directory, 'missing'),
        args: [],
        env: process.env,
        packageRoot: process.platform === 'win32' ? process.cwd() : directory,
        watchdogFile,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
      }),
    ).resolves.toBe(1)
  })

  it('Stop kills an unresponsive TERM-ignoring root and grandchild, waits for both, and isolates workspaces', async () => {
    await requireLiveSupervision()
    const ready = path.join(directory, 'ready.json')
    const otherReady = path.join(directory, 'other.ready')
    const other = start(
      tmpdir(),
      `
      require('node:fs').writeFileSync(process.argv[1], 'ready');
      setInterval(() => {}, 1000);
    `,
      [otherReady],
    )
    const busy = start(
      directory,
      `
      const {spawn}=require('node:child_process');
      const grandchild=spawn(process.execPath,['-e', "process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1]+'.grandchild','ready');setInterval(()=>{},1000)",process.argv[1]],{stdio:'ignore'});
      process.on('SIGTERM',()=>{});
      require('node:fs').writeFileSync(process.argv[1],JSON.stringify([process.pid,grandchild.pid]));
      setInterval(()=>{},1000);
    `,
      [ready],
    )
    const pids: unknown = JSON.parse(await waitFor(ready))
    expect(Array.isArray(pids)).toBe(true)
    await waitFor(otherReady)
    await waitFor(`${ready}.grandchild`)
    const started = Date.now()
    try {
      await stopWorkspace(path.join(directory, 'owners'), directory)
      expect(await busy.done).toBe(0)
      expect(Date.now() - started).toBeLessThan(11_000)
      if (Array.isArray(pids)) {
        for (const pid of pids) {
          if (typeof pid !== 'number') throw new Error('invalid test pid')
          expect(() => process.kill(pid, 0)).toThrow()
        }
      }
      const remaining = await readdir(path.join(directory, 'owners'))
      expect(remaining.filter((file) => file.endsWith('.json'))).toHaveLength(1)
    } finally {
      if (Array.isArray(pids) && typeof pids[0] === 'number' && process.platform !== 'win32') {
        try {
          process.kill(-pids[0], 'SIGKILL')
        } catch {
          /* The owned test group may already be gone. */
        }
      }
      try {
        await busy.done
      } catch {
        /* A red drill may deliberately make Stop fail. */
      }
      await stopWorkspace(path.join(directory, 'owners'), tmpdir())
      await other.done
    }
  })

  it.runIf(process.platform !== 'win32')(
    'preserves admitted ownership when the supervisor cannot verify tree cleanup',
    async () => {
      await requireLiveSupervision()
      const ready = path.join(directory, 'refused-stop.ready')
      let workload: childProcess.ChildProcess | undefined
      const spawning = captureWorkload((child) => {
        workload = child
      })
      const run = start(
        directory,
        `require('node:fs').writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)`,
        [ready],
      )
      await waitFor(ready)
      const ownerFiles = await readdir(path.join(directory, 'owners'))
      const ownerFile = ownerFiles.find((file) => file.endsWith('.json'))
      if (ownerFile === undefined) throw new Error('missing owner')
      const owner: unknown = JSON.parse(
        await readFile(path.join(directory, 'owners', ownerFile), 'utf8'),
      )
      if (
        typeof owner !== 'object' ||
        owner === null ||
        !('pipe' in owner) ||
        typeof owner.pipe !== 'string'
      )
        throw new Error('invalid owner')
      const controlFolder = path.dirname(owner.pipe)
      class RefusedCleanupRegistry extends ResourceTreeRegistry {
        override async kill(ticket: ResourceTicket, signal?: ResourceSignal) {
          if (ticket.root.pid === workload?.pid)
            return {
              status: 'refused' as const,
              members: [{ identity: ticket.root, result: 'refused' as const }],
            }
          return await nativeKill.call(this, ticket, signal)
        }
      }
      const refusing = vi
        .spyOn(ResourceTreeRegistry.prototype, 'kill')
        .mockImplementation(RefusedCleanupRegistry.prototype.kill)
      try {
        await expect(stopWorkspace(path.join(directory, 'owners'), directory)).rejects.toThrow(
          'ESTOP_TREE',
        )
        await expect(run.done).rejects.toThrow('ESTOP_TREE')
        expect(await readdir(path.join(directory, 'owners'))).toContain(ownerFile)
        if (workload === undefined) throw new Error('missing workload')
        expect(workload.signalCode).not.toBeNull()
      } finally {
        refusing.mockRestore()
        spawning.mockRestore()
        try {
          await run.done
        } catch {
          /* The refusal is the asserted outcome. */
        }
        await removeFolder(path.join(directory, 'owners', ownerFile))
        await removeFolder(path.join(directory, 'owners', `${ownerFile}.tree`))
        await removeFolder(controlFolder)
      }
    },
  )

  it.runIf(process.platform !== 'win32')(
    'does not acknowledge Stop until registry actions attest that every identity has exited',
    async () => {
      await requireLiveSupervision()
      const ready = path.join(directory, 'group.ready')
      const run = start(
        directory,
        `require('node:fs').writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)`,
        [ready],
      )
      await waitFor(ready)
      let isGroupReleased = false
      // A previous instrumented action may already be spied on. The delegate
      // must remain the actual method, never the spy about to be overwritten.
      vi.spyOn(ResourceTreeRegistry.prototype, 'kill').mockImplementation(nativeKill)
      class HeldExitRegistry extends ResourceTreeRegistry {
        override async kill(ticket: ResourceTicket, signal?: ResourceSignal) {
          const result = await nativeKill.call(this, ticket, signal)
          return !isGroupReleased && result.status === 'gone'
            ? {
                status: 'done' as const,
                members: [{ identity: ticket.root, result: 'done' as const }],
              }
            : result
        }
      }
      const kill = vi
        .spyOn(ResourceTreeRegistry.prototype, 'kill')
        .mockImplementation(HeldExitRegistry.prototype.kill)
      let didStop = false
      const stopping = (async () => {
        await stopWorkspace(path.join(directory, 'owners'), directory)
        didStop = true
      })()
      void stopping.catch(() => undefined)
      try {
        await pause(750)
        expect(didStop).toBe(false)
        isGroupReleased = true
        await stopping
        expect(await run.done).toBe(0)
      } finally {
        isGroupReleased = true
        kill.mockRestore()
        await stopping
        await run.done
      }
    },
  )

  it('refuses a wrong control token without stopping the owner', async () => {
    await requireLiveSupervision()
    const ready = path.join(directory, 'authorized.ready')
    const run = start(
      directory,
      `require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)`,
      [ready],
    )
    const pid = Number(await waitFor(ready))
    const owners = await readdir(path.join(directory, 'owners'))
    const file = owners.find((owner) => owner.endsWith('.json'))
    if (file === undefined) throw new Error('missing owner record')
    const recordText = await readFile(path.join(directory, 'owners', file), 'utf8')
    const record: unknown = JSON.parse(recordText)
    if (
      typeof record !== 'object' ||
      record === null ||
      !('pipe' in record) ||
      typeof record.pipe !== 'string' ||
      !('token' in record) ||
      typeof record.token !== 'string'
    )
      throw new Error('invalid test record')
    const pipe = record.pipe
    expect(pipe).not.toContain(record.token)
    let lingering: ReturnType<typeof createConnection> | undefined
    try {
      expect(file.includes(record.token)).toBe(false)
      const socket = createConnection(pipe)
      await new Promise<void>((resolve, reject) => {
        socket.resume()
        socket.setTimeout(1000, () => {
          socket.destroy(new Error('test control did not close'))
        })
        socket.on('error', reject)
        socket.on('connect', () => {
          socket.write('wrong-token\n')
        })
        socket.on('close', resolve)
      })
      expect(() => process.kill(pid, 0)).not.toThrow()
      await new Promise<void>((resolve, reject) => {
        const oversized = createConnection(pipe)
        oversized.setTimeout(1000, () => {
          oversized.destroy(new Error('test frame cap did not fire'))
        })
        oversized.on('error', reject)
        oversized.on('connect', () => {
          oversized.write('x'.repeat(100))
        })
        oversized.on('close', (failed) => {
          if (!failed) resolve()
        })
      })
      const remaining = await readdir(path.join(directory, 'owners'))
      expect(remaining.filter((file) => file.endsWith('.json'))).toHaveLength(1)
      if (process.platform !== 'win32') {
        const info = await stat(path.join(directory, 'owners', file))
        expect(info.mode & 0o777).toBe(0o600)
      }
      lingering = createConnection(pipe)
      await new Promise<void>((resolve, reject) => {
        lingering?.on('error', reject)
        lingering?.on('connect', () => {
          lingering?.write('partial')
          resolve()
        })
      })
    } finally {
      const started = Date.now()
      try {
        await stopWorkspace(path.join(directory, 'owners'), directory)
        await run.done
        expect(Date.now() - started).toBeLessThan(2000)
      } finally {
        lingering?.destroy()
      }
    }
  })

  it('reports malformed and oversized ownership records without dialing', async () => {
    const registry = path.join(directory, 'owners')
    await fs.mkdir(registry, { mode: 0o700, recursive: true })
    const record = path.join(registry, `${workspaceKey(directory)}-bad.json`)
    const reported = async () => {
      const diagnostics: string[] = []
      await expect(
        stopWorkspace([registry], directory, directory, (message) => {
          diagnostics.push(message)
        }),
      ).rejects.toThrow('ESTOP_NO_RUN')
      return diagnostics
    }
    try {
      await writeFile(record, JSON.stringify({ pipe: 'bad', token: 'short' }), { mode: 0o600 })
      const malformed = await reported()
      expect(malformed).toHaveLength(1)
      expect(malformed[0]).toContain('ESTOP_RECORD_UNUSABLE')
      expect(malformed[0]).toContain('schema-invalid')
      await writeFile(record, 'x'.repeat(4096))
      const oversized = await reported()
      expect(oversized).toHaveLength(1)
      expect(oversized[0]).toContain('ESTOP_RECORD_UNUSABLE')
      expect(oversized[0]).toContain('oversize')
      await writeFile(record, '')
      const empty = await reported()
      expect(empty).toHaveLength(1)
      expect(empty[0]).toContain('ESTOP_RECORD_UNUSABLE')
    } finally {
      await removeFolder(record)
    }
    await expect(stopWorkspace(path.join(directory, 'absent'), directory)).resolves.toBeUndefined()
  })

  it('skips a foreign trust-root record and reports it without signalling', async () => {
    const { roots, first, second, firstRegistry, secondRegistry } =
      await twoRegistries('foreign-roots')
    const owner = {
      trustRoot: await fs.realpath(first),
      pid: 1,
      pipe: 'unused',
      token: 'a'.repeat(64),
      generation: 'b'.repeat(32),
      ownerId: '00000000-0000-4000-8000-000000000002',
      binding: null,
    }
    // Each copy is well-formed under the other root, foreign where found: the
    // 'unused' pipe proves neither is signalled when Stop reports no run.
    await writeOwnerRecord(firstRegistry, `${workspaceKey(directory)}-foreign.json`, {
      ...owner,
      trustRoot: await fs.realpath(second),
    })
    await writeOwnerRecord(secondRegistry, `${workspaceKey(directory)}-foreign.json`, owner)
    const diagnostics: string[] = []
    try {
      await expect(
        stopWorkspace([firstRegistry, secondRegistry], directory, directory, (message) => {
          diagnostics.push(message)
        }),
      ).rejects.toThrow('ESTOP_NO_RUN')
      expect(diagnostics).toHaveLength(2)
      expect(diagnostics.every((line) => line.startsWith('ESTOP_RECORD_FOREIGN'))).toBe(true)
    } finally {
      await removeFolder(roots)
    }
  })

  it('refuses duplicate well-formed owners across roots before signalling', async () => {
    const { roots, first, second, firstRegistry, secondRegistry } =
      await twoRegistries('ambiguous-roots')
    const owner = {
      trustRoot: await fs.realpath(first),
      pid: 1,
      pipe: 'unused',
      token: 'a'.repeat(64),
      generation: 'b'.repeat(32),
      ownerId: '00000000-0000-4000-8000-000000000003',
      binding: null,
    }
    // Same ownerId:generation, each well-formed under its own root.
    await writeOwnerRecord(firstRegistry, `${workspaceKey(directory)}-copy.json`, owner)
    await writeOwnerRecord(secondRegistry, `${workspaceKey(directory)}-copy.json`, {
      ...owner,
      trustRoot: await fs.realpath(second),
    })
    try {
      await expect(
        stopWorkspace([firstRegistry, secondRegistry], directory, directory),
      ).rejects.toThrow('ESTOP_AMBIGUOUS')
      // Fatal means retained: neither copy is removed or signalled.
      expect(await readdir(firstRegistry)).toHaveLength(1)
      expect(await readdir(secondRegistry)).toHaveLength(1)
    } finally {
      await removeFolder(roots)
    }
  })

  it.runIf(process.platform !== 'win32')(
    'stops the live owner while reporting an unusable record in another root',
    async () => {
      await requireLiveSupervision()
      const roots = path.join(directory, 'mixed-roots')
      const second = path.join(roots, 'second')
      await fs.mkdir(second, { mode: 0o700, recursive: true })
      const secondRegistry = path.join(second, `muse-runtime-${workspaceKey(directory)}`)
      await fs.mkdir(secondRegistry, { mode: 0o700 })
      await writeFile(path.join(secondRegistry, `${workspaceKey(directory)}-empty.json`), '', {
        mode: 0o600,
      })
      const ready = path.join(directory, 'mixed-stop.ready')
      const run = start(
        directory,
        `require('node:fs').writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)`,
        [ready],
      )
      await waitFor(ready)
      const diagnostics: string[] = []
      try {
        await stopWorkspace(
          [path.join(directory, 'owners'), secondRegistry],
          directory,
          directory,
          (message) => {
            diagnostics.push(message)
          },
        )
        expect(await run.done).toBe(0)
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]).toContain('ESTOP_RECORD_UNUSABLE')
        expect(diagnostics[0]).toContain('empty.json')
      } finally {
        await removeFolder(secondRegistry)
        try {
          await stopWorkspace(path.join(directory, 'owners'), directory)
        } catch {
          /* The asserted Stop above already settled the run. */
        }
        try {
          await run.done
        } catch {
          /* A refused Stop is the asserted outcome elsewhere. */
        }
      }
    },
  )
})
