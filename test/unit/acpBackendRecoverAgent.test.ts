// A real `muse serve` dying under the real ACP agent (RLF-ACPRECOVER):
// the next load or prompt re-attaches the session on a fresh backend,
// a turn in flight ends with the exit's own words, stops on the dead
// backend skip quietly, and a restart that cannot work answers in words.
// The CLI signs in on its own from the real home, exactly as for the
// product; the suites gate on what one `muse serve` answers about
// itself, never on files (a file can name a credential the CLI will
// not honor). Durable sessions re-attach; ephemeral ones prove the
// words, since their store refuses every resume. Zero turns run on a
// model provider: the mid-turn test turns on the echo provider when the
// CLI serves it durably, and skips naming why when it does not; every
// other test sends no prompt with a live backend. Sessions the run
// starts stay in that machine's session store (`session/delete` is
// unserved, so the suite cannot remove them).
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as acp from '@agentclientprotocol/sdk/unstable'
import type { SessionUpdate } from '@agentclientprotocol/sdk/unstable'
import { afterEach, describe, expect, it } from 'vitest'
import { createAcpAgent, type BackendReadiness } from '../../src/acp/agent'
import { isSessionNotFoundError } from '../../src/core/agent/agentBackend'
import { loadUiTable } from '../../src/host/l10n'
import {
  INDUSTRY_RETRY_MAX_RETRIES,
  UI_TEXT,
  type PermissionMode,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { TABLE_LOCALES } from '../../src/shared/l10n/locales'
import { setUiText } from '../../src/shared/l10n/text'
import { fill } from '../../src/shared/l10n/text'
import { acpLocalAgentDeps } from './helpers/acpLocalAgentDeps'
import { withReplayEditorSession } from './helpers/acpReplayRig'
import { levelLogger, type LoggedMessage } from './helpers/collectingLogger'
import {
  MUSE,
  RECOVER_TEST_TIMEOUT_MS,
  bareErrorLines,
  cleanupRecoverRig,
  cliServeAbilities,
  museOrThrow,
  productVersion,
  startServeHost,
  waitFor,
  type ServeHost,
} from './helpers/acpRecoverRig'

const ABILITIES = MUSE === undefined ? { isDurable: false, catalogue: 0 } : cliServeAbilities(MUSE)
// A session opens where the CLI serves a catalogue; only a durable one
// re-attaches after its backend dies.
const CAN_OPEN_SESSION = MUSE !== undefined && ABILITIES.catalogue > 0
const HAS_DURABLE_SESSIONS = MUSE !== undefined && ABILITIES.isDurable

const folders: string[] = []

afterEach(async () => {
  await cleanupRecoverRig()
  for (const folder of folders.splice(0)) {
    await rm(folder, { recursive: true, force: true })
  }
})

async function scratchFolder(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), 'acp-recover-agent-'))
  folders.push(folder)
  return folder
}

interface AgentRig {
  readonly agent: ReturnType<typeof createAcpAgent>
  readonly folder: string
  readonly agentLog: LoggedMessage[]
  readonly spawned: ServeHost[]
}

/**
The real agent over backends the test owns (for the kill): every
`hostFor` call starts a fresh `muse serve` from the real home,
recorded in order, so the first spawn is the session's backend and
later spawns are its restarts. `laterServeArgs` swaps the restart
command (a CLI that cannot stay up); `readiness` rigs the CLI-gone
check. An ephemeral host fixes its permission surface and refuses a
session that selects a profile, so the legs that run there open in
Plan, which selects none.
*/
async function startAgentRig(options: {
  readonly serveArgs: readonly string[]
  readonly initialMode: PermissionMode
  readonly laterServeArgs?: readonly string[]
  readonly readiness?: () => BackendReadiness
}): Promise<AgentRig> {
  const muse = museOrThrow()
  const folder = await scratchFolder()
  const agentLog: LoggedMessage[] = []
  const spawned: ServeHost[] = []
  const stderrs: string[] = []
  let calls = 0
  const agent = createAcpAgent({
    backend: {
      kind: 'museCode',
      readiness: () => Promise.resolve(options.readiness?.() ?? { state: 'ready' }),
      hostFor: async () => {
        calls += 1
        const serve = await startServeHost({
          muse,
          serveArgs:
            calls === 1 ? options.serveArgs : (options.laterServeArgs ?? options.serveArgs),
          stderrs,
          home: { kind: 'real' },
        })
        spawned.push(serve)
        return serve.host
      },
    },
    version: await productVersion(),
    options: {
      canBypass: false,
      allowsContributorModels: false,
      initialMode: options.initialMode,
    },
    signIn: {
      id: 'login',
      name: 'Muse Code',
      description: 'Muse Code',
      args: [],
      command: 'muse login',
    },
    ...acpLocalAgentDeps(folder, levelLogger(agentLog)),
  })
  return { agent, folder, agentLog, spawned }
}

