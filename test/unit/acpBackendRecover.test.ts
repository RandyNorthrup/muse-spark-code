// A real `muse serve` dying under real sessions (RLF-ACPRECOVER): the host
// reports an unexpected exit with its reason, a turn in flight never
// reports finished, and stop calls on the dead host skip, naming the
// state, instead of warning a bare `Error`. The CLI runs its echo
// provider under a throwaway home with a dead proxy, so zero model calls
// leave the machine; the unsigned CLI serves ephemeral sessions, so
// resume-after-restart is proven refused (as not-found), while the
// agent-level re-attach that consumes it runs signed-in
// (acpBackendRecoverAgent.test.ts). Measured 2026-11-02 on CLI 1.4.14.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Connection } from '@muse-code/sdk'
import { ChildStdioTransport } from '@muse-code/sdk/dist/src/connection/spawn.js'
import type { AgentHost, AgentSession, HostExit, TurnPart } from '../../src/core/agent/agentBackend'
import { isSessionNotFoundError } from '../../src/core/agent/agentBackend'
import type { CoreLogger } from '../../src/core/logging'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import { resolveMuseLaunch } from '../../src/core/backends/musecode/launch'
import { credentialFilePath } from '../../src/core/backends/musecode/credentialPath'
import {
  ControllerRegistry,
  type SessionController,
} from '../../src/runtime/panel/controllerRegistry'
import { isolatedRuntimeEnvironment } from './helpers/isolatedRuntimeEnvironment'
import { MSP_CLIENT_NAME, MSP_REQUESTED_CAPABILITIES, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'

/** The product's own CLI resolution; undefined where Muse Code is not installed. */
function museCommand(): string | undefined {
  const resolution = resolveMuseLaunch({
    platform: process.platform,
    configuredPath: '',
    pathEntries: (process.env['PATH'] ?? '').split(path.delimiter),
    homeDir: homedir(),
    localAppData: process.env['LOCALAPPDATA'],
    fileExists: existsSync,
    readTextFile: (file) => (existsSync(file) ? readFileSync(file, 'utf8') : undefined),
    listDirectory: (directory) => (existsSync(directory) ? readdirSync(directory) : []),
    serveArgs: ['serve'],
    scope: { workspaceRoot: tmpdir(), realpath: realpathSync },
  })
  return resolution.ok ? resolution.launch.command : undefined
}

const MUSE = museCommand()

// A genuinely long operation: a real `muse serve` start, its handshake, a
// session and a turn, then a kill and its settle, on a shared rig.
const RECOVER_TEST_TIMEOUT_MS = 30_000

function museOrThrow(): string {
  if (MUSE === undefined) {
    throw new Error('the Muse Code CLI is not installed on this machine')
  }
  return MUSE
}

interface LoggedLine {
  readonly level: 'trace' | 'info' | 'warn' | 'error'
  readonly message: string
}

function collectingCoreLog(into: LoggedLine[]): CoreLogger {
  return {
    trace: (message: string): void => {
      into.push({ level: 'trace', message })
    },
    info: (message: string): void => {
      into.push({ level: 'info', message })
    },
    warn: (message: string): void => {
      into.push({ level: 'warn', message })
    },
    error: (message: string): void => {
      into.push({ level: 'error', message })
    },
  }
}

interface EchoHost {
  readonly host: MuseCodeHost
  readonly child: ChildProcessWithoutNullStreams
  readonly home: string
  readonly lines: LoggedLine[]
  readonly exits: HostExit[]
}

const live: EchoHost[] = []
const scratchHomes: string[] = []

async function productVersion(): Promise<string> {
  const raw = await readFile(new URL('../../package.json', import.meta.url), 'utf8')
  return (JSON.parse(raw) as { version: string }).version
}

/**
A real host over a real `muse serve` the test owns (for the kill): the
echo provider under a throwaway home with an empty credential file and a
dead proxy, so no model call can leave. The SDK's own child transport
carries the real bytes; the handshake mirrors the backend manager's.
*/
async function startEchoHost(
  muse: string,
  serveArgs: readonly string[],
  stderrs: string[],
): Promise<EchoHost> {
  const home = await mkdtemp(path.join(tmpdir(), 'acp-recover-'))
  const configHome = path.join(home, 'config')
  await mkdir(path.join(configHome, 'muse'), { recursive: true })
  await writeFile(
    credentialFilePath({ homeDir: home, xdgConfigHome: configHome, platform: process.platform }),
    '{ "providers": {}, "schema_version": 2 }',
  )
  const env: NodeJS.ProcessEnv = {
    ...isolatedRuntimeEnvironment(home, tmpdir()),
    MUSE_NO_AUTO_UPDATE: '1',
    HTTP_PROXY: 'http://127.0.0.1:9',
    HTTPS_PROXY: 'http://127.0.0.1:9',
    ALL_PROXY: 'http://127.0.0.1:9',
    http_proxy: 'http://127.0.0.1:9',
    https_proxy: 'http://127.0.0.1:9',
    all_proxy: 'http://127.0.0.1:9',
    NO_PROXY: '',
  }
  const child = spawn(muse, [...serveArgs], { env, stdio: ['pipe', 'pipe', 'pipe'] })
  const transport = new ChildStdioTransport(child, (chunk: string) => {
    stderrs.push(chunk)
  })
  const connection = new Connection(transport)
  const initializeResult = await connection.request('initialize', {
    clientInfo: { name: MSP_CLIENT_NAME, version: await productVersion() },
    capabilities: {
      userInputDialogs: true,
      requestedCapabilities: [...MSP_REQUESTED_CAPABILITIES],
      experimentalApi: true,
    },
  })
  connection.notify('initialized')
  await connection.flush()
  const lines: LoggedLine[] = []
  const exits: HostExit[] = []
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      resolve({ code, signal })
    })
  })
  const host = new MuseCodeHost(
    {
      connection,
      initializeResult,
      exited,
      close: async () => {
        await transport.close()
      },
    },
    collectingCoreLog(lines),
  )
  host.onExit((exit: HostExit) => {
    exits.push(exit)
  })
  const echo = { host, child, home, lines, exits }
  live.push(echo)
  return echo
}

