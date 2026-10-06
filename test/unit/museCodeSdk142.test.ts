import { describe, expect, it, vi } from 'vitest'
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
  return { ...fixture, log, host }
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
  return { ...fixture, reader }
}

describe('Muse Code 1.4.2 feature ports', () => {
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
