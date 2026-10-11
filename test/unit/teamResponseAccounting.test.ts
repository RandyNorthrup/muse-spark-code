// RVCM963E/F: actual host/transport, fake captured wire. No live model calls.
import { describe, expect, it, vi } from 'vitest'
import { ModelApiClient, type ResponseAttemptGuard } from '../../src/core/backends/modelapi/client'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { createProviderRegistry } from '../../src/core/providers/providerRegistry'
import type { ResponseAttemptOutcome } from '../../src/core/backends/modelapi/transport'
import {
  fakeModelApi,
  fakeModelApiClientSettings,
  type ScriptedReply,
} from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { watchSessionTurns } from './helpers/sessionTurns'

async function setup(
  modelId: string,
  replies: ScriptedReply[],
  options: {
    rebuild?: boolean
    refuseDispatch?: boolean
    refuseRetry?: boolean
    rejectStart?: boolean
    abortRetry?: boolean
    admission?: {
      prepare?: () => Promise<void>
      reserve?: () => Promise<void>
      reserved?: () => void
      attached?: () => void
      settle?: () => Promise<void>
    }
  } = {},
) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  let generation = 0
  const client = Object.assign(
    new ModelApiClient({
      ...fakeModelApiClientSettings(log),
      fetch: api.fetch,
      vaultScrub: {
        scrub: (text) => Promise.resolve(text),
        get generation() {
          return generation
        },
      },
    }),
    { isPlanModel: (model: string) => model === 'bare-plan' },
  )
  api.models.push(modelId)
  const settlements: { claim: number; outcome: ResponseAttemptOutcome }[] = []
  const maxima: { inputTokens: number; outputTokens: number; costUsd?: string | undefined }[] = []
  const reserve = vi.fn(async (maximum: (typeof maxima)[number]) => {
    maxima.push(maximum)
    const claim = reserve.mock.calls.length
    await options.admission?.reserve?.()
    options.admission?.reserved?.()
    return async (outcome: ResponseAttemptOutcome) => {
      settlements.push({ claim, outcome })
      await options.admission?.settle?.()
    }
  })
  let prepares = 0
  const guard: ResponseAttemptGuard = Object.assign(
    () => {
      options.admission?.attached?.()
      if ((options.refuseRetry && reserve.mock.calls.length > 1) || options.refuseDispatch)
        throw new Error('revoked before dispatch')
    },
    {
      prepare: () => {
        prepares += 1
        if (prepares === 1 && options.rebuild) generation += 1
        return options.admission?.prepare?.() ?? Promise.resolve()
      },
      reserveUsage: reserve,
      onRequestStarted: () => {
        if (options.rejectStart) throw new Error('dispatch callback failed')
      },
    },
  )
  const noteUsage = vi.fn()
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client, workspaceRoot: '/copy', io: memoryToolIo({}, '/copy'), log }),
    admitResponseAttempt: guard,
    noteResponseUsage: noteUsage,
    models: createProviderRegistry({
      models: () =>
        Promise.resolve([
          {
            ref: 'provider/priced',
            origin: 'https://provider.example.test',
            pricing: {
              kind: 'priced',
              card: { input: 0.000001, output: 0.000002, source: 'user' },
            },
            evidence: { capabilities: { toolCalling: true } },
          },
        ]),
      createClient: () => Promise.resolve(client),
      isCurrent: () => true,
    }),
  })
  const session = await host.startSession({
    workspaceRoot: '/copy',
    modelId,
    approvalMode: 'allowAll',
  })
  const turns = watchSessionTurns(session)
  if (options.abortRetry)
    session.onEvent((event) => {
      if (event.type === 'turnRetry') void session.cancel()
    })
  api.script(...replies)
  return {
    api,
    host,
    session,
    turns,
    reserve,
    settlements,
    maxima,
    noteUsage,
    prepares: () => prepares,
  }
}

