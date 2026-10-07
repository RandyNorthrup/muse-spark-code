// M112: the real engines, the captured fake Muse CLI over a child process,
// and the Model API's captured SSE fake. No live service or credential is used.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EXPECTED_SCHEMA_FINGERPRINT } from '@muse-code/sdk'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../src/core/agent/agentBackend'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { QuestionRegistry } from '../../src/core/questions/registry'
import { questionAnswerText } from '../../src/core/questions/lateAnswer'
import { createQuestionStore } from '../../src/runtime/questions/questionStore'
import { MuseCodeBackendManager } from '../../src/host/backend/museCodeBackendManager'
import { DEFAULT_MODEL_ID, QUESTION_MODEL_TEXT, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { FakeLogOutputChannel } from '../unit/helpers/fakes'
import { fakeModelApi, fakeModelApiClient } from '../unit/helpers/fakeModelApi'
import { fakeModelApiHostDeps } from '../unit/helpers/modelApiHostDeps'
import { memoryToolIo } from '../unit/helpers/fakeToolIo'
import { FakeQuestionClock } from '../unit/helpers/questions/clock'
import { questionFixture } from '../unit/helpers/questions/fixtures'
import { installFakeCredential, installFakeMuse, removeTestFolders } from './fakeMuse'

const fake = installFakeMuse()
const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'm112-e2e-'))
const configHome = installFakeCredential()
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).toReversed()) await close()
  vi.unstubAllEnvs()
})
afterAll(() => {
  removeTestFolders([fake.installDir, workspaceRoot, configHome])
})

async function engine(backend: 'museCode' | 'modelApi', isRunning: boolean) {
  const log = new FakeLogOutputChannel()
  const api = fakeModelApi()
  const held = Promise.withResolvers<undefined>()
  let session: AgentSession
  if (backend === 'museCode') {
    vi.stubEnv('XDG_CONFIG_HOME', configHome)
    const manager = new MuseCodeBackendManager({
      workspaceRoot,
      isWorkspaceTrusted: () => true,
      getConfiguredBinaryPath: () => fake.binaryPath,
      getEnvironmentVariables: () => [
        { name: 'MUSE_FAKE_NODE', value: process.execPath },
        { name: 'MUSE_FAKE_FINGERPRINT', value: EXPECTED_SCHEMA_FINGERPRINT },
      ],
      log,
      getShellSandbox: () => 'off',
      beforeWorkspaceHostStart: () => Promise.resolve(),
      getSandboxNetwork: () => 'default',
      extensionVersion: '0.0.0-e2e',
      userProfileDir: undefined,
      getProxySettings: () => ({ proxy: '', noProxy: [] }),
    })
    cleanups.push(async () => {
      await manager.dispose()
    })
    const host = await manager.ensureHost()
    session = await host.startSession({
      workspaceRoot,
      modelId: DEFAULT_MODEL_ID,
      approvalMode: 'askUnmatched',
    })
  } else {
    const host = new ModelApiHost(
      fakeModelApiHostDeps({
        client: fakeModelApiClient(api, log),
        workspaceRoot,
        io: memoryToolIo({}, workspaceRoot),
        log,
      }),
    )
    cleanups.push(async () => {
      held.resolve(undefined)
      await host.close()
    })
    session = await host.startSession({
      workspaceRoot,
      modelId: 'muse-spark-1.3',
      approvalMode: 'promptUnmatched',
    })
    api.script(
      {
        calls: [
          {
            name: 'ask_user',
            arguments: JSON.stringify({
              questions: questionFixture().questions,
            }),
          },
        ],
      },
      { text: 'Continuing independent work.', ...(isRunning && { hold: held.promise }) },
      { text: 'Thanks for the late answer.' },
    )
  }
  const events: AgentEvent[] = []
  const failures: unknown[] = []
  const delivered: string[] = []
  let turnId: string | undefined
  const clock = new FakeQuestionClock()
  const registry = new QuestionRegistry(session.sessionId, backend, {
    store: createQuestionStore(
      path.join(workspaceRoot, `questions-${backend}-${String(isRunning)}`),
    ),
    now: () => clock.now(),
    setTimer: (ms, callback) => clock.setTimer(ms, callback),
    deferQuestions: (id) => session.deferQuestions(id),
    formatAnswer: questionAnswerText,
    reply: (id, reply) => {
      if (reply === undefined) return session.cancelQuestions(id)
      return 'explanation' in reply
        ? session.clarifyQuestions(id, reply.explanation)
        : session.answerQuestions(id, reply.answers)
    },
    changed: () => {
      /* The test observes the real registry's snapshot below. */
    },
    failed: () => {
      failures.push(new Error('question operation failed'))
    },
    deliver: async (message) => {
      delivered.push(message.text)
      if (turnId === undefined)
        await session.sendTurn([{ type: 'text', text: message.text }], message.displayText)
      else await session.steer(turnId, [{ type: 'text', text: message.text }])
      return 'taken'
    },
  })
  await registry.ready()
  cleanups.push(async () => {
    registry.dispose()
    await session.cancel()
  })
  session.onEvent((event) => {
    events.push(event)
    if (event.type === 'turnStarted') turnId = event.turnId
    else if (event.type === 'turnCompleted' && turnId === event.turnId) turnId = undefined
    if (event.type === 'questionRequested') {
      if (turnId === undefined) throw new Error('question without a captured turn start')
      void registry.register({ ...event, turnId }, 60, false).catch((error: unknown) => {
        failures.push(error)
      })
    } else if (event.type === 'questionSettled')
      void registry.settle(event.userInputId, event.outcome).catch((error: unknown) => {
        failures.push(error)
      })
  })
  return { session, events, registry, clock, delivered, failures, api, held, log }
}