/** The agent detached the dead session: the next prompt brings it back. */
async function waitDetached(agentLog: readonly LoggedMessage[]): Promise<void> {
  await waitFor('the agent never recorded the dead session as detached', () =>
    agentLog.some((entry) => entry.message.includes('the next prompt brings it back')),
  )
}

/** Neither the agent nor any backend said only `Error`, or lost the id. */
function expectNoBareErrors(
  agentLog: readonly LoggedMessage[],
  spawned: readonly ServeHost[],
): void {
  expect(bareErrorLines(agentLog)).toEqual([])
  expect(bareErrorLines(spawned.flatMap((serve) => serve.lines))).toEqual([])
  for (const entry of agentLog) {
    expect(entry.message).not.toContain('Resource not found')
  }
}

/** The ACP error message a request answered with; throws when it unexpectedly succeeded. */
async function messageOf(request: Promise<unknown>): Promise<string> {
  try {
    await request
  } catch (error: unknown) {
    if (error instanceof acp.RequestError) {
      return error.message
    }
    throw error
  }
  throw new Error('the request unexpectedly succeeded')
}

/** Kills the session's backend, retires it, and closes the dead session. */
async function killCloseSession(
  editor: acp.ClientContext,
  rig: AgentRig,
  sessionId: string,
): Promise<void> {
  const backend = rig.spawned[0]!
  backend.child.kill('SIGKILL')
  await waitDetached(rig.agentLog)
  // The retire names the state instead of warning a bare Error: the
  // exit aborts the channel before the retire runs, so the dispose
  // says the host is closing and stops nothing on it.
  await waitFor('the dead session was never retired', () =>
    backend.lines.some(
      (line) =>
        line.level === 'info' &&
        line.message.includes(sessionId) &&
        line.message.includes('released with its closing host'),
    ),
  )
  // A cancel on the dead session is a quiet no-op, and a close gives
  // up the resume without throwing.
  await editor.notify('session/cancel', { sessionId })
  await editor.request('session/close', { sessionId })
  expectNoBareErrors(rig.agentLog, rig.spawned)
}

const SERVE = ['serve', '--no-session-log'] as const
const SERVE_ECHO = ['serve', '--provider', 'echo', '--no-session-log'] as const
// A CLI that cannot stay up: the local provider with no local server
// exits during the handshake, which is what a crash loop looks like.
const SERVE_DYING = ['serve', '--provider', 'local', '--no-session-log'] as const

