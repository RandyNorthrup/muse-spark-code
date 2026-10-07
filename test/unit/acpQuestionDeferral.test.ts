import path from 'node:path'
import * as acp from '@agentclientprotocol/sdk'
import { describe, expect, it, vi } from 'vitest'
import { createAcpAgent } from '../../src/acp/agent'
import { AcpPaidUse } from '../../src/acp/paid'
import { AcpQuestionDeferral } from '../../src/acp/questionDeferral'
import * as questionFactories from '../../src/acp/questionDeferralEntry'
import { questionDeferSeconds } from '../../src/shared/questionDeadline'
import { questionCommand, questionForm } from '../../src/acp/questions'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { SteerRefusedError, type TurnSubmission } from '../../src/core/agent/agentBackend'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { FakeAgentHost, museCodeTestBackend } from './helpers/fakeAgent'
import { memoryPaidGrants } from './helpers/paidGrants'
import { until } from './helpers/acpWaits'
import { FakeQuestionAcpClient } from './helpers/questions/acpClient'
import { acpQuestionEvent, FakeAcpQuestionRegistry } from './helpers/questions/acpRegistry'
import { FakeQuestionClock } from './helpers/questions/clock'
import { expectedQuestionCommandsUpdate } from './helpers/questions/fixtures'
import { ScriptedQuestionSession } from './helpers/questions/session'

const SECOND = 1000
const DEFAULT_SECONDS = 60
const CWD = path.resolve('test/fixtures/workspace')

function fixture(seconds = DEFAULT_SECONDS, hasForms = true, canCancel = true) {
  const clock = new FakeQuestionClock()
  const session = new ScriptedQuestionSession('session-1', 'test-model')
  const delivery = vi.fn(() => Promise.resolve('taken' as const))
  const registry = new FakeAcpQuestionRegistry({ session, deliver: delivery })
  const client = new FakeQuestionAcpClient(hasForms, canCancel)
  const notice = vi.fn()
  const failed = vi.fn()
  const controller = new AcpQuestionDeferral({ clock, session, registry, seconds, notice, failed })
  const event = acpQuestionEvent()
  const ask = () =>
    controller.ask(
      event,
      hasForms
        ? (signal) =>
            client.createElicitation(
              {
                sessionId: session.sessionId,
                mode: 'form',
                message: 'question',
                requestedSchema: questionForm(event.questions),
              },
              { cancellationSignal: signal },
            )
        : undefined,
      'turn-1',
    )
  return { clock, session, registry, client, notice, failed, controller, event, ask, delivery }
}

async function waitingForm(f: ReturnType<typeof fixture>) {
  const asking = f.ask()
  await until(() => f.client.requests.length === 1)
  return { asking }
}

async function deferredForm(f: ReturnType<typeof fixture>) {
  const { asking } = await waitingForm(f)
  f.clock.advance(10 * SECOND)
  await until(() => f.client.cancellations.length === 1)
  return { asking }
}