afterEach(async () => {
  for (const echo of live.splice(0)) {
    try {
      echo.child.kill('SIGKILL')
    } catch {
      // Already gone: the test killed it, which is the point.
    }
    try {
      await echo.host.close()
    } catch {
      // Already gone: closing a dead host is cleanup.
    }
    await rm(echo.home, { recursive: true, force: true })
  }
  for (const home of scratchHomes.splice(0)) {
    await rm(home, { recursive: true, force: true })
  }
})

/** A controller that only records what the registry tells it: the registry is under test. */
class ProbeController implements SessionController {
  public readonly exits: HostExit[] = []
  public released = false

  public constructor(
    public readonly host: AgentHost,
    public readonly session: AgentSession,
  ) {}

  public hostExited(exit: HostExit): void {
    this.exits.push(exit)
  }

  public get isReleased(): boolean {
    return this.released
  }

  public release(): Promise<unknown> {
    this.released = true
    this.session.dispose()
    return Promise.resolve()
  }
}

function hasSkippedLine(lines: readonly LoggedLine[], sessionId: string, verb: string): boolean {
  return lines.some(
    (line) =>
      line.level === 'info' &&
      line.message.includes(sessionId) &&
      line.message.includes(verb) &&
      line.message.includes('exited'),
  )
}

function bareErrorLines(lines: readonly LoggedLine[]): readonly LoggedLine[] {
  return lines.filter((line) => line.message === 'Error' || line.message.endsWith('failed: Error'))
}

