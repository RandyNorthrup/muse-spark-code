// The open-questions count on MHP's status item through its real code
// only: the publisher, the runtime connection's framing and validation,
// and the installed language's plural form. A native-host observer reads
// the frames a bridge would map to its tool window; question text must
// never appear in one.
import * as z from 'zod/mini'
import { afterEach, describe, expect, it } from 'vitest'
import { PanelConnection, type PanelConnectionPorts } from '../../src/runtime/panel/connection'
import {
  createQuestionsStatusPublisher,
  openQuestionsCount,
  questionsStatusId,
} from '../../src/runtime/panel/questionsStatus'
import { idSchema } from '../../src/shared/hostApi/data'
import { MHP_METHODS } from '../../src/shared/hostApi/methods'
import { panelInitializeResultSchema } from '../../src/shared/hostApi/panel'
import {
  openQuestionsSnapshotSchema,
  type OpenQuestionsSnapshot,
  type QuestionState,
} from '../../src/shared/questions'
import { questionFixture } from './helpers/questions/fixtures'
import { installGerman, restoreEnglish } from './helpers/kindGermanTable'

const CANARY = 'canary-question-text-rlf-m104c'

const statusCallSchema = z.strictObject({
  jsonrpc: z.literal('2.0'),
  id: idSchema,
  method: z.literal('ui/status'),
  params: MHP_METHODS['ui/status'].params,
})

async function until(isReady: () => boolean): Promise<void> {
  for (let turn = 0; turn < 200 && !isReady(); turn += 1)
    await new Promise((resolve) => setImmediate(resolve))
}

function recordingLog() {
  const lines: string[] = []
  const record = (message: string) => {
    lines.push(message)
  }
  return { trace: record, info: record, warn: record, error: record, lines }
}

async function rig() {
  const log = recordingLog()
  const lines: string[] = []
  const notices: unknown[] = []
  let closedCount = 0
  const ports: PanelConnectionPorts = {
    capabilities: ['lifecycle', 'settings', 'storage'],
    request: () => Promise.reject(new Error('unexpected host-to-runtime request')),
    notify: (method, params) => {
      notices.push([method, params])
    },
    initialize: () => Promise.resolve(),
    view: () => undefined,
    closed: () => {
      closedCount += 1
    },
  }
  const connection = new PanelConnection(ports, log)
  connection.delivery.connect((line, complete) => {
    lines.push(line)
    complete()
    return true
  })
  const params = MHP_METHODS.initialize.params.parse({
    host: { id: 'jetbrains-test', version: 'test' },
    protocolRange: { minimum: 'mhp/1.6.0', maximumExclusive: 'mhp/1.7.0' },
    capabilities: ['lifecycle', 'ui'],
    locale: 'en',
    theme: { kind: 'dark', tokens: {} },
    folders: [],
    trusted: true,
  })
  connection.receive(JSON.stringify({ jsonrpc: '2.0', id: 'init-1', method: 'initialize', params }))
  await until(() => lines.length > 0)
  const initialized = lines
    .map((line) => panelInitializeResultSchema.safeParse(JSON.parse(line)))
    .find((parsed) => parsed.success)
  expect(initialized?.success).toBe(true)
  const publisher = createQuestionsStatusPublisher(connection, log)
  const statusCalls = () =>
    lines
      .map((line) => statusCallSchema.safeParse(JSON.parse(line)))
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data)
  const replied = new Set<string>()
  const settleReplies = async () => {
    for (const call of statusCalls()) {
      const key = JSON.stringify(call.id)
      if (replied.has(key)) continue
      replied.add(key)
      connection.receive(JSON.stringify({ jsonrpc: '2.0', id: call.id, result: null }))
    }
    await until(() => statusCalls().every((call) => replied.has(JSON.stringify(call.id))))
  }
  return {
    connection,
    log,
    lines,
    statusCalls,
    settleReplies,
    publisher,
    notices,
    closedCount: () => closedCount,
  }
}

const NON_DEFERRED: ReadonlySet<QuestionState> = new Set([
  'waiting',
  'answered',
  'cancelled',
  'clarified',
])

function snapshot(sessionId: string, states: readonly QuestionState[]): OpenQuestionsSnapshot {
  return openQuestionsSnapshotSchema.parse({
    sessionId,
    questions: states.map((state, index) =>
      questionFixture({
        userInputId: `q-${String(index + 1)}`,
        sessionId,
        state,
        questions: [
          {
            id: 'colour',
            header: 'Colour',
            question: `Which colour? ${CANARY}`,
            selection: { mode: 'single' },
            options: [{ label: 'Blue' }, { label: 'Green' }],
          },
        ],
        ...(NON_DEFERRED.has(state) && { deferredAt: undefined }),
      }),
    ),
  })
}