describe('M112 ACP form deferral', () => {
  it('defers at 60 seconds, withdraws the form, and delivers a late form answer once', async () => {
    const f = fixture()
    const { asking } = await waitingForm(f)
    f.clock.advance(DEFAULT_SECONDS * SECOND - 1)
    expect(f.session.deferQuestions).not.toHaveBeenCalled()
    f.clock.advance(1)
    await until(() => f.client.cancellations.length === 1)
    expect(f.session.deferQuestions).toHaveBeenCalledExactlyOnceWith('q-1')
    expect(f.client.cancellations).toEqual([{ method: '$/cancel_request', id: 1 }])
    expect(f.notice).toHaveBeenCalledExactlyOnceWith(
      fill(UI_TEXT.acpQuestionDeferred, { number: '1' }),
    )
    f.client.answer(1, { action: 'accept', content: { colour: 'Blue' } })
    await asking
    expect(f.delivery).toHaveBeenCalledTimes(1)
    expect(f.delivery.mock.calls[0]).toEqual([
      expect.objectContaining({
        text: expect.stringContaining('Answers:\n[{"questionId":"colour","selectedLabel":"Blue"}]'),
      }),
    ])
    expect(f.session.answerQuestions).not.toHaveBeenCalled()
    await f.controller.answer(1, 'Green')
    expect(f.delivery).toHaveBeenCalledTimes(1)
    expect(f.clock.pendingTimers).toBe(0)
  })

  it('an early form answer settles normally and cancels the deadline', async () => {
    const f = fixture()
    const { asking } = await waitingForm(f)
    f.client.answer(1, { action: 'accept', content: { colour: 'Green' } })
    await asking
    f.clock.advance(DEFAULT_SECONDS * SECOND)
    expect(f.session.answerQuestions).toHaveBeenCalledExactlyOnceWith('q-1', [
      { questionId: 'colour', selectedLabel: 'Green' },
    ])
    expect(f.session.deferQuestions).not.toHaveBeenCalled()
    expect(f.delivery).not.toHaveBeenCalled()
    expect(f.clock.pendingTimers).toBe(0)
  })

  it.each([0, DEFAULT_SECONDS])(
    'no forms defer immediately with setting %s, with no timer',
    async (seconds) => {
      const f = fixture(seconds, false)
      await f.ask()
      expect(f.session.deferQuestions).toHaveBeenCalledExactlyOnceWith('q-1')
      expect(f.session.cancelQuestions).not.toHaveBeenCalled()
      expect(f.clock.pendingTimers).toBe(0)
      expect(f.controller.list()).toContain('Question 1: Colour')
      expect(await f.controller.answer(1, 'Use Blue')).toBe(UI_TEXT.announceLateAnswerSent)
      expect(f.delivery).toHaveBeenCalledTimes(1)
    },
  )

  it('zero never defers an interactive form', async () => {
    const f = fixture(0)
    const { asking } = await waitingForm(f)
    f.clock.advance(3600 * SECOND)
    expect(f.clock.pendingTimers).toBe(0)
    expect(f.session.deferQuestions).not.toHaveBeenCalled()
    f.client.answer(1, { action: 'decline' })
    await asking
    expect(f.session.cancelQuestions).toHaveBeenCalledExactlyOnceWith('q-1')
  })

  it('five seconds is read as ten', async () => {
    const f = fixture(5)
    const { asking } = await waitingForm(f)
    f.clock.advance(9999)
    expect(f.session.deferQuestions).not.toHaveBeenCalled()
    f.clock.advance(1)
    await until(() => f.session.deferQuestions.mock.calls.length === 1)
    f.client.answer(1, { action: 'cancel' })
    await asking
    expect(f.registry.list()[0]?.state).toBe('open')
  })

  it('a noncooperative client can answer after withdrawal without a cancellation frame', async () => {
    const f = fixture(10, true, false)
    const { asking } = await waitingForm(f)
    f.clock.advance(10 * SECOND)
    await until(() => f.registry.list()[0]?.state === 'open')
    expect(f.client.cancellations).toEqual([])
    f.client.answer(1, { action: 'accept', content: { colour: 'Blue' } })
    await asking
    expect(f.delivery).toHaveBeenCalledTimes(1)
  })

  it('form rejection on withdrawal preserves the open question', async () => {
    const f = fixture(10)
    const asking = f.controller.ask(
      f.event,
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(new Error('withdrawn'))
            },
            { once: true },
          )
        }),
    )
    await until(() => f.clock.pendingTimers === 1)
    f.clock.advance(10 * SECOND)
    await asking
    expect(f.registry.list()[0]?.state).toBe('open')
    expect(f.session.cancelQuestions).not.toHaveBeenCalled()
    expect(f.failed).not.toHaveBeenCalled()
    await f.controller.answer(1, 'Blue')
    expect(f.delivery).toHaveBeenCalledTimes(1)
  })

  it.each([
    { action: 'accept', content: { colour: 'bogus' } },
    { action: 'decline' },
    { action: 'cancel' },
  ])('an invalid or declined late form never removes the open question: %j', async (response) => {
    const f = fixture(10)
    const { asking } = await deferredForm(f)
    f.client.answer(1, response)
    await asking
    expect(f.registry.list()[0]?.state).toBe('open')
    expect(f.session.cancelQuestions).not.toHaveBeenCalled()
    expect(f.delivery).not.toHaveBeenCalled()
  })

  it('a deadline waits for registration and applies arrival time rather than disk completion', async () => {
    const f = fixture(10)
    const original = f.registry.register.getMockImplementation()!
    const gate = Promise.withResolvers<undefined>()
    f.registry.register.mockImplementationOnce(async (...args) => {
      await gate.promise
      return await original(...args)
    })
    const asking = f.ask()
    f.clock.advance(10 * SECOND)
    expect(f.registry.defer).not.toHaveBeenCalled()
    gate.resolve(undefined)
    await until(() => f.clock.pendingTimers === 1)
    f.clock.advance(0)
    await until(() => f.client.cancellations.length === 1)
    f.client.answer(1, { action: 'decline' })
    await asking
    expect(f.session.deferQuestions).toHaveBeenCalledTimes(1)
  })

  it('Stop withdraws a waiting form and prevents its late answer and deadline', async () => {
    const f = fixture(10)
    const { asking } = await waitingForm(f)
    await f.controller.turnEnded(true)
    f.clock.advance(10 * SECOND)
    f.client.answer(1, { action: 'accept', content: { colour: 'Blue' } })
    await asking
    expect(f.registry.list()[0]?.state).toBe('cancelled')
    expect(f.session.deferQuestions).not.toHaveBeenCalled()
    expect(f.session.answerQuestions).not.toHaveBeenCalled()
    expect(f.delivery).not.toHaveBeenCalled()
  })

  it('an interrupted waiting question remains open and a late form reaches the delivery port', async () => {
    const f = fixture(10)
    const { asking } = await waitingForm(f)
    await f.controller.turnEnded(false)
    f.client.answer(1, { action: 'accept', content: { colour: 'Blue' } })
    await asking
    expect(f.delivery).toHaveBeenCalledTimes(1)
    expect(f.session.answerQuestions).not.toHaveBeenCalled()
    expect(f.clock.pendingTimers).toBe(0)
  })

  it('release ignores a late form and removes every clock', async () => {
    const f = fixture(10)
    const { asking } = await waitingForm(f)
    f.controller.dispose()
    f.clock.advance(10 * SECOND)
    f.client.answer(1, { action: 'accept', content: { colour: 'Blue' } })
    await asking
    expect(f.registry.dispose).toHaveBeenCalledTimes(1)
    expect(f.delivery).not.toHaveBeenCalled()
    expect(f.session.deferQuestions).not.toHaveBeenCalled()
    expect(f.failed).not.toHaveBeenCalled()
  })

  it('an interruption waits for registry opening before consuming a late form answer', async () => {
    const f = fixture(10)
    const { asking } = await waitingForm(f)
    const gate = Promise.withResolvers<undefined>()
    const original = f.registry.turnEnded.getMockImplementation()!
    f.registry.turnEnded.mockImplementationOnce(async (isCancelled) => {
      await gate.promise
      await original(isCancelled)
    })
    const ending = f.controller.turnEnded(false)
    f.client.answer(1, { action: 'accept', content: { colour: 'Blue' } })
    await new Promise((resolve) => setImmediate(resolve))
    expect(f.delivery).not.toHaveBeenCalled()
    gate.resolve(undefined)
    await ending
    await asking
    expect(f.delivery).toHaveBeenCalledTimes(1)
    expect(f.session.answerQuestions).not.toHaveBeenCalled()
  })

  it('an uncertain registry answer produces no retry advice', async () => {
    const f = fixture(0, false)
    await f.ask()
    f.registry.answer.mockRejectedValueOnce(new Error('PRIVATE-QUESTION-CANARY'))
    expect(await f.controller.answer(1, 'Blue')).toBe(UI_TEXT.questionAnswerUncertain)
    expect(f.failed.mock.calls).toEqual([[]])
  })

  it('a failed deferral never announces an open question or admits a late form', async () => {
    const f = fixture(10)
    f.registry.defer.mockRejectedValueOnce(new Error('PRIVATE-QUESTION-CANARY'))
    const { asking } = await waitingForm(f)
    f.clock.advance(10 * SECOND)
    await until(() => f.failed.mock.calls.length === 1)
    f.client.answer(1, { action: 'accept', content: { colour: 'Blue' } })
    await asking
    expect(f.notice).not.toHaveBeenCalled()
    expect(f.delivery).not.toHaveBeenCalled()
    expect(f.session.answerQuestions).not.toHaveBeenCalled()
    expect(f.failed.mock.calls).toEqual([[]])
    expect(f.session.cancelQuestions).toHaveBeenCalledExactlyOnceWith('q-1')
    expect(f.registry.replyWaiting).toHaveBeenCalledExactlyOnceWith('q-1', { kind: 'cancelled' })
    expect(f.registry.list()).toEqual([])
  })

  it('registration failure declines explicitly and starts no form or clock', async () => {
    const f = fixture()
    f.registry.register.mockRejectedValueOnce(new Error('disk unavailable'))
    await f.ask()
    expect(f.session.cancelQuestions).toHaveBeenCalledExactlyOnceWith('q-1')
    expect(f.client.requests).toEqual([])
    expect(f.clock.pendingTimers).toBe(0)
    expect(f.failed).toHaveBeenCalledTimes(1)
  })

  it('a failed deferral still cancels its tool when the registry reply write also fails', async () => {
    const f = fixture(10)
    f.registry.defer.mockRejectedValueOnce(new Error('PRIVATE-QUESTION-CANARY'))
    f.registry.replyWaiting.mockRejectedValueOnce(new Error('PRIVATE-QUESTION-CANARY'))
    const { asking } = await waitingForm(f)
    f.clock.advance(10 * SECOND)
    await until(() => f.session.cancelQuestions.mock.calls.length === 1)
    f.client.answer(1, { action: 'accept', content: { colour: 'Blue' } })
    await asking
    expect(f.session.cancelQuestions).toHaveBeenCalledExactlyOnceWith('q-1')
    expect(f.notice).not.toHaveBeenCalled()
    expect(f.delivery).not.toHaveBeenCalled()
    expect(f.clock.pendingTimers).toBe(0)
  })

  it('replay keeps its persisted arrival-time deadline', async () => {
    const f = fixture()
    const original = f.registry.register.getMockImplementation()!
    f.registry.register.mockImplementationOnce(async (...args) => {
      const record = await original(...args)
      return { ...record, deadlineAt: f.clock.now() + 10 * SECOND }
    })
    const { asking } = await deferredForm(f)
    f.client.answer(1, { action: 'decline' })
    await asking
    expect(f.session.deferQuestions).toHaveBeenCalledTimes(1)
  })

  it('settlement elsewhere withdraws the form and blocks its later reply', async () => {
    const f = fixture()
    const { asking } = await waitingForm(f)
    f.controller.settled('q-1', 'answered')
    f.client.answer(1, { action: 'accept', content: { colour: 'Blue' } })
    await asking
    f.clock.advance(DEFAULT_SECONDS * SECOND)
    expect(f.session.answerQuestions).not.toHaveBeenCalled()
    expect(f.session.deferQuestions).not.toHaveBeenCalled()
    expect(f.delivery).not.toHaveBeenCalled()
    expect(f.clock.pendingTimers).toBe(0)
  })

  it('expired numbers are never reused for a different question', async () => {
    const f = fixture(0, false)
    await f.ask()
    const original = f.registry.records.get('q-1')!
    f.registry.records.set('q-1', { ...original, state: 'expired' })
    await f.controller.ask(acpQuestionEvent('q-2'), undefined)
    expect(f.controller.list()).toContain('Question 2: Colour')
    expect(f.controller.list()).not.toContain('Question 1:')
    expect(await f.controller.answer(1, 'Blue')).toBe(
      fill(UI_TEXT.acpQuestionNotFound, { number: '1' }),
    )
    expect(f.delivery).not.toHaveBeenCalled()
    await f.controller.answer(2, 'Green')
    expect(f.delivery).toHaveBeenCalledTimes(1)
  })

  it.each(['accept', 'decline'] as const)(
    'coalesced requests show one form and settle through the shared registry: %s',
    async (action) => {
      const f = fixture(0)
      const first = f.ask()
      await until(() => f.client.requests.length === 1)
      const canonical = f.registry.records.get('q-1')!
      f.registry.register.mockResolvedValueOnce(canonical)
      f.registry.replyWaiting.mockImplementationOnce(async (_id, reply) => {
        for (const id of ['q-1', 'q-2']) {
          if (reply.kind === 'answered') await f.session.answerQuestions(id, reply.answers)
          else await f.session.cancelQuestions(id)
        }
      })
      const second = f.controller.ask(acpQuestionEvent('q-2'), (signal) =>
        f.client.createElicitation(
          {
            sessionId: f.session.sessionId,
            mode: 'form',
            message: 'question',
            requestedSchema: questionForm(f.event.questions),
          },
          { cancellationSignal: signal },
        ),
      )
      await until(() => f.registry.register.mock.calls.length === 2)
      expect(f.client.requests).toHaveLength(1)
      await second
      f.client.answer(1, action === 'accept' ? { action, content: { colour: 'Blue' } } : { action })
      await first
      expect(f.registry.replyWaiting).toHaveBeenCalledTimes(1)
      const settled = action === 'accept' ? f.session.answerQuestions : f.session.cancelQuestions
      expect(settled.mock.calls.map(([id]) => id)).toEqual(['q-1', 'q-2'])
      expect(f.delivery).not.toHaveBeenCalled()
      expect(f.clock.pendingTimers).toBe(0)
    },
  )
})