describe('RVCM963E response claims', () => {
  it.each(['muse-spark-1.3', 'bare-plan', 'provider/priced', 'unknown-model'])(
    'R5-1: %s response settles its exact claim with known price only',
    async (model) => {
      const h = await setup(model, [{ text: 'done', usage: { input: 12, output: 3, cached: 2 } }])
      try {
        await h.session.sendTurn([{ type: 'text', text: 'work' }])
        await h.turns.turnDone()
        expect(h.settlements).toHaveLength(1)
        const outcome = h.settlements[0]?.outcome
        expect(outcome?.kind).toBe('billed')
        if (outcome?.kind !== 'billed') throw new Error('billed outcome missing')
        const reported = outcome.usage
        expect(h.settlements[0]?.claim).toBe(1)
        expect(reported).toMatchObject({ inputTokens: 12, outputTokens: 3, cachedTokens: 2 })
        if (model === 'unknown-model') expect(reported.costUsd).toBeUndefined()
        else if (model === 'bare-plan') expect(Number(reported.costUsd)).toBe(0)
        else
          expect(Number(reported.costUsd)).toBeCloseTo(
            model === 'provider/priced' ? 0.000018 : 0.00002555,
            10,
          )
        expect(h.noteUsage).toHaveBeenCalledExactlyOnceWith(
          model,
          expect.objectContaining(reported),
        )
      } finally {
        await h.host.close()
      }
    },
  )

  it.each([
    { name: 'success', replies: [], outcomes: ['billed'], posts: 1 },
    {
      name: '503 then success',
      replies: [{ httpError: { status: 503 } }],
      outcomes: ['ambiguous', 'billed'],
      posts: 2,
    },
    {
      name: 'dispatched timeout then success',
      replies: [{ networkError: 'timed out', networkErrorCode: 'ETIMEDOUT' }],
      outcomes: ['ambiguous', 'billed'],
      posts: 2,
    },
    {
      name: '429 then success',
      replies: [{ httpError: { status: 429, retryAfter: '0' } }],
      outcomes: ['released', 'billed'],
      posts: 2,
    },
    {
      name: '400 refusal',
      replies: [{ httpError: { status: 400 } }],
      outcomes: ['released'],
      posts: 1,
    },
    {
      name: 'failure before dispatch',
      replies: [],
      outcomes: ['released'],
      posts: 0,
      refuseDispatch: true,
    },
    {
      name: 'vault rebuild',
      replies: [],
      outcomes: ['released', 'billed'],
      posts: 1,
      rebuild: true,
    },
    {
      name: 'abort between ambiguous attempts',
      replies: [{ httpError: { status: 503 } }],
      outcomes: ['ambiguous'],
      posts: 1,
      abortRetry: true,
    },
    {
      name: 'abort after refused attempt',
      replies: [{ httpError: { status: 429, retryAfter: '0' } }],
      outcomes: ['released'],
      posts: 1,
      abortRetry: true,
    },
    {
      name: 'two ambiguous attempts then success',
      replies: [
        { httpError: { status: 503 } },
        { networkError: 'reset', networkErrorCode: 'ECONNRESET' },
      ],
      outcomes: ['ambiguous', 'ambiguous', 'billed'],
      posts: 3,
    },
    {
      name: 'ambiguous then refusal',
      replies: [{ httpError: { status: 503 } }, { httpError: { status: 400 } }],
      outcomes: ['ambiguous', 'released'],
      posts: 2,
    },
    {
      name: 'revocation before retry dispatch',
      replies: [{ httpError: { status: 503 } }],
      outcomes: ['ambiguous', 'released'],
      posts: 1,
      refuseRetry: true,
    },
    {
      name: 'dispatch callback fails before fetch',
      replies: [],
      outcomes: ['released'],
      posts: 0,
      rejectStart: true,
    },
    {
      name: 'invalid usage',
      replies: [{ text: 'done', usageOverride: { input_tokens: -1, output_tokens: 3 } }],
      outcomes: ['ambiguous'],
      posts: 1,
    },
    {
      name: 'missing usage',
      replies: [{ text: 'done', omitUsage: true }],
      outcomes: ['ambiguous'],
      posts: 1,
    },
  ])(
    'R6 outcomes: $name closes every attempt without erasing earlier liability',
    async ({ name, replies, outcomes, posts, ...options }) => {
      const success = { text: 'done', usage: { input: 12, output: 3 } }
      const h = await setup('muse-spark-1.3', [...replies, success], options)
      try {
        await h.session.sendTurn([{ type: 'text', text: 'first' }])
        await h.turns.turnDone()
        expect(h.api.responseBodies()).toHaveLength(posts)
        expect(h.settlements.map((item) => item.outcome.kind)).toEqual(outcomes)
        expect(h.reserve).toHaveBeenCalledTimes(outcomes.length)
        expect(h.settlements.map((item) => item.claim)).toEqual(outcomes.map((_, i) => i + 1))
        const liabilities = h.settlements.map(({ claim, outcome }) => {
          const maximum = h.maxima[claim - 1]
          if (maximum === undefined) throw new Error('maximum missing')
          if (outcome.kind === 'billed') return Number(outcome.usage.costUsd)
          return outcome.kind === 'ambiguous' ? Number(maximum.costUsd) : 0
        })
        const total = liabilities.reduce((sum, value) => sum + value, 0)
        let expected = 0
        for (const [i, kind] of outcomes.entries()) {
          if (kind === 'ambiguous') expected += Number(h.maxima[i]?.costUsd)
          else if (kind === 'billed') expected += 0.00002775
        }
        expect(total).toBeCloseTo(expected, 10)
        if (name === 'success') {
          await h.session.sendTurn([{ type: 'text', text: 'second' }])
          await h.turns.turnDone()
          expect(h.reserve).toHaveBeenCalledTimes(2)
          expect(h.settlements.map((item) => item.claim)).toEqual([1, 2])
        }
        const finalCount = h.settlements.length
        await h.host.close()
        expect(h.settlements).toHaveLength(finalCount)
      } finally {
        await h.host.close()
      }
    },
  )
})