afterEach(() => {
  restoreEnglish()
})

describe('questions status count', () => {
  it('counts open questions only', () => {
    expect(openQuestionsCount(snapshot('session-1', []))).toBe(0)
    expect(
      openQuestionsCount(snapshot('session-1', ['waiting', 'answered', 'dismissed', 'expired'])),
    ).toBe(0)
    expect(openQuestionsCount(snapshot('session-1', ['open', 'open', 'waiting']))).toBe(2)
  })

  it('publishes one count-only ui/status per session', async () => {
    const rigged = await rig()
    try {
      rigged.publisher.update(snapshot('session-1', ['open', 'open', 'waiting']))
      rigged.publisher.update(snapshot('session-2', ['open']))
      await rigged.settleReplies()
      const calls = rigged.statusCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]?.params).toEqual({
        id: questionsStatusId('session-1'),
        text: '2 Open',
        visible: true,
      })
      expect(calls[1]?.params).toEqual({
        id: questionsStatusId('session-2'),
        text: '1 Open',
        visible: true,
      })
      expect(rigged.lines.join('\n')).not.toContain(CANARY)
      expect(rigged.log.lines).toEqual([])
    } finally {
      rigged.connection.close()
    }
  })

  it('sends nothing when the count is unchanged and hides at zero', async () => {
    const rigged = await rig()
    try {
      rigged.publisher.update(snapshot('session-1', ['open']))
      rigged.publisher.update(snapshot('session-1', ['open', 'waiting']))
      await rigged.settleReplies()
      expect(rigged.statusCalls()).toHaveLength(1)
      rigged.publisher.update(snapshot('session-1', ['answeredLater']))
      await rigged.settleReplies()
      const calls = rigged.statusCalls()
      expect(calls).toHaveLength(2)
      expect(calls[1]?.params.visible).toBe(false)
      expect(rigged.log.lines).toEqual([])
    } finally {
      rigged.connection.close()
    }
  })

  it('releasing a session hides only its item; close hides the rest and ends updates', async () => {
    const rigged = await rig()
    try {
      rigged.publisher.update(snapshot('session-1', ['open']))
      rigged.publisher.update(snapshot('session-2', ['open', 'open']))
      rigged.publisher.releaseSession('session-1')
      rigged.publisher.releaseSession('never-shown')
      await rigged.settleReplies()
      const hidden = rigged.statusCalls().filter((call) => !call.params.visible)
      expect(hidden).toHaveLength(1)
      expect(hidden[0]?.params.id).toBe(questionsStatusId('session-1'))
      expect(rigged.notices).toEqual([])
      rigged.publisher.close()
      rigged.publisher.update(snapshot('session-2', ['open']))
      await rigged.settleReplies()
      expect(rigged.statusCalls().filter((call) => !call.params.visible)).toHaveLength(2)
      expect(rigged.closedCount()).toBe(0)
      expect(rigged.log.lines).toEqual([])
    } finally {
      rigged.connection.close()
    }
  })

  it('reads the installed language, never English baked in', async () => {
    const rigged = await rig()
    try {
      await installGerman(recordingLog())
      rigged.publisher.update(snapshot('session-1', ['open', 'open']))
      await rigged.settleReplies()
      const calls = rigged.statusCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]?.params.text).toBe('2 offen')
      expect(rigged.log.lines).toEqual([])
    } finally {
      rigged.connection.close()
    }
  })

  it('stays silent when the transport is down instead of throwing', async () => {
    const log = recordingLog()
    const ports: PanelConnectionPorts = {
      capabilities: ['lifecycle'],
      request: () => Promise.reject(new Error('unexpected host-to-runtime request')),
      notify: (method, params) => {
        log.lines.push(`notify:${method}:${JSON.stringify(params)}`)
      },
      initialize: () => Promise.resolve(),
      view: () => undefined,
      closed: () => {
        log.lines.push('closed')
      },
    }
    const connection = new PanelConnection(ports, log)
    const lines: string[] = []
    connection.delivery.connect((line, complete) => {
      lines.push(line)
      complete()
      return true
    })
    try {
      const publisher = createQuestionsStatusPublisher(connection, log)
      publisher.update(snapshot('session-1', ['open']))
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))
      expect(lines).toEqual([])
      expect(log.lines.length).toBeGreaterThan(0)
    } finally {
      connection.close()
    }
  })
})