describe('M112 local commands and runtime option', () => {
  it.each([
    ['/questions', { kind: 'list' }],
    ['/answer 2 use green\nplease', { kind: 'answer', number: 2, text: 'use green\nplease' }],
    ['/answer', { kind: 'invalid' }],
    ['/answer 0 x', { kind: 'invalid' }],
    ['/answer 1', { kind: 'invalid' }],
    ['/answer 1e2 x', { kind: 'invalid' }],
    ['/questions extra', { kind: 'invalid' }],
    ['/answering x', undefined],
    ['hello', undefined],
  ])('parses %s without admitting mode or approval fields', (text, expected) => {
    expect(questionCommand(text)).toEqual(expected)
  })
  it.each([
    [undefined, 60],
    [0, 0],
    [5, 10],
    [10, 10],
    [3600, 3600],
    [-1, undefined],
    [3601, undefined],
    [1.5, undefined],
    [Infinity, undefined],
  ])('normalizes %s to %s', (input, expected) => {
    expect(questionDeferSeconds(input)).toBe(expected)
  })
  it.each([
    ['0', 0],
    ['5', 10],
    ['60', 60],
    ['3600', 3600],
  ])('accepts --questions-defer-after %s', (value, expected) => {
    expect(parseCommandLine(['--questions-defer-after', value])).toMatchObject({
      command: 'serve',
      options: { questionsDeferAfterSeconds: expected },
    })
  })
  it.each(['', '-1', '1.5', '3601', 'NaN', 'Infinity', '0x10', '1e2'])(
    'refuses invalid runtime deadline %j',
    (value) => {
      expect(parseCommandLine(['--questions-defer-after', value]).command).toBe('invalid')
    },
  )
  it('exec refuses the interactive option', () => {
    expect(parseCommandLine(['exec', '--questions-defer-after', '60', 'hi'])).toMatchObject({
      command: 'invalid',
      exitCode: 2,
    })
  })
})