it('R6 compaction: collected responses preserve per-attempt worker reservation and settlement', async () => {
  const h = await setup('muse-spark-1.3', [{ text: 'done', usage: { input: 12, output: 3 } }])
  try {
    await h.session.sendTurn([{ type: 'text', text: 'first' }])
    await h.turns.turnDone()
    h.api.script(
      { httpError: { status: 503 } },
      { text: 'summary', usage: { input: 12, output: 3 } },
    )
    await h.session.compact()
    expect(h.settlements.map((item) => item.outcome.kind)).toEqual([
      'billed',
      'ambiguous',
      'billed',
    ])
    expect(h.settlements.map((item) => item.claim)).toEqual([1, 2, 3])
  } finally {
    await h.host.close()
  }
})

it.each(
  ['turn', 'compaction'].flatMap((request) =>
    ['before reservation', 'during reservation', 'before attachment', 'after attachment'].map(
      (stage) => ({ request, stage }),
    ),
  ),
)(
  'R7 lifetime: cancel $request $stage releases every unsent claim once',
  async ({ request, stage }) => {
    const reached = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    let isArmed = false
    const hold = async () => {
      if (!isArmed) return
      reached.resolve(undefined)
      await resume.promise
    }
    const h = await setup('muse-spark-1.3', [{ text: 'done', usage: { input: 12, output: 3 } }], {
      admission: {
        ...(stage === 'before reservation' && { prepare: hold }),
        ...(stage === 'during reservation' && { reserve: hold }),
        reserved: () => {
          if (isArmed && stage === 'before attachment') cancel()
        },
        attached: () => {
          if (isArmed && stage === 'after attachment') cancel()
        },
      },
    })
    const cancel = () => {
      reached.resolve(undefined)
      void h.session.cancel()
    }
    try {
      if (request === 'compaction') {
        await h.session.sendTurn([{ type: 'text', text: 'first' }])
        await h.turns.turnDone()
      }
      isArmed = true
      const ended =
        request === 'compaction'
          ? h.session.compact()
          : (async () => {
              await h.session.sendTurn([{ type: 'text', text: 'work' }])
              await h.turns.turnDone()
            })()
      await reached.promise
      await h.session.cancel()
      if (request === 'compaction') await ended
      const hasReplacement = request === 'compaction' && stage === 'during reservation'
      if (hasReplacement) {
        isArmed = false
        h.api.script({ text: 'replacement', usage: { input: 12, output: 3 } })
        await h.session.sendTurn([{ type: 'text', text: 'replacement' }])
        await h.turns.turnDone()
      }
      resume.resolve(undefined)
      await ended
      // Drain the held promise's continuations, including an abandoned compaction stream.
      await new Promise<void>((resolve) => setImmediate(resolve))
      isArmed = false
      expect(h.api.responseBodies()).toHaveLength(
        (request === 'compaction' ? 1 : 0) + (hasReplacement ? 1 : 0),
      )
      expect(h.reserve).toHaveBeenCalledTimes(
        (request === 'compaction' ? 1 : 0) +
          (stage === 'before reservation' ? 0 : 1) +
          (hasReplacement ? 1 : 0),
      )
      expect(h.settlements.map((item) => item.outcome.kind)).toEqual([
        ...(request === 'compaction' ? ['billed'] : []),
        ...(hasReplacement ? ['billed'] : []),
        ...(stage === 'before reservation' ? [] : ['released']),
      ])
      expect(new Set(h.settlements.map((item) => item.claim)).size).toBe(h.settlements.length)
      await h.host.close()
      expect(h.settlements).toHaveLength(h.reserve.mock.calls.length)
    } finally {
      resume.resolve(undefined)
      await h.host.close()
    }
  },
)

it('R7 lifetime: cancel during prior settlement never prepares a replacement attempt', async () => {
  const reached = Promise.withResolvers<undefined>()
  const resume = Promise.withResolvers<undefined>()
  const h = await setup('muse-spark-1.3', [{ httpError: { status: 503 } }], {
    admission: {
      settle: async () => {
        reached.resolve(undefined)
        await resume.promise
      },
    },
  })
  try {
    await h.session.sendTurn([{ type: 'text', text: 'work' }])
    await reached.promise
    await h.session.cancel()
    resume.resolve(undefined)
    await h.turns.turnDone()
    expect(h.prepares()).toBe(1)
    expect(h.reserve).toHaveBeenCalledTimes(1)
    expect(h.settlements.map((item) => item.outcome.kind)).toEqual(['ambiguous'])
    expect(h.api.responseBodies()).toHaveLength(1)
  } finally {
    resume.resolve(undefined)
    await h.host.close()
  }
})