async function waitForQuestion(h: Awaited<ReturnType<typeof engine>>) {
  await vi.waitFor(() => {
    expect(h.registry.snapshot().questions[0]?.state).toBe('waiting')
  })
  await h.registry.ready()
  expect(h.clock.pendingTimers).toBe(1)
  const id = h.registry.snapshot().questions[0]?.userInputId
  if (id === undefined) throw new Error('missing question')
  h.clock.advance(60_000)
  return id
}

describe('M112 engine question flow', () => {
  it.each(['museCode', 'modelApi'] as const)(
    'defers and delivers one late steer through %s',
    async (backend) => {
      const h = await engine(backend, true)
      await h.session.sendTurn([{ type: 'text', text: 'question-running' }])
      const id = await waitForQuestion(h)
      await vi.waitFor(() => {
        expect(h.events).toContainEqual(
          expect.objectContaining({ type: 'questionSettled', outcome: 'deferred' }),
        )
      })
      expect(h.events.some((event) => event.type === 'turnCompleted')).toBe(false)
      const reply = { explanation: 'Use teal; PRIVATE-QUESTION-CANARY.' }
      const results = await Promise.allSettled([
        h.registry.answer(id, reply),
        h.registry.answer(id, reply),
      ])
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
      expect(h.delivered).toHaveLength(1)
      expect(h.delivered[0]).toContain('PRIVATE-QUESTION-CANARY')
      h.held.resolve(undefined)
      if (backend === 'modelApi') {
        await vi.waitFor(() => {
          expect(h.events.some((event) => event.type === 'turnCompleted')).toBe(true)
        })
        expect(JSON.stringify(h.api.responseBodies().at(-1)?.['input'])).toContain(
          'PRIVATE-QUESTION-CANARY',
        )
      } else {
        await vi.waitFor(() => {
          expect(
            h.events.filter(
              (event) => event.type === 'itemCompleted' && event.item.kind === 'userMessage',
            ),
          ).toHaveLength(2)
        })
      }
      expect(h.failures).toEqual([])
      expect(
        JSON.stringify([
          h.log.trace.mock.calls,
          h.log.debug.mock.calls,
          h.log.info.mock.calls,
          h.log.warn.mock.calls,
          h.log.error.mock.calls,
        ]),
      ).not.toContain('PRIVATE-QUESTION-CANARY')
    },
  )

  it.each(['museCode', 'modelApi'] as const)(
    'defers, carries on, and delivers one late new turn through %s',
    async (backend) => {
      const h = await engine(backend, false)
      await h.session.sendTurn([{ type: 'text', text: 'question-idle' }])
      const id = await waitForQuestion(h)
      await vi.waitFor(() => {
        expect(h.events.some((event) => event.type === 'turnCompleted')).toBe(true)
      })
      if (backend === 'modelApi')
        expect(h.api.responseBodies()[1]?.['input']).toContainEqual(
          expect.objectContaining({
            type: 'function_call_output',
            output: fill(QUESTION_MODEL_TEXT.deferred, { id }),
          }),
        )
      expect(await h.registry.answer(id, { explanation: 'Teal' })).toBe('taken')
      await expect(h.registry.answer(id, { explanation: 'Teal' })).rejects.toThrow(
        UI_TEXT.answerNotAccepted,
      )
      await vi.waitFor(() => {
        expect(h.events.filter((event) => event.type === 'turnCompleted')).toHaveLength(2)
      })
      expect(h.delivered).toHaveLength(1)
      expect(h.delivered[0]).toContain('Teal')
      expect(h.events.filter((event) => event.type === 'turnStarted')).toHaveLength(2)
      expect(h.failures).toEqual([])
      expect(UI_TEXT.questionLateAnswerDisplay).toContain('{header}')
    },
  )
})