function agentHarness(
  policy: 'interactive' | 'decline' = 'interactive',
  loading?: () => Promise<void>,
) {
  const clock = new FakeQuestionClock()
  const session = new ScriptedQuestionSession('session-1', 'test-model')
  const host = new FakeAgentHost()
  host.startSession.mockResolvedValue(session)
  const registries: FakeAcpQuestionRegistry[] = []
  const updates: acp.SessionUpdate[] = []
  const forms: {
    signal: AbortSignal
    response: ReturnType<typeof Promise.withResolvers<acp.CreateElicitationResponse>>
  }[] = []
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const questionBundle = vi.fn(() => questionFactories)
  const agent = createAcpAgent({
    backend: museCodeTestBackend(host),
    version: 'test',
    options: {
      canBypass: false,
      allowsContributorModels: false,
      initialMode: 'manual',
      questionsDeferAfterSeconds: 10,
    },
    signIn: { id: 'test', name: 'test', description: 'test', command: 'test', args: [] },
    defaultCwd: CWD,
    paid: new AcpPaidUse({
      flagged: [],
      canRemember: () => false,
      grants: memoryPaidGrants(),
      log,
    }),
    log,
    questionClock: clock,
    questionBundle,
    questions:
      policy === 'decline'
        ? 'decline'
        : (input) => {
            const registry = new FakeAcpQuestionRegistry(input)
            if (loading !== undefined) registry.load.mockImplementation(loading)
            registries.push(registry)
            return registry
          },
  })
  const client = acp
    .client({ name: 'm112-test' })
    .onNotification('session/update', (context) => {
      updates.push(context.params.update)
    })
    .onRequest('elicitation/create', (context) => {
      const response = Promise.withResolvers<acp.CreateElicitationResponse>()
      forms.push({ signal: context.signal, response })
      return response.promise
    })
  const run = async (op: (context: acp.ClientContext) => Promise<void>, hasForms = false) => {
    await client.connectWith(agent, async (context) => {
      await context.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: hasForms ? { elicitation: { form: {} } } : {},
      })
      await context.request('session/new', { cwd: CWD, mcpServers: [] })
      await op(context)
    })
  }
  const prompt = (client: acp.ClientContext, text: string) =>
    client.request('session/prompt', {
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text }],
    })
  const finish = (turnId = 'turn-1') => {
    session.emit({ type: 'turnCompleted', turnId, terminal: 'completed' })
  }
  return {
    clock,
    session,
    host,
    registries,
    updates,
    forms,
    log,
    run,
    prompt,
    finish,
    questionBundle,
  }
}

