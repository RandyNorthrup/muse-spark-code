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
import { MHP_ERROR_CODES, UI_TEXT } from '../../src/shared/constants'
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
import { collectingLogger } from './helpers/collectingLogger'

const CANARY = 'canary-question-text-rlf-m104c'

const statusCallSchema = z.strictObject({
  jsonrpc: z.literal('2.0'),
  id: idSchema,
  method: z.literal('ui/status'),
  params: MHP_METHODS['ui/status'].params,
})
const notifyCallSchema = z.strictObject({
  jsonrpc: z.literal('2.0'),
  id: idSchema,
  method: z.literal('ui/notify'),
  params: MHP_METHODS['ui/notify'].params,
})

async function until(isReady: () => boolean): Promise<void> {
  for (let turn = 0; turn < 200 && !isReady(); turn += 1)
    await new Promise((resolve) => setImmediate(resolve))
}

function recordingLog() {
  const lines: string[] = []
  return { ...collectingLogger(lines), lines }
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
  const notifyCalls = () =>
    lines
      .map((line) => notifyCallSchema.safeParse(JSON.parse(line)))
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data)
  const replied = new Set<string>()
  /** The editor's own answer to a status it will not take. */
  const refuseStatus = (id: z.infer<typeof idSchema>) => {
    replied.add(JSON.stringify(id))
    connection.receive(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code: MHP_ERROR_CODES.internalError, message: 'not taken' },
      }),
    )
  }
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
    notifyCalls,
    refuseStatus,
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

  // RVHOSTS2's open P3: a refused status was only logged, and the count it
  // remembered kept the next same-count update from ever trying again.
  it('says a refused status once, and publishes again at the same count', async () => {
    const rigged = await rig()
    try {
      rigged.publisher.update(snapshot('session-1', ['open']))
      await until(() => rigged.statusCalls().length === 1)
      rigged.refuseStatus(rigged.statusCalls()[0]!.id)
      await until(() => rigged.notifyCalls().length === 1)
      expect(rigged.notifyCalls()[0]?.params).toEqual({
        severity: 'warning',
        message: UI_TEXT.openQuestionsStatusFailed,
      })
      rigged.publisher.update(snapshot('session-1', ['open']))
      await until(() => rigged.statusCalls().length === 2)
      expect(rigged.statusCalls()[1]?.params).toEqual(rigged.statusCalls()[0]?.params)
      // Still refused: logged again, and the person is not told twice.
      rigged.refuseStatus(rigged.statusCalls()[1]!.id)
      await until(
        () => rigged.log.lines.filter((line) => line.includes('questions status')).length === 2,
      )
      expect(rigged.notifyCalls()).toHaveLength(1)
      // Taken at last: the count stands, and only a new failure is said again.
      rigged.publisher.update(snapshot('session-1', ['open']))
      await until(() => rigged.statusCalls().length === 3)
      await rigged.settleReplies()
      rigged.publisher.update(snapshot('session-1', ['open']))
      await rigged.settleReplies()
      expect(rigged.statusCalls()).toHaveLength(3)
      rigged.publisher.update(snapshot('session-1', ['open', 'open']))
      await until(() => rigged.statusCalls().length === 4)
      rigged.refuseStatus(rigged.statusCalls()[3]!.id)
      await until(() => rigged.notifyCalls().length === 2)
      expect(rigged.notifyCalls()).toHaveLength(2)
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
