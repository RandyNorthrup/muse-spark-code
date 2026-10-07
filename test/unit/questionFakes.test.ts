import { describe, expect, it, vi } from 'vitest'
import { SteerRefusedError } from '../../src/core/agent/agentBackend'
import type { QuestionKey, QuestionRegistryPort } from '../../src/shared/questions'
import { FakeQuestionAcpClient } from './helpers/questions/acpClient'
import { FakeQuestionClock } from './helpers/questions/clock'
import { questionFixture } from './helpers/questions/fixtures'
import { ScriptedQuestionSession } from './helpers/questions/session'
import { FakeQuestionStore } from './helpers/questions/store'

const key: QuestionKey = (questions) => questions.map((question) => question.question).join('|')

const form = {
  mode: 'form',
  sessionId: 'session-1',
  message: 'Which colour?',
  requestedSchema: {
    type: 'object',
    properties: { colour: { type: 'string', enum: ['Blue', 'Green'] } },
  },
} satisfies Parameters<FakeQuestionAcpClient['createElicitation']>[0]

describe('M112 dependency fakes', () => {
  it('fires at sixty seconds, in order, including a timer scheduled by a callback', () => {
    const clock = new FakeQuestionClock()
    const deadlines: number[] = []
    clock.setTimer(60_000, () => {
      deadlines.push(clock.now())
      clock.setTimer(1000, () => {
        deadlines.push(clock.now())
      })
    })
    clock.setTimer(60_000, () => {
      deadlines.push(clock.now())
    })
    clock.advance(59_999)
    expect(deadlines).toEqual([])
    clock.advance(1)
    expect(deadlines).toEqual([61_000, 61_000])
    clock.advance(1000)
    expect(deadlines).toEqual([61_000, 61_000, 62_000])
    expect(clock.pendingTimers).toBe(0)
  })

  it('cancels a timer idempotently and lets tests plant a stopped clock', () => {
    const clock = new FakeQuestionClock()
    const callback = vi.fn()
    const cancel = clock.setTimer(1000, callback)
    cancel()
    cancel()
    clock.advance(1000)
    expect(callback).not.toHaveBeenCalled()
    expect(clock.pendingTimers).toBe(0)
    clock.firesTimers = false
    clock.setTimer(1000, callback)
    clock.advance(1000)
    expect(callback).not.toHaveBeenCalled()
    expect(clock.pendingTimers).toBe(1)
    expect(() => {
      clock.advance(-1)
    }).toThrow('backwards')
    expect(() => clock.setTimer(NaN, callback)).toThrow('delay')
  })

  it('records a running steer, a refused steer and an idle send without deciding fallback itself', async () => {
    const session = new ScriptedQuestionSession('session-1', 'model-1')
    const parts = [{ type: 'text', text: 'Answer to your earlier question q-1' }] as const
    expect(await session.steer('running-1', parts)).toEqual({
      turnId: 'running-1',
      disposition: 'steered',
    })
    session.queueSteer(new SteerRefusedError('no running turn'))
    await expect(session.steer('running-1', parts)).rejects.toMatchObject({
      name: 'SteerRefusedError',
    })
    expect(session.sendTurn).not.toHaveBeenCalled()
    session.queueTurn({ turnId: 'new-1', disposition: 'started' })
    expect(await session.sendTurn(parts, 'A late answer')).toEqual({
      turnId: 'new-1',
      disposition: 'started',
    })
    expect(session.sendTurn).toHaveBeenCalledExactlyOnceWith(parts, 'A late answer')
    session.queueTurn(new Error('uncertain acknowledgement'))
    await expect(session.sendTurn(parts)).rejects.toThrow('uncertain')
  })

  it('holds deferral until settlement and records no approval or cancellation', async () => {
    const session = new ScriptedQuestionSession('session-1', 'model-1')
    const settlement = Promise.withResolvers<undefined>()
    session.holdDeferral(settlement.promise)
    const settled = vi.fn()
    const deferral = (async () => {
      await session.deferQuestions('q-1')
      settled()
    })()
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    settlement.resolve(undefined)
    await deferral
    expect(settled).toHaveBeenCalledOnce()
    expect(session.deferQuestions).toHaveBeenCalledExactlyOnceWith('q-1')
    expect(session.cancelQuestions).not.toHaveBeenCalled()
    expect(session.decideApproval).not.toHaveBeenCalled()
  })

  it('reloads isolated per-session copies and removes only the deleted session', async () => {
    const store = new FakeQuestionStore()
    const first = questionFixture()
    await store.save('session-1', [first])
    first.questions[0]!.question = 'MUTATED AFTER SAVE'
    const reloaded = await store.load('session-1')
    expect(reloaded[0]?.questions[0]?.question).toBe('Which colour?')
    reloaded[0]!.questions[0]!.question = 'MUTATED AFTER LOAD'
    const reread = await store.load('session-1')
    expect(reread[0]?.questions[0]?.question).toBe('Which colour?')
    await store.save('session-2', [questionFixture({ sessionId: 'session-2' })])
    await store.remove('session-1')
    expect(await store.load('session-1')).toEqual([])
    expect(await store.load('session-2')).toHaveLength(1)
  })

  it('refuses corrupt and cross-session storage, and exposes a failed save', async () => {
    const store = new FakeQuestionStore()
    store.files.set('session-1', {
      version: 1,
      snapshot: { sessionId: 'session-2', questions: [] },
    })
    await expect(store.load('session-1')).rejects.toThrow('invalid')
    store.files.set('session-1', 'corrupt')
    await expect(store.load('session-1')).rejects.toThrow('invalid')
    await expect(
      store.save('session-1', [questionFixture({ sessionId: 'other' })]),
    ).rejects.toThrow('invalid')
    store.failNextSave = true
    await expect(store.save('session-1', [questionFixture()])).rejects.toThrow('write failed')
    await store.save('session-1', [questionFixture()])
    expect(await store.load('session-1')).toHaveLength(1)
  })

  it('records cancel_request cooperatively and accepts the late form response', async () => {
    const client = new FakeQuestionAcpClient(true)
    const cancellation = new AbortController()
    const response = client.createElicitation(form, { cancellationSignal: cancellation.signal })
    cancellation.abort()
    expect(client.cancellations).toEqual([{ method: '$/cancel_request', id: 1 }])
    client.answer(1, { action: 'accept', content: { colour: 'Blue' } })
    expect(await response).toEqual({ action: 'accept', content: { colour: 'Blue' } })
    expect(client.requests).toEqual([form])
    cancellation.abort()
    expect(client.cancellations).toHaveLength(1)
    expect(() => {
      client.answer(1, { action: 'decline' })
    }).toThrow('not pending')
  })

  it('supports clients without cancellation or forms and already-aborted requests', async () => {
    const old = new FakeQuestionAcpClient(true, false)
    const cancellation = new AbortController()
    cancellation.abort()
    const response = old.createElicitation(form, { cancellationSignal: cancellation.signal })
    expect(old.cancellations).toEqual([])
    old.answer(1, { action: 'decline' })
    expect(await response).toEqual({ action: 'decline' })
    const cancelled = new FakeQuestionAcpClient(true)
    const withdrawn = cancelled.createElicitation(form, { cancellationSignal: cancellation.signal })
    expect(cancelled.cancellations).toHaveLength(1)
    cancelled.answer(1, { action: 'cancel' })
    await withdrawn
    const noForms = new FakeQuestionAcpClient(false)
    await expect(noForms.createElicitation(form)).rejects.toThrow('no forms')
    expect(noForms.requests).toEqual([])
  })

  it('accepts the fakes as injected registry ports, with an explicit delivery result', async () => {
    const clock = new FakeQuestionClock()
    const session = new ScriptedQuestionSession('session-1', 'model-1')
    expect(key(questionFixture().questions)).toBe('Which colour?')
    const port: QuestionRegistryPort = {
      store: new FakeQuestionStore(),
      now: () => clock.now(),
      setTimer: (delay, callback) => clock.setTimer(delay, callback),
      deferQuestions: session.deferQuestions,
      deliver: vi.fn<QuestionRegistryPort['deliver']>(() => Promise.resolve('notTaken')),
    }
    expect(
      await port.deliver({
        sessionId: 'session-1',
        userInputId: 'q-1',
        text: 'late answer',
        displayText: undefined,
      }),
    ).toBe('notTaken')
    await port.deferQuestions('q-1')
    expect(session.deferQuestions).toHaveBeenCalledOnce()
  })
})