async function startedPrompt(h: ReturnType<typeof agentHarness>, client: acp.ClientContext) {
  const response = h.prompt(client, 'work')
  await until(() => h.session.sendTurn.mock.calls.length === 1)
  return { response }
}

async function requestedQuestion(h: ReturnType<typeof agentHarness>, client: acp.ClientContext) {
  const started = await startedPrompt(h, client)
  h.session.emit(acpQuestionEvent())
  return started
}

async function openQuestion(h: ReturnType<typeof agentHarness>, client: acp.ClientContext) {
  const started = await requestedQuestion(h, client)
  await until(() => h.registries[0]?.list()[0]?.state === 'open')
  return started
}

async function resumeActiveTurn(h: ReturnType<typeof agentHarness>, client: acp.ClientContext) {
  const resume = h.host.resumeSession.getMockImplementation()!
  h.host.resumeSession.mockImplementationOnce(async (...args) => ({
    ...(await resume(...args)),
    session: h.session,
    activeTurnId: 'resumed-1',
  }))
  await client.request('session/resume', { sessionId: h.session.sessionId, cwd: CWD })
}

describe('M112 through the pinned ACP SDK client', () => {
  it('loads question handling on the first local command or question only', async () => {
    const h = agentHarness()
    await h.run(async (client) => {
      expect(h.questionBundle).not.toHaveBeenCalled()
      const { response } = await startedPrompt(h, client)
      h.finish()
      await response
      expect(h.questionBundle).not.toHaveBeenCalled()
      await h.prompt(client, '/questions')
      expect(h.questionBundle).toHaveBeenCalledTimes(1)
      await h.prompt(client, '/answer 1 Blue')
      expect(h.questionBundle).toHaveBeenCalledTimes(1)
    })
    const asking = agentHarness()
    await asking.run(async (client) => {
      const { response } = await requestedQuestion(asking, client)
      await until(() => asking.registries[0]?.list()[0]?.state === 'open')
      expect(asking.questionBundle).toHaveBeenCalledTimes(1)
      asking.finish()
      await response
    })
  })
  it('no forms defer, /questions and /answer work during a running prompt, and answers steer once', async () => {
    const h = agentHarness()
    await h.run(async (client) => {
      const { response } = await requestedQuestion(h, client)
      await until(() => h.registries[0]?.list()[0]?.state === 'open')
      await h.prompt(client, '/questions')
      await h.prompt(client, '/answer 1 Use Green')
      await h.prompt(client, '/answer 1 Use Green')
      expect(h.session.steer).toHaveBeenCalledTimes(1)
      expect(h.session.sendTurn).toHaveBeenCalledTimes(1)
      expect(h.session.setApprovalMode).not.toHaveBeenCalledWith('never')
      h.finish()
      await response
    })
    expect(JSON.stringify(h.updates)).toContain('Question 1: Colour')
    expect(JSON.stringify([h.log.info.mock.calls, h.log.warn.mock.calls])).not.toContain(
      'Which colour?',
    )
    expect(h.clock.pendingTimers).toBe(0)
  })

  it('the SDK actually withdraws a form and a late answer queues before the next prompt', async () => {
    const h = agentHarness()
    await h.run(async (client) => {
      const { response } = await requestedQuestion(h, client)
      await until(() => h.forms.length === 1)
      h.clock.advance(10 * SECOND)
      await until(() => h.forms[0]?.signal.aborted === true)
      h.finish()
      await response
      h.forms[0]?.response.resolve({ action: 'accept', content: { colour: 'Blue' } })
      await until(() => h.registries[0]?.queued.length === 1)
      expect(h.session.sendTurn).toHaveBeenCalledTimes(1)
      const next = h.prompt(client, 'continue')
      await until(() => h.session.sendTurn.mock.calls.length === 2)
      expect(h.session.sendTurn.mock.calls[1]?.[0]).toEqual([
        { type: 'text', text: expect.stringContaining('Answer to your earlier question q-1') },
        { type: 'text', text: 'continue' },
      ])
      h.finish('turn-2')
      await next
      expect(h.registries[0]?.queued.length).toBe(0)
    }, true)
  })

  it.each([new SteerRefusedError('no turn'), new Error('uncertain')])(
    'a refused or uncertain steer is never retried unsafely: %j',
    async (error) => {
      const h = agentHarness()
      await h.run(async (client) => {
        const { response } = await startedPrompt(h, client)
        h.session.emit(acpQuestionEvent())
        await until(() => h.registries[0]?.list()[0]?.state === 'open')
        h.session.steer.mockRejectedValueOnce(error)
        await h.prompt(client, '/answer 1 Blue')
        await h.prompt(client, '/answer 1 Blue')
        expect(h.session.steer).toHaveBeenCalledTimes(1)
        expect(h.registries[0]?.queued.length).toBe(error instanceof SteerRefusedError ? 1 : 0)
        h.finish()
        await response
      })
    },
  )

  it('headless policy declines at once, creates no registry and starts no clock', async () => {
    const h = agentHarness('decline')
    await h.run(async (client) => {
      const { response } = await requestedQuestion(h, client)
      await until(() => h.session.cancelQuestions.mock.calls.length === 1)
      h.finish()
      await response
    }, true)
    expect(h.registries).toEqual([])
    expect(h.forms).toEqual([])
    expect(h.clock.pendingTimers).toBe(0)
    expect(h.session.deferQuestions).not.toHaveBeenCalled()
  })

  it('question failures never log the planted form or answer canary', async () => {
    const h = agentHarness()
    await h.run(async (client) => {
      const { response } = await startedPrompt(h, client)
      const event = acpQuestionEvent()
      h.session.emit({
        ...event,
        questions: event.questions.map((question) => ({
          ...question,
          question: 'PRIVATE-QUESTION-CANARY',
        })),
      })
      await until(() => h.registries[0]?.list()[0]?.state === 'open')
      h.registries[0]?.answer.mockRejectedValueOnce(new Error('PRIVATE-ANSWER-CANARY'))
      await h.prompt(client, '/answer 1 PRIVATE-ANSWER-CANARY')
      expect(h.log.warn).toHaveBeenCalledWith(expect.stringContaining('question operation failed'))
      const logged = JSON.stringify([
        h.log.trace.mock.calls,
        h.log.info.mock.calls,
        h.log.warn.mock.calls,
        h.log.error.mock.calls,
      ])
      expect(logged).not.toContain('PRIVATE-QUESTION-CANARY')
      expect(logged).not.toContain('PRIVATE-ANSWER-CANARY')
      expect(JSON.stringify(h.updates)).toContain(UI_TEXT.questionAnswerUncertain)
      h.finish()
      await response
    })
  })

  it('a Stop during queue loading starts no turn and restores the leased queue prefix', async () => {
    const h = agentHarness()
    await h.run(async (client) => {
      const gate = Promise.withResolvers<readonly never[]>()
      h.registries[0]?.queuedParts.mockReturnValueOnce(gate.promise)
      const response = h.prompt(client, 'work')
      await until(() => h.registries[0]?.queuedParts.mock.calls.length === 1)
      await client.notify('session/cancel', { sessionId: h.session.sessionId })
      await until(() =>
        h.log.info.mock.calls.some((call) =>
          String(call[0]).includes('cancelled before its turn started'),
        ),
      )
      gate.resolve([])
      expect(await response).toEqual({ stopReason: 'cancelled' })
      expect(h.session.sendTurn).not.toHaveBeenCalled()
      expect(h.registries[0]?.acknowledgeQueued).toHaveBeenCalledExactlyOnceWith('notTaken')
    })
  })

  it('skill-list failure still advertises the question commands without dispatching a turn', async () => {
    const h = agentHarness()
    await h.run(async (client) => {
      h.session.listSkills.mockRejectedValueOnce(new Error('no skills'))
      await h.prompt(client, '/questions')
      expect(h.session.sendTurn).not.toHaveBeenCalled()
      expect(h.updates).toContainEqual(expectedQuestionCommandsUpdate())
    })
  })

  it('release while a late answer awaits turn start cannot queue it on the old session', async () => {
    const h = agentHarness()
    await h.run(async (client) => {
      const gate = Promise.withResolvers<TurnSubmission>()
      h.session.sendTurn.mockReturnValueOnce(gate.promise)
      const { response } = await requestedQuestion(h, client)
      await until(() => h.registries[0]?.list()[0]?.state === 'open')
      const answer = h.prompt(client, '/answer 1 Blue')
      await until(() => h.registries[0]?.answer.mock.calls.length === 1)
      const closing = client.request('session/close', { sessionId: h.session.sessionId })
      await until(() => h.registries[0]?.dispose.mock.calls.length === 1)
      gate.resolve({ turnId: 'turn-1', disposition: 'started' })
      await closing
      await answer
      expect(await response).toEqual({ stopReason: 'cancelled' })
      expect(h.registries[0]?.queue).not.toHaveBeenCalled()
      expect(h.session.steer).not.toHaveBeenCalled()
    })
  })

  it.each(['rejected', 'thrown'] as const)(
    'Stop still cancels the backend when writing question state fails: %s',
    async (failure) => {
      const h = agentHarness()
      await h.run(async (client) => {
        const { response } = await startedPrompt(h, client)
        h.registries[0]?.turnEnded.mockImplementationOnce(() => {
          const error = new Error('PRIVATE-QUESTION-CANARY')
          if (failure === 'thrown') throw error
          return Promise.reject(error)
        })
        await client.notify('session/cancel', { sessionId: h.session.sessionId })
        await until(() => h.session.cancel.mock.calls.length === 1)
        h.finish()
        expect(await response).toEqual({ stopReason: 'cancelled' })
        expect(h.log.warn).toHaveBeenCalledWith(
          expect.stringContaining('question state was not saved'),
        )
        expect(JSON.stringify(h.log.warn.mock.calls)).not.toContain('PRIVATE-QUESTION-CANARY')
      })
    },
  )

  it('Stop cancels the backend before a pending question write settles', async () => {
    const h = agentHarness()
    await h.run(async (client) => {
      const { response } = await startedPrompt(h, client)
      const gate = Promise.withResolvers<undefined>()
      h.registries[0]?.turnEnded.mockReturnValueOnce(gate.promise)
      await client.notify('session/cancel', { sessionId: h.session.sessionId })
      await until(() => h.registries[0]?.turnEnded.mock.calls.length === 1)
      await new Promise((resolve) => setImmediate(resolve))
      try {
        expect(h.session.cancel).toHaveBeenCalledTimes(1)
      } finally {
        gate.resolve(undefined)
        h.finish()
        await response
      }
    })
  })

  it('a refused steer after session release cannot enqueue on its disposed registry', async () => {
    const h = agentHarness()
    await h.run(async (client) => {
      const { response } = await openQuestion(h, client)
      const gate = Promise.withResolvers<TurnSubmission>()
      h.session.steer.mockReturnValueOnce(gate.promise)
      const answer = h.prompt(client, '/answer 1 Blue')
      await until(() => h.session.steer.mock.calls.length === 1)
      await client.request('session/close', { sessionId: h.session.sessionId })
      expect(h.registries[0]?.dispose).toHaveBeenCalledTimes(1)
      gate.reject(new SteerRefusedError('session released'))
      await answer
      expect(await response).toEqual({ stopReason: 'cancelled' })
      expect(h.registries[0]?.queue).not.toHaveBeenCalled()
    })
  })

  it('an idle answer announces queued until the next prompt sends it', async () => {
    const h = agentHarness()
    await h.run(async (client) => {
      const { response } = await openQuestion(h, client)
      h.finish()
      await response
      await h.prompt(client, '/answer 1 Blue')
      const notices = h.updates.filter((update) => update.sessionUpdate === 'agent_message_chunk')
      expect(notices).toContainEqual({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: UI_TEXT.acpQuestionAnswerQueued },
      })
      expect(JSON.stringify(notices)).not.toContain(UI_TEXT.announceLateAnswerSent)
      expect(h.session.steer).not.toHaveBeenCalled()
      expect(h.session.sendTurn).toHaveBeenCalledTimes(1)
      expect(h.registries[0]?.queued).toHaveLength(1)
      const next = h.prompt(client, 'continue')
      await until(() => h.session.sendTurn.mock.calls.length === 2)
      h.finish('turn-2')
      await next
      expect(JSON.stringify(h.updates)).toContain(UI_TEXT.announceLateAnswerSent)
      expect(h.registries[0]?.queued).toHaveLength(0)
    })
  })

  it('a resumed backend turn receives a late answer even without a local pending prompt', async () => {
    const h = agentHarness()
    await h.run(async (client) => {
      await resumeActiveTurn(h, client)
      h.session.emit(acpQuestionEvent())
      await until(() => h.registries.at(-1)?.list()[0]?.state === 'open')
      await h.prompt(client, '/answer 1 Blue')
      expect(h.session.steer).toHaveBeenCalledExactlyOnceWith('resumed-1', [
        { type: 'text', text: expect.stringContaining('Answer to your earlier question q-1') },
      ])
      expect(h.session.sendTurn).not.toHaveBeenCalled()
      expect(h.registries.at(-1)?.queue).not.toHaveBeenCalled()
    })
  })

  it('loads the registry before replayed requests can register or replace stored questions', async () => {
    const gate = Promise.withResolvers<undefined>()
    const h = agentHarness('interactive', () => gate.promise)
    h.session.openPrompts = [acpQuestionEvent()]
    const running = h.run(async () => {
      await until(() => h.registries[0]?.list()[0]?.state === 'open')
    })
    await until(() => h.registries[0]?.load.mock.calls.length === 1)
    expect(h.registries[0]?.register).not.toHaveBeenCalled()
    gate.resolve(undefined)
    await running
    expect(h.registries[0]?.register).toHaveBeenCalledTimes(1)
  })

  it('a resumed turn ending withdraws a waiting form and preserves its open question', async () => {
    const h = agentHarness()
    await h.run(async (client) => {
      await resumeActiveTurn(h, client)
      h.session.emit(acpQuestionEvent())
      await until(() => h.forms.length === 1)
      h.finish('resumed-1')
      await until(() => h.forms[0]?.signal.aborted === true)
      expect(h.registries.at(-1)?.turnEnded).toHaveBeenCalledExactlyOnceWith(false)
      expect(h.registries.at(-1)?.list()[0]?.state).toBe('open')
      h.forms[0]?.response.resolve({ action: 'accept', content: { colour: 'Blue' } })
      await until(() => h.registries.at(-1)?.queue.mock.calls.length === 1)
      expect(h.session.steer).not.toHaveBeenCalled()
      expect(h.clock.pendingTimers).toBe(0)
    }, true)
  })

  it('failed queue acknowledgements report the submission error and keep the started turn stoppable', async () => {
    const h = agentHarness()
    await h.run(async (client) => {
      h.registries[0]?.acknowledgeQueued.mockRejectedValue(new Error('PRIVATE-QUEUE-CANARY'))
      await expect(h.prompt(client, 'work')).rejects.toThrow(UI_TEXT.questionAnswerUncertain)
      await client.notify('session/cancel', { sessionId: h.session.sessionId })
      await until(() => h.session.cancel.mock.calls.length === 1)
      expect(h.registries[0]?.acknowledgeQueued.mock.calls).toEqual([['taken'], ['uncertain']])
      expect(JSON.stringify(h.log.warn.mock.calls)).not.toContain('PRIVATE-QUEUE-CANARY')
      h.finish()
    })
  })

  it('reserved question commands replace skills of the same names', async () => {
    const h = agentHarness()
    await h.run(async (client) => {
      h.session.listSkills.mockResolvedValueOnce(
        ['answer', 'questions'].map((selector) => ({
          selector,
          displayName: selector,
          description: 'skill collision',
          argumentHint: undefined,
        })),
      )
      await h.prompt(client, '/questions')
      const commands = h.updates.flatMap((update) =>
        update.sessionUpdate === 'available_commands_update' ? update.availableCommands : [],
      )
      expect(commands.map((command) => command.name)).toEqual([
        'help',
        'compact',
        'answer',
        'questions',
      ])
      expect(commands.map((command) => command.description)).toEqual([
        UI_TEXT.referenceIntro,
        UI_TEXT.compactDetail,
        UI_TEXT.acpAnswerHelp,
        UI_TEXT.acpQuestionsHelp,
      ])
      expect(h.session.sendTurn).not.toHaveBeenCalled()
    })
  })

  it('a question command with extra blocks remains an ordinary prompt', async () => {
    const h = agentHarness()
    await h.run(async (client) => {
      const response = client.request('session/prompt', {
        sessionId: h.session.sessionId,
        prompt: [
          { type: 'text', text: '/answer 1 Blue' },
          { type: 'text', text: 'extra context' },
        ],
      })
      await until(() => h.session.sendTurn.mock.calls.length === 1)
      expect(h.session.sendTurn.mock.calls[0]?.[0]).toEqual([
        { type: 'text', text: '/answer 1 Blue' },
        { type: 'text', text: 'extra context' },
      ])
      expect(h.registries[0]?.answer).not.toHaveBeenCalled()
      h.finish()
      await response
    })
  })
})
