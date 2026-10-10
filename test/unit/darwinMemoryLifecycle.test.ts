import * as acp from '@agentclientprotocol/sdk'
import { spawn, type ChildProcess } from 'node:child_process'
import type * as ChildProcesses from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdtemp, writeFile } from 'node:fs/promises'
import { JOB_SOURCE_FILES } from '../../src/host/backend/jobSource'
import { tmpdir, totalmem } from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { buildCreatedHelper } from '../e2e/createdHelperFixture'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { configureResources, loadResourceWindow } from '../../src/core/resources/admission'
import { createResources } from '../../src/runtime/resources/entry'
import { lazyRuntimeResources } from '../../src/runtime/resources/load'
import type { RuntimeResources } from '../../src/runtime/resources/port'
import { webReadable } from '../../src/runtime/webStreams'
import { EN } from '../../src/shared/l10n/en'
import { FakeResourceMachine } from './helpers/resources/runtime'
import { removeFolder } from './helpers/temporaryFolders'
import { installFakeMuse, installFakeCredential } from '../e2e/fakeMuse'

vi.mock('node:child_process', { spy: true })
vi.mock('node:os', { spy: true })
const { spawn: realSpawn } = await vi.importActual<typeof ChildProcesses>('node:child_process')
const fixture = fileURLToPath(new URL('../fixtures/darwin-memory.mjs', import.meta.url))
const children: ChildProcess[] = []
const hosts: RuntimeResources[] = []
const stops: (() => void)[] = []
const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const state: { folder: string; fake: ReturnType<typeof installFakeMuse>; credentials: string } = {
  folder: '',
  fake: { binaryPath: '', installDir: '' },
  credentials: '',
}
const headroom = '{"availableBytes":10737418240}\n'

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    throw error
  }
}
async function gone(pid: number) {
  await vi.waitFor(() => {
    expect(isAlive(pid)).toBe(false)
  })
}
function helperPid(): number {
  const pid = children.at(-1)?.pid
  if (pid === undefined) throw new Error('helper did not start')
  expect(isAlive(pid)).toBe(true)
  return pid
}
function intercept(mode = headroom) {
  vi.mocked(totalmem).mockReturnValue(16 * 1024 ** 3)
  vi.stubGlobal('process', {
    ...process,
    platform: 'darwin',
    versions: { ...process.versions, uv: '1.51.0' },
  })
  vi.mocked(spawn).mockImplementation((_file, _args, options) => {
    const child = realSpawn(process.execPath, [fixture, mode], options)
    children.push(child)
    return child
  })
}
function options() {
  const machine = new FakeResourceMachine()
  machine.settings.enabled = false
  return { machineDir: state.folder, machine, sleep: () => Promise.resolve(), onError: vi.fn() }
}

