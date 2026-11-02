// A real `muse serve` dying under real sessions (RLF-ACPRECOVER): the host
// reports an unexpected exit with its reason, a turn in flight never
// reports finished, and stop calls on the dead host skip, naming the
// state, instead of warning a bare `Error`. The CLI runs its echo
// provider under a throwaway home with a dead proxy, so zero model calls
// leave the machine; the unsigned CLI serves ephemeral sessions, so
// resume-after-restart is proven refused (as not-found), while the
// agent-level re-attach that consumes it runs signed-in
// (acpBackendRecoverAgent.test.ts). Measured 2026-11-02 on CLI 1.4.14.
import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Connection } from '@muse-code/sdk'
import { ChildStdioTransport } from '@muse-code/sdk/dist/src/connection/spawn.js'
import type { AgentHost, AgentSession, HostExit, TurnPart } from '../../src/core/agent/agentBackend'
import { isSessionNotFoundError } from '../../src/core/agent/agentBackend'
import type { MuseCodeHost, MuseSession } from '../../src/core/backends/musecode/MuseCodeHost'
import {
  ControllerRegistry,
  type SessionController,
} from '../../src/runtime/panel/controllerRegistry'
import { isolatedRuntimeEnvironment } from './helpers/isolatedRuntimeEnvironment'
import { MSP_CLIENT_NAME, MSP_REQUESTED_CAPABILITIES, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import {
  MUSE,
  RECOVER_TEST_TIMEOUT_MS,
  bareErrorLines,
  childExit,
  cleanupRecoverRig,
  hasSkippedLine,
  museOrThrow,
  productVersion,
  startServeHost,
  trackScratchHome,
  waitFor,
  type ServeHost,
} from './helpers/acpRecoverRig'

afterEach(cleanupRecoverRig)

/** The sign-out the unsigned leg runs under: a file naming no provider. */
const EMPTY_CREDENTIAL = '{ "providers": {}, "schema_version": 2 }'

/** No model call can leave the machine: every proxy points at a dead port. */
const DEAD_PROXY: NodeJS.ProcessEnv = {
  HTTP_PROXY: 'http://127.0.0.1:9',
  HTTPS_PROXY: 'http://127.0.0.1:9',
  ALL_PROXY: 'http://127.0.0.1:9',
  http_proxy: 'http://127.0.0.1:9',
  https_proxy: 'http://127.0.0.1:9',
  all_proxy: 'http://127.0.0.1:9',
  NO_PROXY: '',
}

async function openUnsignedEchoSession(): Promise<{ echo: ServeHost; session: MuseSession }> {
  const stderrs: string[] = []
  const echo = await startServeHost({
    muse: museOrThrow(),
    serveArgs: ['serve', '--provider', 'echo', '--no-session-log'],
    stderrs,
    home: { kind: 'throwaway-unsigned', credentialText: EMPTY_CREDENTIAL },
    extraEnv: DEAD_PROXY,
  })
  const session = await echo.host.startSession({
    workspaceRoot: echo.home,
    modelId: 'echo',
    approvalMode: 'onRequest',
  })
  return { echo, session }
}

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
    await waitFor('the warm echo turn never completed', () => terminals.length > 0)
    return terminals[0]!
  } finally {
    stop()
  }
}

describe.skipIf(MUSE === undefined)('a dead muse serve under real sessions', () => {
  it(
    'idle: the exit reports its reason and the session stops skip quietly',
    async () => {
      const { echo, session } = await openUnsignedEchoSession()
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
      await waitFor('the killed serve never exited', () => echo.exits.length > 0)
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
      await waitFor('the registry never retired the dead session', () => probe.released)
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
      const { echo, session } = await openUnsignedEchoSession()
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
      await waitFor('the killed serve never exited', () => echo.exits.length > 0)
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
      const { echo, session } = await openUnsignedEchoSession()
      // Accepted over none, too: the echo session runs no tasks.
      await expect(session.stopAllTasks()).resolves.toBeUndefined()
      echo.child.kill('SIGKILL')
      await waitFor('the killed serve never exited', () => echo.exits.length > 0)
      expect(echo.exits).toHaveLength(1)
      await expect(session.stopAllTasks()).resolves.toBeUndefined()
      await expect(session.interrupt()).resolves.toBeUndefined()
      expect(hasSkippedLine(echo.lines, session.sessionId, 'task/stopAll')).toBe(true)
      expect(hasSkippedLine(echo.lines, session.sessionId, 'turn/interrupt')).toBe(true)
      expect(bareErrorLines(echo.lines)).toEqual([])

      // The exit that lands, or landed unprocessed, during the call reads
      // the same way: a stop dispatched in the kill's own tick still
      // settles instead of warning a bare Error.
      const { echo: racing, session: racingSession } = await openUnsignedEchoSession()
      const stopping = racingSession.stopAllTasks()
      racing.child.kill('SIGKILL')
      await expect(stopping).resolves.toBeUndefined()
      await waitFor('the killed serve never exited', () => racing.exits.length > 0)
      expect(racing.exits).toHaveLength(1)
      expect(bareErrorLines(racing.lines)).toEqual([])
    },
    RECOVER_TEST_TIMEOUT_MS,
  )

  it(
    'failed restart: a resume the store cannot serve reads as not-found',
    async () => {
      const { echo, session } = await openUnsignedEchoSession()
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
      trackScratchHome(home)
      const child = spawn(muse, ['serve', '--provider', 'local', '--no-session-log'], {
        env: {
          ...isolatedRuntimeEnvironment(home, tmpdir()),
          MUSE_NO_AUTO_UPDATE: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const exited = childExit(child)
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
