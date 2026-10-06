import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXPECTED_SCHEMA_FINGERPRINT } from '@muse-code/sdk'
import echoCapture from '../fixtures/m106/msp-echo-1.4.2.json'
import {
  MuseCodeHost,
  type MuseCodeFeaturePorts,
} from '../../src/core/backends/musecode/MuseCodeHost'
import type {
  MuseCodeLifecycleEvent,
  MuseCodeLifecycleReader,
} from '../../src/core/backends/musecode/mapNotification'
import { REDACTED_MARK, UI_TEXT } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeInitializeResult, fakeMspHost, settle } from './helpers/fakeMsp'

// Test only the injected, already-parsed domain contracts. Empty notification
// params and opaque admission/receipt objects deliberately assert no new MSP
// wire shape: the captured-frame readers are still an integration handoff.
function setup(features: MuseCodeFeaturePorts = {}, grants: readonly string[] = []) {
  const fixture = fakeMspHost({ ...fakeInitializeResult, grantedCapabilities: [...grants] })
  const log = new FakeLogOutputChannel()
  const host = new MuseCodeHost(fixture.host, log, { normalMs: 100, longMs: 100 }, features)
  return { ...fixture, log, host, processHost: fixture.host }
}

const report = {
  sessionId: 's',
  classification: 'badResult',
  note: 'A note',
  withFiles: false,
  attachSessionRecord: false,
} as const
const model = {
  modelId: 'muse-spark-1.3',
  displayLabel: 'Muse Spark',
  contextLimit: null,
  isDefault: true,
}
const record = {
  sessionId: 's',
  createdAt: '2026-10-06T00:00:00Z',
  updatedAt: '2026-10-06T00:00:00Z',
  status: 'idle',
  turnCount: 0,
  workspaceRoot: '/ws',
}
const options = { workspaceRoot: '/ws', modelId: model.modelId, approvalMode: 'denyUnmatched' }

function lifecycle() {
  const events: MuseCodeLifecycleEvent[] = []
  const reader: MuseCodeLifecycleReader = {
    parseNotification: vi.fn(() => {
      const event = events.shift()
      if (event === undefined) throw new Error('test reader has no domain event')
      return event
    }),
    parseDeleteAdmission: vi.fn(),
  }
  return { events, reader }
}

function deletion(
  commandId: string,
  overrides: Partial<Extract<MuseCodeLifecycleEvent, { type: 'deleteCompleted' }>> = {},
): MuseCodeLifecycleEvent {
  return { type: 'deleteCompleted', sessionId: 's', commandId, outcome: 'completed', ...overrides }
}

function observeRejection(work: Promise<unknown>) {
  const rejected = vi.fn()
  const waiting = (async () => {
    try {
      await work
    } catch (error: unknown) {
      rejected(error)
    }
  })()
  return { rejected, waiting }
}

async function admittedDeletion(host: MuseCodeHost, reader: MuseCodeLifecycleReader) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const observed = observeRejection(host.deleteSession('s'))
  await settle()
  expect(reader.parseDeleteAdmission).toHaveBeenCalledTimes(1)
  expect(observed.rejected).not.toHaveBeenCalled()
  return observed
}

async function trackedDeletion(
  result: Partial<Extract<MuseCodeLifecycleEvent, { type: 'deleteCompleted' }>> = {},
) {
  const { reader, events } = lifecycle()
  const fixture = setup({ lifecycle: reader })
  fixture.server.handle('session/start', () => ({
    session: { sessionId: 's', modelId: model.modelId },
    viewCursor: '',
  }))
  await fixture.host.startSession(options)
  fixture.server.handle('session/delete', () => ({ opaque: 'admission' }))
  fixture.server.followWith('session/delete', (params) => {
    events.push(deletion(String(params['commandId']), result))
    return [{ jsonrpc: '2.0', method: 'session/deleteCompleted', params: {} }]
  })
  return { ...fixture, reader, events }
}