beforeAll(async () => {
  state.folder = await mkdtemp(path.join(tmpdir(), 'm107-memory-lifecycle-'))
  state.fake = installFakeMuse()
  state.credentials = installFakeCredential()
  await writeFile(path.join(state.folder, 'package.json'), '{"version":"test"}')
  // Simulate old libuv, keep the real host/transport and report only the fake helper PID.
  const banner = `
    Object.defineProperty(process.versions, 'uv', { value: '1.51.0' });
    require('node:os').totalmem = () => 16 * 1024 ** 3;
    const cp = require('node:child_process'), spawnMemory = cp.spawn;
    cp.spawn = function(file, args, options) {
      if (args?.[0] !== '--memory-headroom') return spawnMemory(file, args, options);
      const child = spawnMemory(process.execPath, [${JSON.stringify(fixture)},
        process.env.M107_TEST_MODE === 'stall' ? 'stall' : ${JSON.stringify(headroom)}], options);
      child.on('spawn', () => process.send?.(child.pid));
      return child;
    };
    if (process.env.M107_TEST_MODE === 'error') {
      process.once('message', () => { throw new Error('fixture transport failure'); });
      process.channel?.unref();
      const write = process.stdout.write.bind(process.stdout);
      process.stdout.write = function(chunk, ...args) {
        if (String(chunk).includes('memoryAvailableBytes')) throw new Error('fixture output failure');
        return write(chunk, ...args);
      };
    }
  `
  await build({
    entryPoints: {
      acp: 'src/runtime/main.ts',
      resourceGovernor: 'src/core/resources/resourceGovernorEntry.ts',
      runtimeQuestions: 'src/runtime/questions/questionRegistryEntry.ts',
    },
    outdir: path.join(state.folder, 'dist'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['@napi-rs/keyring'],
    logLevel: 'silent',
    banner: { js: banner },
    plugins: [
      {
        name: 'legacy-darwin-sampler',
        setup(plugin) {
          plugin.onLoad({ filter: /[\\/]sampler[\\/]system\.ts$/ }, async ({ path: file }) => {
            const source = await readFile(file, 'utf8')
            return { contents: source.replaceAll('process.platform', "'darwin'"), loader: 'ts' }
          })
        },
      },
    ],
  })
  buildCreatedHelper(process.cwd(), state.folder)
  for (const file of Object.values(JOB_SOURCE_FILES))
    await cp(path.resolve(file), path.join(state.folder, file))
})
afterEach(async () => {
  for (const stop of stops.splice(0)) stop()
  for (const host of hosts.splice(0)) host.dispose()
  // Cleanup also runs after red drills: a failing assertion must not strand its child.
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const closed = once(child, 'close')
    child.kill('SIGKILL')
    await closed
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
afterAll(async () => {
  await Promise.all(
    [state.folder, state.fake.installDir, state.credentials]
      .filter((file) => file !== '')
      .map((file) => removeFolder(file)),
  )
})

describe('RVCM1072 helper ownership through host shutdown', () => {
  it('retires the real entry sampler on runtime disposal', async () => {
    intercept()
    const host = await createResources(options(), EN, 'en')
    hosts.push(host)
    const status = await host.status()
    expect(status.sample?.memoryAvailableBytes).toBe(10_737_418_240)
    const pid = helperPid()
    host.dispose()
    await gone(pid)
  })

  it('settles and retires an in-flight runtime sample on disposal', async () => {
    intercept('stall')
    const host = await createResources(options(), EN, 'en')
    hosts.push(host)
    const pending = expect(host.status()).rejects.toThrow()
    await vi.waitFor(() => {
      expect(children).toHaveLength(1)
    })
    const pid = helperPid()
    host.dispose()
    await pending
    await gone(pid)
  })

  it('retires a sampled runtime host that finishes loading after facade disposal', async () => {
    intercept()
    const ready = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const host = lazyRuntimeResources({
      ...options(),
      distDir: state.folder,
      log,
      loadBundle: () => ({
        createResources: async () => {
          const created = await createResources(options(), EN, 'en')
          hosts.push(created)
          await created.status()
          ready.resolve(undefined)
          await release.promise
          return created
        },
      }),
    })
    hosts.push(host)
    const pending = expect(host.status()).rejects.toThrow()
    await ready.promise
    const pid = helperPid()
    host.dispose()
    release.resolve(undefined)
    await pending
    await gone(pid)
  })

  it('retires the window sampler through the extension subscription disposal callback', async () => {
    intercept()
    const dispose = configureResources({
      inspect: () => undefined,
      onError: vi.fn(),
    })
    stops.push(dispose)
    const window = await loadResourceWindow()
    if (window === undefined) throw new Error('missing window')
    await window.port.refreshStatus()
    const pid = helperPid()
    dispose()
    await gone(pid)
  })

  it.each(['normal', 'error', 'SIGINT', 'SIGTERM'] as const)(
    'retires the helper after CLI %s',
    async (outcome) => {
      const { child, pid, closed } = launch(
        ['resources', '--json'],
        { normal: 'normal', error: 'error', SIGINT: 'stall', SIGTERM: 'stall' }[outcome],
      )
      const helper = await pid
      if (outcome === 'SIGINT' || outcome === 'SIGTERM') {
        expect(isAlive(helper)).toBe(true)
        child.kill(outcome)
      }
      const [code, signal] = await closed
      expect(code === 0).toBe(outcome === 'normal')
      if (outcome === 'SIGINT' || outcome === 'SIGTERM') expect(signal).toBe(outcome)
      await gone(helper)
    },
  )

  it.each(['EOF', 'transport error', 'SIGINT', 'SIGTERM'] as const)(
    'retires the helper after ACP %s',
    async (outcome) => {
      const { child, stdin, stdout, pid, closed, stderr } = launch(
        [
          '--muse-binary',
          state.fake.binaryPath,
          '--shell-sandbox',
          'off',
          '--usage-history',
          'off',
        ],
        outcome === 'transport error' ? 'error' : 'normal',
      )
      const client = acp
        .client({ name: 'memory-lifecycle' })
        .onNotification('session/update', () => undefined)
      const connection = client.connect(
        acp.ndJsonStream(Writable.toWeb(stdin), webReadable(stdout)),
      )
      try {
        await connection.agent.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
        const { sessionId } = await connection.agent.request('session/new', {
          cwd: state.folder,
          mcpServers: [],
        })
        const prompt = connection.agent.request('session/prompt', {
          sessionId,
          prompt: [{ type: 'text', text: '/resources' }],
        })
        const helper = await pid
        if (outcome === 'transport error') {
          await prompt
          expect(isAlive(helper)).toBe(true)
          child.send('fixture-crash')
          const [code] = await closed
          expect(code).toBe(1)
          await gone(helper)
          return
        }
        await prompt
        expect(isAlive(helper)).toBe(true)
        if (outcome === 'EOF') stdin.end()
        else child.kill(outcome)
        const [code, signal] = await closed
        if (outcome === 'EOF') expect(code).toBe(0)
        else expect(signal).toBe(outcome)
      } catch (error: unknown) {
        throw new Error(stderr.join(''), { cause: error })
      } finally {
        connection.close()
      }
      const helper = await pid
      await gone(helper)
    },
  )
})

function launch(args: string[], mode = 'normal') {
  const child = realSpawn(process.execPath, [path.join(state.folder, 'dist', 'acp.js'), ...args], {
    cwd: state.folder,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: {
      PATH: process.env['PATH'],
      SystemRoot: process.env['SystemRoot'],
      NODE_PATH: path.resolve('node_modules'),
      HOME: state.folder,
      USERPROFILE: state.folder,
      LOCALAPPDATA: state.folder,
      XDG_DATA_HOME: state.folder,
      XDG_CONFIG_HOME: state.credentials,
      LANG: 'en_US.UTF-8',
      M107_TEST_MODE: mode,
    },
  })
  children.push(child)
  const { stdin, stdout, stderr: errors } = child
  if (stdin === null || stdout === null || errors === null) throw new Error('missing stdio pipes')
  const stderr: string[] = []
  errors.on('data', (chunk: Buffer) => {
    stderr.push(chunk.toString())
  })
  const pid = (async () => {
    const [value] = await once(child, 'message')
    if (typeof value !== 'number') throw new Error('invalid helper PID')
    return value
  })()
  const closed = once(child, 'close')
  if (args[0] === 'resources') stdout.resume()
  return { child, stdin, stdout, pid, closed, stderr }
}
