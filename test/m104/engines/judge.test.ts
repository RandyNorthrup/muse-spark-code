import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createRuntimeJudge, type RuntimeJudgeDeps } from '../../../src/runtime/features/judge'
import { createWindowJudge } from '../../../src/host/judge/judgeEntry'
import { ModelApiClient } from '../../../src/core/backends/modelapi/client'
import { judgeBody } from '../../unit/helpers/judgeBody'
import { UI_TEXT, type JudgeEngine } from '../../../src/shared/constants'
import type { AgentEvent } from '../../../src/shared/agentEvents'
import { JUDGE_ACTION } from '../../unit/helpers/judgeUseRig'
import { FakeAgentSession } from '../../unit/helpers/fakeAgent'
import { FakeLogOutputChannel } from '../../unit/helpers/fakes'
import {
  fakeModelApi,
  fakeModelApiClientSettings,
  FAKE_MODEL_API_KEY,
} from '../../unit/helpers/fakeModelApi'
import { engineFixtures } from './fixtures'
import { enginePaidBudget, paidHarness } from './paidHarness'
import { Usd, type UsdAmount } from '../../../src/shared/usd'

// 0.17 keeps money as exact decimal strings (CAPS017).
const usd = (value: number): UsdAmount => Usd.from(value).toAmount()

const fixtures = engineFixtures()
const body = judgeBody()
async function setup(backend: 'modelApi' | 'museCode' = 'modelApi', modelId = body.model) {
  const directory = await fixtures.folder('m104-pb-judge-')
  const budget = enginePaidBudget(directory)
  const policy = paidHarness(['judge'], () => {
    throw new Error('replacement tariff must not price an old receipt')
  })
  const state: { isCurrent: boolean; canJudge: boolean; isPriced: boolean; engine: JudgeEngine } = {
    isCurrent: true,
    canJudge: true,
    isPriced: true,
    engine: 'auto',
  }
  const api = fakeModelApi()
  const client = new ModelApiClient({
    ...fakeModelApiClientSettings(new FakeLogOutputChannel()),
    fetch: api.fetch,
  })
  const sessions: FakeAgentSession[] = []
  const started = vi.fn<RuntimeJudgeDeps['startSession']>((options) => {
    const session = new FakeAgentSession('side-fixture', options.modelId)
    sessions.push(session)
    return Promise.resolve(session)
  })
  const held = { response: Promise.resolve(), settlement: Promise.resolve() }
  const price = { input: usd(2), cachedInput: usd(0.5), output: usd(8) }
  const events: AgentEvent[] = []
  const status = vi.fn()
  const load = vi.fn(() => ({ createWindowJudge }))
  const drained = vi.fn(() => Promise.resolve())
  const service = createRuntimeJudge(
    {
      bundlePath: '/fixture/judge.js',
      loadBundle: load,
      engine: () => state.engine,
      context: () => ({
        backend,
        modelId,
        ownerId: 'fixture',
        contextLimit: 100_000,
        confidential: false,
      }),
      canJudge: () => state.canJudge,
      priceOf: () => (state.isPriced ? price : undefined),
      readSettingsText: () => undefined,
      startSession: started,
      modelApi: () => ({
        keyDigest: createHash('sha256').update(FAKE_MODEL_API_KEY).digest('hex'),
        source: {
          readMainBody: () => ({ ...body, model: modelId }),
          keyPrefix: () => 'fixture',
          prefixTokens: () => 0,
        },
        transport: {
          send: async (request, signal, guard) => {
            let text = ''
            let usage
            for await (const frame of client.streamResponse(
              request,
              signal,
              undefined,
              undefined,
              guard,
            )) {
              if (frame.type === 'response.output_text.delta') text += frame.delta
              if (
                'response' in frame &&
                frame.response.usage !== undefined &&
                frame.response.usage !== null
              )
                usage = {
                  inputTokens: frame.response.usage.input_tokens,
                  outputTokens: frame.response.usage.output_tokens,
                  cachedTokens: frame.response.usage.input_tokens_details?.cached_tokens ?? 0,
                  reasoningTokens: 0,
                }
            }
            await held.response
            return { text, ...(usage !== undefined && { usage }) }
          },
        },
      }),
      ledger: {
        remainingUsd: budget.judgeLedger.remainingUsd,
        reserve: async (cost) => {
          const claim = await budget.judgeLedger.reserve(cost)
          return {
            ...claim,
            settle: async (actual) => {
              await held.settlement
              await claim.settle(actual)
            },
          }
        },
      },
      paid: policy.paid.judge(directory, 'fixture-surface', budget.capUsd),
      emit: (_action, event) => {
        events.push(event)
      },
      status,
      notice: vi.fn(),
      log: new FakeLogOutputChannel(),
      assertCurrent: () => {
        if (!state.isCurrent) throw new Error('retired')
      },
      cancelNative: vi.fn(),
      drainNative: drained,
    },
    UI_TEXT,
    'en',
  )
  fixtures.own({
    dispose: async () => {
      await service.dispose()
      await policy.paid.dispose()
      await budget.dispose()
    },
  })
  return {
    service,
    budget,
    policy,
    state,
    api,
    started,
    sessions,
    events,
    status,
    load,
    drained,
    held,
    price,
    action: { ...JUDGE_ACTION, backend },
  }
}

