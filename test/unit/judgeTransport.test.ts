import { describe, expect, it, vi } from 'vitest'
import { admittedModelApiJudge } from '../../src/host/judge/judgeTransport'
import { JudgeUsageRows } from '../../src/host/judge/judgeUsage'
import { PaidUsage } from '../../src/core/paid/paidFeatures'
import type { JudgeAdmissionBinding, JudgeDailyLedger } from '../../src/core/judge/admission'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import type { ModelApiJudgeConnection } from '../../src/core/judge/same/modelApiSource'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { FakeLogOutputChannel } from './helpers/fakes'

const BODY: CreateResponseBody = {
  model: 'muse-spark-1.3',
  instructions: '',
  tools: [],
  input: [],
  tool_choice: 'auto',
  reasoning: { effort: 'medium', summary: 'auto' },
  stream: true,
  store: false,
  include: [],
  max_output_tokens: 100,
  prompt_cache_key: 'judge',
  prompt_cache_retention: 'in_memory',
}

function setup() {
  let binding: JudgeAdmissionBinding = {
    backend: 'modelApi',
    ownerId: 'owner',
    modelId: BODY.model,
    engine: 'auto',
    confidential: false,
    consent: 'granted',
  }
  const stop = new AbortController()
  const settle = vi.fn<(cost: number) => Promise<undefined>>().mockResolvedValue(undefined)
  const check = vi.fn()
  const ledger: JudgeDailyLedger = {
    remainingUsd: vi.fn(() => Promise.resolve(1)),
    reserve: vi.fn((reservedUsd) =>
      Promise.resolve({ claimId: 'call', reservedUsd, check, settle }),
    ),
  }
  const events: AgentEvent[] = []
  const usage = new PaidUsage(new FakeLogOutputChannel())
  const rows = new JudgeUsageRows({
    billing: 'modelApi',
    usage,
    emit: (event) => {
      events.push(event)
    },
  })
  const fetched = vi.fn()
  let isReceipt = true
  let isNetworkFailure = false
  let keyDigest = 'account'
  let hold: Promise<undefined> | undefined
  const connection: ModelApiJudgeConnection = {
    keyDigest: 'account',
    source: { readMainBody: () => BODY, keyPrefix: () => 'judge', prefixTokens: () => undefined },
    transport: {
      send: async (_body, _signal, guard) => {
        await hold
        guard?.(keyDigest)
        guard?.onRequestStarted?.()
        fetched()
        if (isNetworkFailure) throw new Error('connection lost')
        return {
          text: '{"answer":"yes","confidence":99}',
          ...(isReceipt && {
            usage: { inputTokens: 10, outputTokens: 2, cachedTokens: 1, reasoningTokens: 0 },
          }),
        }
      },
    },
  }
  const transport = admittedModelApiJudge({
    connection,
    ledger,
    rows,
    binding: () => binding,
    signal: stop.signal,
    contextLimit: 100_000,
    turnId: 'turn',
  })
  return {
    ledger,
    transport,
    settle,
    check,
    events,
    usage,
    fetched,
    stop,
    setBinding: (value: JudgeAdmissionBinding) => {
      binding = value
    },
    binding: () => binding,
    noReceipt: () => {
      isReceipt = false
    },
    loseResponse: () => {
      isNetworkFailure = true
    },
    changeKey: () => {
      keyDigest = 'other-account'
    },
    hold: (promise: Promise<undefined>) => {
      hold = promise
    },
  }
}

describe('M98 admitted dispatch integration', () => {
  it('reserves durably before fetching and settles complete receipts separately', async () => {
    const rig = setup()
    await rig.transport.send(BODY, new AbortController().signal)
    expect(rig.ledger.reserve).toHaveBeenCalledTimes(1)
    expect(vi.mocked(rig.ledger.reserve).mock.invocationCallOrder[0]).toBeLessThan(
      rig.fetched.mock.invocationCallOrder[0] ?? 0,
    )
    expect(rig.check.mock.invocationCallOrder.at(-1)).toBeLessThan(
      rig.fetched.mock.invocationCallOrder[0] ?? 0,
    )
    expect(rig.settle).toHaveBeenCalledWith(0.0000199)
    expect(rig.events.map((event) => event.type)).toEqual(['itemStarted', 'itemCompleted'])
    expect(rig.events[0]).toHaveProperty('item.paid', 'judge')
    expect(rig.usage.current.judgeCalls).toBe(1)
  })

  it.each(['abort', 'consent', 'account', 'claim'] as const)(
    'rechecks %s after the transport credential wait and refunds a known non-send',
    async (change) => {
      const rig = setup()
      const waiting = Promise.withResolvers<undefined>()
      rig.hold(waiting.promise)
      const sent = rig.transport.send(BODY, new AbortController().signal)
      const rejected = expect(sent).rejects.toThrow()
      await vi.waitFor(() => {
        expect(rig.ledger.reserve).toHaveBeenCalled()
      })
      switch (change) {
        case 'abort': {
          rig.stop.abort()
          break
        }
        case 'consent': {
          rig.setBinding({ ...rig.binding(), consent: 'declined' })
          break
        }
        case 'account': {
          rig.changeKey()
          break
        }
        case 'claim': {
          rig.check.mockImplementation(() => {
            throw new Error('cap lowered')
          })
          break
        }
      }
      waiting.resolve(undefined)
      await rejected
      expect(rig.fetched).not.toHaveBeenCalled()
      expect(rig.settle).toHaveBeenCalledWith(0)
      expect(rig.events).toEqual([])
    },
  )

  it.each(['missing receipt', 'lost response'] as const)(
    'retains liability for a %s',
    async (fault) => {
      const rig = setup()
      if (fault === 'missing receipt') {
        rig.noReceipt()
        const result = await rig.transport.send(BODY, new AbortController().signal)
        expect(result.settledCostUsd).toBeUndefined()
        expect(result.reservedCostUsd).toBeGreaterThan(0)
      } else {
        rig.loseResponse()
        await expect(rig.transport.send(BODY, new AbortController().signal)).rejects.toThrow(
          'connection lost',
        )
      }
      expect(rig.fetched).toHaveBeenCalledTimes(1)
      expect(rig.settle).not.toHaveBeenCalled()
      expect(rig.events[1]).not.toHaveProperty('item.usage')
      expect(rig.usage.current.judgeCalls).toBe(1)
    },
  )

  it('refuses an oversized full request without reserving or sending', async () => {
    const rig = setup()
    await expect(
      rig.transport.send(
        { ...BODY, instructions: 'x'.repeat(100_001) },
        new AbortController().signal,
      ),
    ).rejects.toThrow('loaded context')
    expect(rig.ledger.reserve).not.toHaveBeenCalled()
    expect(rig.fetched).not.toHaveBeenCalled()
  })

  it('fails closed on a corrupt ledger and on an unpriced model', async () => {
    const rig = setup()
    vi.mocked(rig.ledger.remainingUsd).mockRejectedValueOnce(new Error('corrupt'))
    await expect(rig.transport.send(BODY, new AbortController().signal)).rejects.toThrow(
      'ledger-unavailable',
    )
    rig.setBinding({ ...rig.binding(), modelId: 'uncaptured-price' })
    await expect(
      rig.transport.send({ ...BODY, model: 'uncaptured-price' }, new AbortController().signal),
    ).rejects.toThrow('unpriced')
    expect(rig.ledger.reserve).not.toHaveBeenCalled()
    expect(rig.fetched).not.toHaveBeenCalled()
  })
})