/** The echo turn's own words for a finished turn, read off a warm turn, never guessed. */
async function warmEchoTurn(session: AgentSession): Promise<string> {
  const terminals: string[] = []
  const stop = session.onEvent((event) => {
    if (event.type === 'turnCompleted') {
      terminals.push(event.terminal)
    }
  })
  try {
    const parts: readonly TurnPart[] = [{ type: 'text', text: 'warm up' }]
    await session.sendTurn(parts)
    for (let attempt = 0; attempt < 200 && terminals.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(terminals.length).toBeGreaterThan(0)
    return terminals[0]!
  } finally {
    stop()
  }
}

describe.skipIf(MUSE === undefined)('a dead muse serve under real sessions', () => {
  it(
    'idle: the exit reports its reason and the session stops skip quietly',
    async () => {
      const muse = museOrThrow()
      const stderrs: string[] = []
      const echo = await startEchoHost(
        muse,
        ['serve', '--provider', 'echo', '--no-session-log'],
        stderrs,
      )
      const session = await echo.host.startSession({
        workspaceRoot: echo.home,
        modelId: 'echo',
        approvalMode: 'onRequest',
      })
      const stopped: HostExit[] = []
      const registry = new ControllerRegistry<ProbeController>({
        missing: (sessionId: string) => new Error(`missing ${sessionId}`),
        hostStopped: (_host: AgentHost, exit: HostExit) => {
          stopped.push(exit)
        },
        released: () => undefined,
      })
      registry.watch(echo.host)
      const claim = registry.claim(session.sessionId)
      const probe = await registry.adopt(
        echo.host,
        session,
        claim,
        () => {
          return new ProbeController(echo.host, session)
        },
        () => Promise.resolve(),
      )

      echo.child.kill('SIGKILL')
      for (let attempt = 0; attempt < 500 && echo.exits.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      expect(echo.exits).toHaveLength(1)
      const exit = echo.exits[0]!
      expect(exit.isExpected).toBe(false)
      expect(exit.isFailure).toBe(true)
      if (process.platform === 'win32') {
        expect(exit.description.length).toBeGreaterThan(0)
      } else {
        expect(exit.description).toBe(fill(UI_TEXT.museStoppedBySignal, { signal: 'SIGKILL' }))
        expect(exit.isPersistent).toBe(false)
      }
      // The whole exit travels the shared seam, not just its description.
      expect(stopped).toHaveLength(1)
      expect(stopped[0]).toBe(exit)
      expect(probe.exits).toHaveLength(1)
      expect(probe.exits[0]).toBe(exit)
      for (let attempt = 0; attempt < 500 && !probe.released; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      expect(probe.released).toBe(true)
      expect(registry.held(session.sessionId)).toBeUndefined()

      // Stops on the dead host resolve instead of throwing into the log.
      await session.cancel()
      await session.stopAllTasks()
      await expect(session.stopAllTasks()).resolves.toBeUndefined()
      expect(hasSkippedLine(echo.lines, session.sessionId, 'turn/cancel')).toBe(true)
      expect(hasSkippedLine(echo.lines, session.sessionId, 'task/stopAll')).toBe(true)
      expect(bareErrorLines(echo.lines)).toEqual([])
    },
    RECOVER_TEST_TIMEOUT_MS,
  )

  it(
    'mid-turn: a turn in flight when the host dies never reports finished',
    async () => {
      const muse = museOrThrow()
      const stderrs: string[] = []
      const echo = await startEchoHost(
        muse,
        ['serve', '--provider', 'echo', '--no-session-log'],
        stderrs,
      )
      const session = await echo.host.startSession({
        workspaceRoot: echo.home,
        modelId: 'echo',
        approvalMode: 'onRequest',
      })
      const finishedTerminal = await warmEchoTurn(session)
      // Completions land in the callback, so they collect in an array the
      // test reads after the exit, never in flags narrowed at the throw.
      const completions: ('before' | 'after')[] = []

      let isExitSeen = false
      session.onEvent((event) => {
        if (event.type === 'turnCompleted' && event.terminal === finishedTerminal) {
          completions.push(isExitSeen ? 'after' : 'before')
        }
      })
      const parts: readonly TurnPart[] = [{ type: 'text', text: 'hello echo turn' }]
      const submission = session.sendTurn(parts)
      // The kill lands in the same tick as the dispatch, hundreds of
      // milliseconds before the echo turn could complete.
      echo.child.kill('SIGKILL')
      let settled: 'resolved' | 'rejected'
      try {
        await submission
        settled = 'resolved'
      } catch {
        settled = 'rejected'
      }
      for (let attempt = 0; attempt < 500 && echo.exits.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      expect(echo.exits).toHaveLength(1)
      isExitSeen = true
      if (completions.includes('before')) {
        // The turn genuinely finished first: its submission resolved.
        expect(settled).toBe('resolved')
      } else {
        // The kill won, as it does: the turn fails instead of hanging or
        // finishing, and no completion lands afterwards.
        expect(settled).toBe('rejected')
      }
      expect(completions).not.toContain('after')
      expect(echo.exits[0]?.isExpected).toBe(false)
      await session.cancel()
      expect(bareErrorLines(echo.lines)).toEqual([])
    },
    RECOVER_TEST_TIMEOUT_MS,
  )

  it(
    'background tasks: task/stopAll on a dead host skips, naming the state',
    async () => {
      const muse = museOrThrow()
      const stderrs: string[] = []
      const echo = await startEchoHost(
        muse,
        ['serve', '--provider', 'echo', '--no-session-log'],
        stderrs,
      )
      const session = await echo.host.startSession({
        workspaceRoot: echo.home,
        modelId: 'echo',
        approvalMode: 'onRequest',
      })
      // Accepted over none, too: the echo session runs no tasks.
      await expect(session.stopAllTasks()).resolves.toBeUndefined()
      echo.child.kill('SIGKILL')
      for (let attempt = 0; attempt < 500 && echo.exits.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      expect(echo.exits).toHaveLength(1)
      await expect(session.stopAllTasks()).resolves.toBeUndefined()
      await expect(session.interrupt()).resolves.toBeUndefined()
      expect(hasSkippedLine(echo.lines, session.sessionId, 'task/stopAll')).toBe(true)
      expect(hasSkippedLine(echo.lines, session.sessionId, 'turn/interrupt')).toBe(true)
      expect(bareErrorLines(echo.lines)).toEqual([])

      // The exit that lands, or landed unprocessed, during the call reads
      // the same way: a stop dispatched in the kill's own tick still
      // settles instead of warning a bare Error.
      const racing = await startEchoHost(
        muse,
        ['serve', '--provider', 'echo', '--no-session-log'],
        stderrs,
      )
      const racingSession = await racing.host.startSession({
        workspaceRoot: racing.home,
        modelId: 'echo',
        approvalMode: 'onRequest',
      })
      const stopping = racingSession.stopAllTasks()
      racing.child.kill('SIGKILL')
      await expect(stopping).resolves.toBeUndefined()
      for (let attempt = 0; attempt < 500 && racing.exits.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      expect(racing.exits).toHaveLength(1)
      expect(bareErrorLines(racing.lines)).toEqual([])
    },
    RECOVER_TEST_TIMEOUT_MS,
  )

  it(
    'failed restart: a resume the store cannot serve reads as not-found',
    async () => {
      const muse = museOrThrow()
      const stderrs: string[] = []
      const echo = await startEchoHost(
        muse,
        ['serve', '--provider', 'echo', '--no-session-log'],
        stderrs,
      )
      const session = await echo.host.startSession({
        workspaceRoot: echo.home,
        modelId: 'echo',
        approvalMode: 'onRequest',
      })
      // The unsigned CLI serves ephemeral sessions: it unserves resume, and
      // the host reads that refusal, like the store's own, as not-found, so
      // the agent answers in words instead of a wire error.
      await expect(hostResume(echo.host, session.sessionId)).rejects.toSatisfy(
        isSessionNotFoundError,
      )
      await expect(hostResume(echo.host, '00000000-0000-7000-8000-000000000000')).rejects.toSatisfy(
        isSessionNotFoundError,
      )
      expect(bareErrorLines(echo.lines)).toEqual([])
    },
    RECOVER_TEST_TIMEOUT_MS,
  )

  it(
    'failed restart: a CLI that cannot stay up fails the handshake fast',
    async () => {
      const muse = museOrThrow()
      const stderrs: string[] = []
      // The local provider with no local server: the real CLI exits at
      // once, which is what a crash loop looks like from the outside.
      const home = await mkdtemp(path.join(tmpdir(), 'acp-recover-'))
      scratchHomes.push(home)
      const child = spawn(muse, ['serve', '--provider', 'local', '--no-session-log'], {
        env: {
          ...isolatedRuntimeEnvironment(home, tmpdir()),
          MUSE_NO_AUTO_UPDATE: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
        child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
          resolve({ code, signal })
        })
      })
      const transport = new ChildStdioTransport(child, (chunk: string) => {
        stderrs.push(chunk)
      })
      const connection = new Connection(transport)
      await expect(
        connection.request('initialize', {
          clientInfo: { name: MSP_CLIENT_NAME, version: await productVersion() },
          capabilities: {
            userInputDialogs: true,
            requestedCapabilities: [...MSP_REQUESTED_CAPABILITIES],
            experimentalApi: true,
          },
        }),
      ).rejects.toThrow()
      const exit = await exited
      expect(exit.code ?? exit.signal).not.toBeNull()
      try {
        child.kill('SIGKILL')
      } catch {
        // Already gone, which is the point.
      }
      try {
        await connection.close()
      } catch {
        // Already gone with the CLI: closing a dead pipe is cleanup.
      }
    },
    RECOVER_TEST_TIMEOUT_MS,
  )
})

async function hostResume(host: MuseCodeHost, sessionId: string): Promise<unknown> {
  return await host.resumeSession(sessionId, 'echo')
}