describe('a dead muse serve under the real ACP agent', () => {
  describe.skipIf(!HAS_DURABLE_SESSIONS)('durable agent recovery', () => {
    it(
      'idle: the next load re-attaches the session on a fresh backend',
      async () => {
        const rig = await startAgentRig({ serveArgs: SERVE, initialMode: 'manual' })
        const seen: SessionUpdate[] = []
        await withReplayEditorSession(
          rig.agent,
          rig.folder,
          seen,
          'acp-recover-idle',
          async (editor, sessionId) => {
            expect(rig.spawned).toHaveLength(1)
            const first = rig.spawned[0]!
            first.child.kill('SIGKILL')
            await waitDetached(rig.agentLog)

            const loaded = await editor.request('session/load', {
              sessionId,
              cwd: rig.folder,
              mcpServers: [],
            })
            // Re-attached on a fresh backend: a second spawn, a live
            // session the editor can still drive.
            expect(rig.spawned).toHaveLength(2)
            expect(loaded.modes?.availableModes.length).toBeGreaterThan(0)
            await editor.request('session/set_mode', { sessionId, modeId: 'plan' })
            expectNoBareErrors(rig.agentLog, rig.spawned)
          },
        )
      },
      RECOVER_TEST_TIMEOUT_MS,
    )

    it(
      'mid-turn: a killed turn ends in error and the next load brings history back',
      async (ctx) => {
        const muse = museOrThrow()
        const stderrs: string[] = []
        const folder = await scratchFolder()
        // The mid-turn test needs a free provider the CLI serves
        // durably: a catalogue for the agent, a resume that survives
        // a kill. Anything else skips, naming the gap.
        const probe = await startServeHost({
          muse,
          serveArgs: [...SERVE_ECHO],
          stderrs,
          home: { kind: 'real' },
        })
        const models = await probe.host.listModels()
        if (models.length === 0) {
          ctx.skip('the CLI serves the echo provider no catalogue')
          return
        }
        const probeSession = await probe.host.startSession({
          workspaceRoot: folder,
          modelId: models[0]!.modelId,
          approvalMode: 'onRequest',
        })
        probe.child.kill('SIGKILL')
        await waitFor('the probe serve never exited', () => probe.exits.length > 0)
        const probeAgain = await startServeHost({
          muse,
          serveArgs: [...SERVE_ECHO],
          stderrs,
          home: { kind: 'real' },
        })
        try {
          const loaded = await probeAgain.host.resumeSession(
            probeSession.sessionId,
            models[0]!.modelId,
          )
          loaded.session.dispose()
        } catch (error: unknown) {
          if (isSessionNotFoundError(error)) {
            ctx.skip('the CLI serves echo sessions ephemeral')
            return
          }
          throw error
        }

        const rig = await startAgentRig({ serveArgs: SERVE_ECHO, initialMode: 'manual' })
        const seen: SessionUpdate[] = []
        await withReplayEditorSession(
          rig.agent,
          rig.folder,
          seen,
          'acp-recover-midturn',
          async (editor, sessionId) => {
            const firstText = 'first hello, still here after the kill'
            const first = await editor.request('session/prompt', {
              sessionId,
              prompt: [{ type: 'text', text: firstText }],
            })
            expect(first.stopReason).toBe('finished')

            const answering = editor.request('session/prompt', {
              sessionId,
              prompt: [{ type: 'text', text: 'second hello' }],
            })
            const backend = rig.spawned[0]!
            backend.child.kill('SIGKILL')
            let stopReason: string | undefined
            let rejection: unknown
            try {
              const answered = await answering
              stopReason = answered.stopReason
            } catch (error: unknown) {
              rejection = error
            }
            await waitFor('the killed serve never exited', () => backend.exits.length > 0)
            const exit = backend.exits[0]!
            if (stopReason === undefined) {
              // The kill won, as it does: the turn ends with the
              // exit's own words, never reported finished.
              const failure = rejection instanceof acp.RequestError ? rejection : undefined
              expect(failure?.message).toBe(exit.description)
            } else {
              // The echo answered first: a genuine finish stands.
              expect(stopReason).toBe('finished')
            }
            await waitDetached(rig.agentLog)

            const loaded = await editor.request('session/load', {
              sessionId,
              cwd: rig.folder,
              mcpServers: [],
            })
            expect(loaded.modes?.availableModes.length).toBeGreaterThan(0)
            // The first turn's history replays: the person carries on
            // with what they had, not an empty session.
            const replayed = seen.map((update) => JSON.stringify(update)).join('\n')
            expect(replayed).toContain(firstText)
            await editor.request('session/set_mode', { sessionId, modeId: 'plan' })
            expectNoBareErrors(rig.agentLog, rig.spawned)
          },
        )
      },
      RECOVER_TEST_TIMEOUT_MS,
    )

    it(
      'stops: a closed dead session loads fresh from the store',
      async () => {
        const rig = await startAgentRig({ serveArgs: SERVE, initialMode: 'manual' })
        const seen: SessionUpdate[] = []
        await withReplayEditorSession(
          rig.agent,
          rig.folder,
          seen,
          'acp-recover-loadfresh',
          async (editor, sessionId) => {
            await killCloseSession(editor, rig, sessionId)
            // Closed, the id loads fresh from the store: history kept,
            // no handle owed to the dead backend.
            const loaded = await editor.request('session/load', {
              sessionId,
              cwd: rig.folder,
              mcpServers: [],
            })
            expect(loaded.modes?.availableModes.length).toBeGreaterThan(0)
            expectNoBareErrors(rig.agentLog, rig.spawned)
          },
        )
      },
      RECOVER_TEST_TIMEOUT_MS,
    )
  })

  describe.skipIf(!CAN_OPEN_SESSION)('stops and restarts where sessions open', () => {
    it(
      'stops: closing a dead session skips quietly',
      async () => {
        const rig = await startAgentRig({ serveArgs: SERVE, initialMode: 'plan' })
        const seen: SessionUpdate[] = []
        await withReplayEditorSession(
          rig.agent,
          rig.folder,
          seen,
          'acp-recover-stops',
          async (editor, sessionId) => {
            await killCloseSession(editor, rig, sessionId)
          },
        )
      },
      RECOVER_TEST_TIMEOUT_MS,
    )

    it(
      'failed restart: a CLI that is gone answers in words, with no retries',
      async () => {
        let isUnplugged = false
        const rig = await startAgentRig({
          serveArgs: SERVE,
          initialMode: 'plan',
          readiness: () =>
            isUnplugged
              ? { state: 'unavailable', message: 'the test unplugged the CLI' }
              : { state: 'ready' },
        })
        const seen: SessionUpdate[] = []
        await withReplayEditorSession(
          rig.agent,
          rig.folder,
          seen,
          'acp-recover-cligone',
          async (editor, sessionId) => {
            rig.spawned[0]!.child.kill('SIGKILL')
            await waitDetached(rig.agentLog)
            isUnplugged = true

            const message = await messageOf(
              editor.request('session/prompt', {
                sessionId,
                prompt: [{ type: 'text', text: 'hello?' }],
              }),
            )
            expect(message).toBe(UI_TEXT.acpBackendRestartCliGone)
            expect(message).not.toContain('unplugged')
            // Known gone: no restart spawned, no backoff waited.
            expect(rig.spawned).toHaveLength(1)
            expect(
              rig.agentLog.filter((entry) =>
                entry.message.includes('bringing the backend back failed'),
              ),
            ).toHaveLength(0)
            expectNoBareErrors(rig.agentLog, rig.spawned)
          },
        )
      },
      RECOVER_TEST_TIMEOUT_MS,
    )

    it(
      'failed restart: a backend that keeps dying gives up after bounded retries',
      async () => {
        const rig = await startAgentRig({
          serveArgs: SERVE,
          initialMode: 'plan',
          laterServeArgs: SERVE_DYING,
        })
        const seen: SessionUpdate[] = []
        await withReplayEditorSession(
          rig.agent,
          rig.folder,
          seen,
          'acp-recover-gaveup',
          async (editor, sessionId) => {
            rig.spawned[0]!.child.kill('SIGKILL')
            await waitDetached(rig.agentLog)

            const message = await messageOf(
              editor.request('session/prompt', {
                sessionId,
                prompt: [{ type: 'text', text: 'hello?' }],
              }),
            )
            expect(message).toBe(UI_TEXT.acpBackendRestartGaveUp)
            // Bounded: one try plus the industry retries, each said.
            const failures = rig.agentLog.filter((entry) =>
              entry.message.includes('bringing the backend back failed'),
            )
            expect(failures).toHaveLength(INDUSTRY_RETRY_MAX_RETRIES + 1)
            // Each wait showed as the panel's retry notice, in words.
            const shown = seen.map((update) => JSON.stringify(update)).join('\n')
            expect(shown).toContain(retryParenthetical(1))
            expect(shown).toContain(retryParenthetical(2))
            expectNoBareErrors(rig.agentLog, rig.spawned)
          },
        )
      },
      RECOVER_TEST_TIMEOUT_MS,
    )

    it(
      'failed restart: the person can stop the restart while it waits',
      async () => {
        const rig = await startAgentRig({
          serveArgs: SERVE,
          initialMode: 'plan',
          laterServeArgs: SERVE_DYING,
        })
        const seen: SessionUpdate[] = []
        await withReplayEditorSession(
          rig.agent,
          rig.folder,
          seen,
          'acp-recover-stop',
          async (editor, sessionId) => {
            rig.spawned[0]!.child.kill('SIGKILL')
            await waitDetached(rig.agentLog)

            const answering = editor.request('session/prompt', {
              sessionId,
              prompt: [{ type: 'text', text: 'hello?' }],
            })
            await waitFor('the restart never began its backoff', () =>
              rig.agentLog.some((entry) =>
                entry.message.includes('bringing the backend back failed'),
              ),
            )
            await editor.notify('session/cancel', { sessionId })
            const answer = await answering
            // Stopped while it waited: cancelled, never a turn that ran,
            // and no second attempt after the stop.
            expect(answer.stopReason).toBe('cancelled')
            expect(
              rig.agentLog.filter((entry) =>
                entry.message.includes('bringing the backend back failed'),
              ),
            ).toHaveLength(1)
            expectNoBareErrors(rig.agentLog, rig.spawned)
          },
        )
      },
      RECOVER_TEST_TIMEOUT_MS,
    )
  })

  describe.skipIf(!CAN_OPEN_SESSION || HAS_DURABLE_SESSIONS)('ephemeral words', () => {
    it(
      'failed restart: a store without the session answers in words',
      async () => {
        const rig = await startAgentRig({ serveArgs: SERVE, initialMode: 'plan' })
        const seen: SessionUpdate[] = []
        await withReplayEditorSession(
          rig.agent,
          rig.folder,
          seen,
          'acp-recover-lost',
          async (editor, sessionId) => {
            rig.spawned[0]!.child.kill('SIGKILL')
            await waitDetached(rig.agentLog)

            // The store refuses the resume, so both doors say the
            // history is lost, never a request id: the load's branch
            // and the prompt's re-attach.
            const loaded = await messageOf(
              editor.request('session/load', {
                sessionId,
                cwd: rig.folder,
                mcpServers: [],
              }),
            )
            expect(loaded).toBe(UI_TEXT.acpBackendRestartSessionLost)
            const answered = await messageOf(
              editor.request('session/prompt', {
                sessionId,
                prompt: [{ type: 'text', text: 'hello?' }],
              }),
            )
            expect(answered).toBe(UI_TEXT.acpBackendRestartSessionLost)
            expectNoBareErrors(rig.agentLog, rig.spawned)
          },
        )
      },
      RECOVER_TEST_TIMEOUT_MS,
    )
  })

  it('failed restart: the words render in all 15 languages', async () => {
    const keys = [
      'acpBackendRestartCliGone',
      'acpBackendRestartSessionLost',
      'acpBackendRestartGaveUp',
    ] as const
    const locales = ['en', ...TABLE_LOCALES]
    expect(locales).toHaveLength(15)
    const root = fileURLToPath(new URL('../..', import.meta.url))
    const messages: LoggedMessage[] = []
    try {
      for (const locale of locales) {
        if (locale === 'en') {
          setUiText(EN, 'en')
        } else {
          // A damaged table falls back to English: the install must
          // name the locale, or this locale proves nothing.
          const loaded = await loadUiTable({
            language: locale,
            readExtensionFile: (segments) => readFile(path.join(root, ...segments), 'utf8'),
            log: levelLogger(messages),
            surface: 'terminal',
          })
          expect(loaded.locale).toBe(locale)
        }
        for (const key of keys) {
          const words = UI_TEXT[key]
          expect(words.length).toBeGreaterThan(0)
          expect(words).not.toMatch(/\{[^}]*\}/u)
          expect(words).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/u)
          expect(words).not.toContain('Resource not found')
        }
      }
    } finally {
      setUiText(EN, 'en')
    }
  })
})

/** The retry notice's stable tail (the seconds vary with the backoff). */
function retryParenthetical(attempt: number): string {
  const words = fill(UI_TEXT.turnRetrying, {
    attempt,
    maxAttempts: INDUSTRY_RETRY_MAX_RETRIES + 1,
    seconds: 0,
  })
  return words.slice(words.indexOf('('))
}