async function sent(rig: Awaited<ReturnType<typeof setup>>) {
  await vi.waitFor(() => {
    expect(rig.api.responseBodies()).toHaveLength(1)
  })
}

describe('F54 portable owned Judge', () => {
  it.each(['off', 'unsupported', 'unpriced'] as const)(
    'refuses %s before loading or paid consent',
    async (reason) => {
      const rig = await setup()
      if (reason === 'off') rig.state.engine = 'off'
      else if (reason === 'unsupported') rig.state.canJudge = false
      else rig.state.isPriced = false
      expect(rig.service.judge.start(rig.action, 'state')).toBeUndefined()
      expect(rig.load).not.toHaveBeenCalled()
      expect(rig.policy.ask).not.toHaveBeenCalled()
      expect(rig.api.responseBodies()).toHaveLength(0)
    },
  )
  // A corrupt catalog rate reaches the engine as an unparseable or negative amount.
  it.each(['NaN', 'Infinity', '-1'])('refuses unusable price %s before a popup', async (rate) => {
    const rig = await setup()
    rig.price.input = rate as UsdAmount
    expect(rig.service.judge.start(rig.action, 'state')).toBeUndefined()
    expect(rig.load).not.toHaveBeenCalled()
    expect(rig.policy.ask).not.toHaveBeenCalled()
  })
  it('shares contribution release and owner drain, refusing retained starts', async () => {
    const rig = await setup()
    rig.service.judge.dispose()
    const closing = rig.service.dispose()
    expect(rig.service.dispose()).toBe(closing)
    await closing
    expect(rig.service.judge.start(rig.action, 'late')).toBeUndefined()
    expect(rig.drained).toHaveBeenCalledOnce()
    expect(rig.load).not.toHaveBeenCalled()
  })
  it('uses the actual shared D48 denial and sends no request', async () => {
    const rig = await setup()
    rig.policy.ask.mockResolvedValue('deny')
    const fence = rig.service.judge.start(rig.action, 'state')
    await rig.service.judge.settled?.()
    expect(rig.policy.ask).toHaveBeenCalledOnce()
    expect(rig.api.responseBodies()).toHaveLength(0)
    expect(fence?.read()).toBeUndefined()
    await expect(rig.budget.latestDay()).resolves.toMatchObject({ spentUsd: usd(0) })
  })
  it('drains held consent on release without creating a source for a retired action', async () => {
    const rig = await setup()
    const consent = Promise.withResolvers<'once'>()
    rig.policy.ask.mockImplementation(() => consent.promise)
    rig.service.judge.start(rig.action, 'state')
    await vi.waitFor(() => {
      expect(rig.policy.ask).toHaveBeenCalledOnce()
    })
    const closing = rig.service.dispose()
    try {
      await new Promise((resolve) => setImmediate(resolve))
      expect(rig.drained).not.toHaveBeenCalled()
    } finally {
      consent.resolve('once')
    }
    await closing
    expect(rig.drained).toHaveBeenCalledOnce()
    expect(rig.api.responseBodies()).toHaveLength(0)
  })
  it('drains a sent response and original tariff settlement before native release; the late hint is discarded', async () => {
    const rig = await setup()
    const response = Promise.withResolvers<undefined>()
    const settlement = Promise.withResolvers<undefined>()
    rig.held.response = response.promise
    rig.held.settlement = settlement.promise
    rig.api.script({
      text: '{"answer":"yes","confidence":99}',
      usage: { input: 10, output: 2, cached: 1 },
    })
    const fence = rig.service.judge.start(rig.action, 'state')
    await sent(rig)
    rig.state.isCurrent = false
    rig.state.isPriced = false
    rig.price.input = usd(999)
    const closing = rig.service.dispose()
    try {
      await new Promise((resolve) => setImmediate(resolve))
      expect(rig.drained).not.toHaveBeenCalled()
      response.resolve(undefined)
      await new Promise((resolve) => setImmediate(resolve))
      expect(rig.drained).not.toHaveBeenCalled()
    } finally {
      response.resolve(undefined)
      settlement.resolve(undefined)
    }
    await closing
    expect(rig.drained).toHaveBeenCalledOnce()
    expect(fence?.read()).toBeUndefined()
    expect(rig.policy.usage.current).toMatchObject({
      judgeCalls: 1,
      judgeUnknownRequests: 0,
      judgeCostUsd: usd(0.0000345),
    })
    await expect(rig.budget.latestDay()).resolves.toMatchObject({ spentUsd: usd(0.0000345) })
    expect(rig.events.map((event) => event.type)).toEqual(['itemStarted'])
  })
  it('keeps ready caution advisory and reuses the captured response parser', async () => {
    const rig = await setup()
    rig.api.script({
      text: '{"answer":"yes","confidence":99}',
      usage: { input: 10, output: 2, cached: 1 },
    })
    const fence = rig.service.judge.start(rig.action, 'state')
    await rig.service.judge.settled?.()
    expect(fence?.read()).toBe('caution')
    expect(fence?.read()).toBeUndefined()
    expect(rig.events).toHaveLength(2)
    expect(rig.events[0]).toHaveProperty('item.paid', 'judge')
  })
  it('uses the injected verified tariff on the subscription source without a Meta model whitelist', async () => {
    const rig = await setup('museCode', 'captured-fixture-model')
    const fence = rig.service.judge.start(rig.action, 'state')
    await vi.waitFor(() => {
      expect(rig.sessions[0]?.sendTurn).toHaveBeenCalledOnce()
    })
    const session = rig.sessions[0]
    if (session === undefined) throw new Error('fixture side session absent')
    session.emit(
      {
        type: 'itemCompleted',
        item: {
          itemId: 'reply',
          turnId: 'turn-1',
          kind: 'agentMessage',
          status: 'completed',
          text: '{"answer":"yes","confidence":99}',
        },
      },
      { type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' },
    )
    await rig.service.judge.settled?.()
    expect(fence?.read()).toBe('caution')
    expect(rig.started.mock.calls[0]?.[0].modelId).toBe('captured-fixture-model')
    expect(rig.policy.ask).not.toHaveBeenCalled()
    expect(rig.policy.usage.current.judgeCalls ?? 0).toBe(0)
    expect(rig.api.responseBodies()).toHaveLength(0)
  })
  it('disposes a Muse Code side session returned after owner release before sending a turn', async () => {
    const rig = await setup('museCode')
    const returned = Promise.withResolvers<FakeAgentSession>()
    const session = new FakeAgentSession('late-side', body.model)
    rig.started.mockImplementation(() => returned.promise)
    rig.service.judge.start(rig.action, 'state')
    await vi.waitFor(() => {
      expect(rig.started).toHaveBeenCalledOnce()
    })
    const closing = rig.service.dispose()
    try {
      await new Promise((resolve) => setImmediate(resolve))
      expect(rig.drained).not.toHaveBeenCalled()
    } finally {
      returned.resolve(session)
    }
    await closing
    expect(session.dispose).toHaveBeenCalledOnce()
    expect(session.sendTurn).not.toHaveBeenCalled()
    expect(rig.policy.ask).not.toHaveBeenCalled()
  })
})