describe('Muse Code 1.4.2 feature ports', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  it('recognizes the locally served echo handshake and empty catalogue with zero model attempts', async () => {
    const fixture = fakeMspHost({ ...fakeInitializeResult, ...echoCapture.initialize })
    const host = new MuseCodeHost(fixture.host, new FakeLogOutputChannel())
    fixture.server.handle('model/list', () => echoCapture.modelList)
    expect(echoCapture.initialize.schema.fingerprint).toBe(EXPECTED_SCHEMA_FINGERPRINT)
    expect(echoCapture.provenance.modelAttempts).toBe(0)
    expect(host.info.serverVersion).toBe('1.4.2')
    await expect(host.listModels()).resolves.toEqual([])
  })
  it('keeps the old model result when no effort reader is installed', async () => {
    const { host, server } = setup()
    server.handle('model/list', () => ({ models: [{ ...model, opaque: 'unconsumed' }] }))
    expect(await host.listModels()).toEqual([
      { ...model, contextLimit: undefined, isActive: false },
    ])
  })

  it('carries the effort reader’s complete ordered variants, descriptions and default', async () => {
    const info = {
      variants: ['none', 'high', 'ultra'],
      defaultReasoningEffort: 'high',
      reasoningEffortVariants: [{ tier: 'ultra', description: 'Deepest reasoning' }],
    }
    const parseModel = vi.fn(() => info)
    const { host, server } = setup({ modelEfforts: { parseModel } })
    server.handle('model/list', () => ({ models: [{ ...model, opaque: 'reader input' }] }))
    expect(await host.listModels()).toEqual([
      { ...model, contextLimit: undefined, isActive: false, ...info },
    ])
    expect(parseModel).toHaveBeenCalledExactlyOnceWith({ ...model, opaque: 'reader input' })
  })

  it('refuses feedback before sending when the captured reader or grant is absent', async () => {
    const parseOutcome = vi.fn(() => 'uploaded')
    for (const { host, server } of [
      setup({}, ['feedback']),
      setup({ feedback: { parseOutcome } }),
    ]) {
      await expect(host.submitFeedback(report)).rejects.toThrow(UI_TEXT.feedbackFailed)
      expect(server.requestsFor('feedback/submit')).toHaveLength(0)
    }
    expect(parseOutcome).not.toHaveBeenCalled()
  })

  it('sends feedback once without command replay or artifacts and returns the reader’s exact outcome', async () => {
    const parseOutcome = vi.fn(() => 'futureOutcome')
    const { host, server } = setup({ feedback: { parseOutcome } }, ['feedback'])
    server.handle('feedback/submit', () => ({ opaque: 'reader input' }))
    await expect(host.submitFeedback(report)).resolves.toBe('futureOutcome')
    expect(server.requestsFor('feedback/submit')).toHaveLength(1)
    expect(server.requestsFor('feedback/submit')[0]?.params).toEqual(report)
    expect(parseOutcome).toHaveBeenCalledExactlyOnceWith({ opaque: 'reader input' })
  })

  it('previews registered secrets and M84 patterns and dispatches exactly the approved note', async () => {
    const literal = 'feedback-host-literal'
    const { host, server } = setup(
      {
        feedback: {
          parseOutcome: () => 'uploaded',
          secretLiterals: () => [literal],
        },
      },
      ['feedback'],
    )
    server.handle('feedback/submit', () => ({ opaque: 'receipt' }))
    const raw = `${literal} / ghp_${'x'.repeat(36)}`
    await expect(host.submitFeedback({ ...report, note: raw })).rejects.toThrow(
      UI_TEXT.feedbackFailed,
    )
    expect(server.requestsFor('feedback/submit')).toHaveLength(0)
    const note = host.previewFeedbackNote(raw)
    expect(note).toBe(`${REDACTED_MARK} / ${REDACTED_MARK}`)
    await host.submitFeedback({ ...report, note })
    expect(server.requestsFor('feedback/submit')[0]?.params?.['note']).toBe(note)
  })

  it('refuses a preview that became secret after approval instead of silently changing the payload', async () => {
    const literals: string[] = []
    const { host, server } = setup(
      {
        feedback: {
          parseOutcome: () => 'uploaded',
          secretLiterals: () => literals,
        },
      },
      ['feedback'],
    )
    const note = host.previewFeedbackNote('later-registered-feedback-literal')
    literals.push(note)
    await expect(host.submitFeedback({ ...report, note })).rejects.toThrow(UI_TEXT.feedbackFailed)
    expect(server.requestsFor('feedback/submit')).toHaveLength(0)
  })

  it('refuses a literal registered during the async submission gap and accepts only its refreshed preview', async () => {
    const literals: string[] = []
    const parseOutcome = vi.fn(() => 'uploaded')
    const { host, server } = setup({ feedback: { parseOutcome, secretLiterals: () => literals } }, [
      'feedback',
    ])
    server.handle('feedback/submit', () => ({ opaque: 'receipt' }))
    const note = host.previewFeedbackNote('async-gap-feedback-literal')
    const submission = host.submitFeedback({ ...report, note })
    expect(server.requestsFor('feedback/submit')).toHaveLength(0)
    literals.push(note)
    await expect(submission).rejects.toThrow(UI_TEXT.feedbackFailed)
    expect(server.requestsFor('feedback/submit')).toHaveLength(0)
    expect(parseOutcome).not.toHaveBeenCalled()

    const refreshed = host.previewFeedbackNote(note)
    expect(refreshed).toBe(REDACTED_MARK)
    await expect(host.submitFeedback({ ...report, note: refreshed })).resolves.toBe('uploaded')
    expect(server.requestsFor('feedback/submit')).toHaveLength(1)
    expect(server.requestsFor('feedback/submit')[0]?.params).toEqual({
      ...report,
      note: refreshed,
    })
  })

  it('dispatches the SDK feedback request in the same tick as the current literal scrub', async () => {
    let isScrubbedInThisTick = false
    let wasScrubbedAtDispatch = false
    const { host, server, processHost } = setup(
      {
        feedback: {
          parseOutcome: () => 'uploaded',
          secretLiterals: () => {
            isScrubbedInThisTick = true
            queueMicrotask(() => {
              isScrubbedInThisTick = false
            })
            return []
          },
        },
      },
      ['feedback'],
    )
    // Connection serializes the request synchronously, then queues transport
    // writes. Observe SDK dispatch while still using the real connection.
    const request = processHost.connection.request.bind(processHost.connection)
    vi.spyOn(processHost.connection, 'request').mockImplementation((method, params) => {
      if (method === 'feedback/submit') wasScrubbedAtDispatch = isScrubbedInThisTick
      return request(method, params)
    })
    server.handle('feedback/submit', () => ({ opaque: 'receipt' }))
    await expect(host.submitFeedback(report)).resolves.toBe('uploaded')
    expect(wasScrubbedAtDispatch).toBe(true)
    expect(server.requestsFor('feedback/submit')[0]?.params).toEqual(report)
  })

  it('propagates a rejected receipt without retrying or logging its content', async () => {
    const parseOutcome = vi.fn((): string => {
      throw new Error('reader refusal')
    })
    const { host, server, log } = setup({ feedback: { parseOutcome } }, ['feedback'])
    server.handle('feedback/submit', () => ({ opaque: 'reader input' }))
    await expect(host.submitFeedback(report)).rejects.toThrow('reader refusal')
    expect(server.requestsFor('feedback/submit')).toHaveLength(1)
    expect(log.error).not.toHaveBeenCalled()
  })

  it('routes a parsed started record into the existing History stream', async () => {
    const { reader, events } = lifecycle()
    const { host, server } = setup({ lifecycle: reader })
    const list = vi.fn()
    host.onSessionListEvent(list)
    events.push({ type: 'started', record })
    server.notify('session/started', {})
    await settle()
    expect(list).toHaveBeenCalledExactlyOnceWith({ type: 'changed', record })
  })

  it('keeps the existing closed and list-changed frames away from the new reader', async () => {
    const { reader } = lifecycle()
    const { host, server } = setup({ lifecycle: reader })
    const list = vi.fn()
    host.onSessionListEvent(list)
    server.notify('session/closed', { sessionId: 's', reason: 'idle' })
    server.notify('session/listChanged', { session: record })
    await settle()
    expect(reader.parseNotification).not.toHaveBeenCalled()
    expect(list).toHaveBeenCalledWith({ type: 'closed', sessionId: 's', reason: 'idle' })
    expect(list).toHaveBeenCalledWith({ type: 'changed', record })
  })

  it('arms deletion before admission and disposes the tracked session only on completed', async () => {
    const { host, reader } = await trackedDeletion()
    const terminal = await host.deleteSession('s')
    expect(terminal).toMatchObject({ outcome: 'completed', sessionId: 's' })
    expect(reader.parseDeleteAdmission).toHaveBeenCalledWith(
      { opaque: 'admission' },
      terminal.type === 'deleteCompleted' ? terminal.commandId : '',
    )
    expect(host.sessionCount).toBe(0)
  })

  it('isolates a throwing public observer from private deletion completion and session disposal', async () => {
    const { host, log } = await trackedDeletion()
    host.onMuseCodeLifecycleEvent(() => {
      throw new Error('disposed surface / private-observer-detail')
    })
    const after = vi.fn(() => host.sessionCount)
    host.onMuseCodeLifecycleEvent(after)
    const publicSubscribe = vi.spyOn(host, 'onMuseCodeLifecycleEvent')
    await expect(host.deleteSession('s')).resolves.toMatchObject({ outcome: 'completed' })
    expect(publicSubscribe).not.toHaveBeenCalled()
    expect(host.sessionCount).toBe(0)
    expect(after).toHaveBeenCalledTimes(1)
    expect(after.mock.results[0]?.value).toBe(0)
    expect(log.error).toHaveBeenCalledExactlyOnceWith('MSP observer failed')
  })

  it('isolates throwing History observers and continues delivering started lifecycle events', async () => {
    const { reader, events } = lifecycle()
    const { host, server, log } = setup({ lifecycle: reader })
    host.onSessionListEvent(() => {
      throw new Error('disposed history')
    })
    const list = vi.fn()
    const visible = vi.fn()
    host.onSessionListEvent(list)
    host.onMuseCodeLifecycleEvent(visible)
    events.push({ type: 'started', record })
    server.notify('session/started', {})
    await settle()
    expect(list).toHaveBeenCalledExactlyOnceWith({ type: 'changed', record })
    expect(visible).toHaveBeenCalledExactlyOnceWith({ type: 'started', record })
    expect(log.error).toHaveBeenCalledExactlyOnceWith('MSP observer failed')
  })

  it.each([
    ['completed', 'connection close'],
    ['completed', 'host exit'],
    ['completed', 'host close'],
    ['failed', 'connection close'],
    ['failed', 'host exit'],
    ['failed', 'host close'],
  ] as const)('preserves a validated %s deletion terminal racing %s', async (outcome, ending) => {
    const fixture = await trackedDeletion({ outcome, reason: 'terminal evidence' })
    const { host, server, events, reader } = fixture
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const history = new Set([record.sessionId])
    let closing: Promise<void> | undefined
    const visible = vi.fn((event: MuseCodeLifecycleEvent) => {
      if (event.type !== 'deleteCompleted') return
      if (event.outcome === 'completed') history.delete(event.sessionId)
      if (ending === 'host exit') fixture.exit(1)
      else if (ending === 'host close') closing = host.close()
    })
    host.onMuseCodeLifecycleEvent(visible)
    server.followWith('session/delete', (params) => {
      events.push(deletion(String(params['commandId']), { outcome, reason: 'terminal evidence' }))
      // End the actual SDK transport with admission and terminal in its final read.
      if (ending === 'connection close') server.close()
      return [{ jsonrpc: '2.0', method: 'session/deleteCompleted', params: {} }]
    })
    await expect(host.deleteSession('s')).resolves.toMatchObject({
      outcome,
      reason: 'terminal evidence',
    })
    await closing
    await settle()
    expect(reader.parseDeleteAdmission).toHaveBeenCalledOnce()
    expect(visible).toHaveBeenCalledOnce()
    expect(history.has('s')).toBe(outcome === 'failed')
    expect(host.sessionCount).toBe(outcome === 'failed' && ending !== 'host close' ? 1 : 0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the first validated deletion terminal when a later terminal disagrees', async () => {
    const { host, server, events } = await trackedDeletion()
    let closing: Promise<void> | undefined
    host.onMuseCodeLifecycleEvent((event) => {
      if (event.type === 'deleteCompleted' && event.outcome === 'failed') closing = host.close()
    })
    server.followWith('session/delete', (params) => {
      const commandId = String(params['commandId'])
      events.push(deletion(commandId), deletion(commandId, { outcome: 'failed' }))
      return [
        { jsonrpc: '2.0', method: 'session/deleteCompleted', params: {} },
        { jsonrpc: '2.0', method: 'session/deleteCompleted', params: {} },
      ]
    })
    await expect(host.deleteSession('s')).resolves.toMatchObject({ outcome: 'completed' })
    await closing
    expect(host.sessionCount).toBe(0)
  })

  it.each(['connection close', 'host exit', 'host close'] as const)(
    'rejects admitted deletion promptly on %s without reporting the session deleted',
    async (ending) => {
      const fixture = await trackedDeletion()
      const { host, server, reader } = fixture
      server.followWith('session/delete', () => [])
      const visible = vi.fn()
      host.onMuseCodeLifecycleEvent(visible)
      const history = new Set([record.sessionId])
      host.onMuseCodeLifecycleEvent((event) => {
        if (event.type === 'deleteCompleted' && event.outcome === 'completed') {
          history.delete(event.sessionId)
        }
      })
      const { rejected, waiting } = await admittedDeletion(host, reader)
      let message = UI_TEXT.sessionDeleteConnectionClosed
      if (ending === 'connection close') {
        server.close()
      } else if (ending === 'host exit') {
        message = UI_TEXT.sessionDeleteHostExited
        host.onExit(() => {
          throw new Error('disposed exit observer')
        })
        fixture.exit(1)
      } else {
        message = UI_TEXT.sessionDeleteHostClosed
        await host.close()
      }
      await settle()
      // No timers advanced: shutdown must beat the terminal deadline.
      expect(rejected).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message }))
      await waiting
      expect(vi.getTimerCount()).toBe(0)
      expect(visible).not.toHaveBeenCalled()
      expect(history.has('s')).toBe(true)
      // Explicit host shutdown releases all handles; that is not stored deletion.
      expect(host.sessionCount).toBe(ending === 'host close' ? 0 : 1)
      const requests = server.requestsFor('session/delete').length
      await expect(host.deleteSession('s')).rejects.toThrow(message)
      expect(server.requestsFor('session/delete')).toHaveLength(requests)
    },
  )

  it('uses the named deletion terminal timeout, cleans up and leaves the session in History', async () => {
    const { reader } = lifecycle()
    const fixture = fakeMspHost()
    const host = new MuseCodeHost(
      fixture.host,
      new FakeLogOutputChannel(),
      {
        normalMs: 100,
        longMs: 100,
        deleteTerminalMs: 2,
      },
      { lifecycle: reader },
    )
    fixture.server.handle('session/start', () => ({
      session: { sessionId: 's', modelId: model.modelId },
      viewCursor: '',
    }))
    await host.startSession(options)
    fixture.server.handle('session/delete', () => ({ opaque: 'admission' }))
    const visible = vi.fn()
    host.onMuseCodeLifecycleEvent(visible)
    const adding = vi.spyOn(AbortSignal.prototype, 'addEventListener')
    const removing = vi.spyOn(AbortSignal.prototype, 'removeEventListener')
    const { rejected, waiting } = await admittedDeletion(host, reader)
    await vi.advanceTimersByTimeAsync(2)
    await waiting
    expect(rejected).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: 'DeadlineError',
        message: UI_TEXT.sessionDeleteTimedOut,
      }),
    )
    expect(vi.getTimerCount()).toBe(0)
    expect(host.sessionCount).toBe(1)
    expect(visible).not.toHaveBeenCalled()
    const abortListener = adding.mock.calls.find(([name]) => name === 'abort')?.[1]
    expect(abortListener).toEqual(expect.any(Function))
    expect(removing).toHaveBeenCalledExactlyOnceWith('abort', abortListener)
    await host.close()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects deletion as soon as host close starts even while process cleanup is pending', async () => {
    const fixture = await trackedDeletion()
    fixture.server.followWith('session/delete', () => [])
    const cleanup = Promise.withResolvers<undefined>()
    const closeProcess = fixture.processHost.close
    fixture.processHost.close = async () => {
      await cleanup.promise
      return await closeProcess()
    }
    const { rejected, waiting } = await admittedDeletion(fixture.host, fixture.reader)
    const closing = fixture.host.close()
    await settle()
    expect(rejected).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: UI_TEXT.sessionDeleteHostClosed,
      }),
    )
    await waiting
    expect(vi.getTimerCount()).toBe(0)
    expect(fixture.host.sessionCount).toBe(1)
    cleanup.resolve(undefined)
    await closing
    expect(fixture.host.sessionCount).toBe(0)
  })

  it('matches both session and command, keeps unknown outcomes visible, and waits for a known terminal', async () => {
    const { reader, events } = lifecycle()
    const { host, server } = setup({ lifecycle: reader })
    const visible = vi.fn()
    host.onMuseCodeLifecycleEvent(visible)
    server.handle('session/delete', (params) => {
      const commandId = String(params['commandId'])
      events.push(
        deletion(commandId, { sessionId: 'different' }),
        deletion('different'),
        deletion(commandId, { outcome: 'futureOutcome' }),
      )
      return { opaque: 'admission' }
    })
    const done = vi.fn()
    const waiting = (async () => {
      const value = await host.deleteSession('s')
      done(value)
      return value
    })()
    await settle()
    for (let index = 0; index < 3; index += 1) server.notify('session/deleteCompleted', {})
    await settle()
    expect(done).not.toHaveBeenCalled()
    expect(visible).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'futureOutcome' }))
    const commandId = String(server.requestsFor('session/delete')[0]?.params?.['commandId'])
    events.push(
      deletion(commandId, {
        outcome: 'failed',
        reason: 'futureReason',
        physicalChange: 'futureEvidence',
      }),
    )
    server.notify('session/deleteCompleted', {})
    await expect(waiting).resolves.toMatchObject({
      outcome: 'failed',
      reason: 'futureReason',
      physicalChange: 'futureEvidence',
    })
  })

  it('refuses deletion before dispatch without a captured lifecycle reader', async () => {
    const { host, server } = setup()
    await expect(host.deleteSession('s')).rejects.toMatchObject({
      message: UI_TEXT.memoryDeleteAction,
    })
    expect(server.requestsFor('session/delete')).toHaveLength(0)
  })

  it('keeps a tracked session after a failed deletion', async () => {
    const { host } = await trackedDeletion({
      outcome: 'failed',
      reason: 'writerBusy',
      physicalChange: 'none',
    })
    await expect(host.deleteSession('s')).resolves.toMatchObject({ outcome: 'failed' })
    expect(host.sessionCount).toBe(1)
  })
})
