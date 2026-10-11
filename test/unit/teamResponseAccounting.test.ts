// RVCM963E: actual host/transport, fake captured wire. No live model calls.
import { describe, expect, it, vi } from 'vitest'
import { ModelApiClient, type ResponseAttemptGuard } from '../../src/core/backends/modelapi/client'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { createProviderRegistry } from '../../src/core/providers/providerRegistry'
import type { SubagentUsage } from '../../src/shared/paid'
import {
  fakeModelApi,
  fakeModelApiClientSettings,
  type ScriptedReply,
} from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { watchSessionTurns } from './helpers/sessionTurns'

async function setup(modelId: string, replies: ScriptedReply[], isRebuild = false) {
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
  const settlements: { claim: number; usage: SubagentUsage }[] = []
  const reserve = vi.fn(() => {
    const claim = reserve.mock.calls.length
    return Promise.resolve((usage: SubagentUsage) => {
      settlements.push({ claim, usage })
    })
  })
  let prepares = 0
  const guard: ResponseAttemptGuard = Object.assign(() => undefined, {
    prepare: () => {
      prepares += 1
      if (isRebuild && prepares === 1) generation += 1
      return Promise.resolve()
    },
    reserveUsage: reserve,
  })
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
  api.script(...replies)
  return { api, host, session, turns, reserve, settlements, noteUsage, prepares: () => prepares }
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
        const reported = h.settlements[0]?.usage
        expect(h.settlements[0]?.claim).toBe(1)
        expect(reported).toMatchObject({ inputTokens: 12, outputTokens: 3, cachedTokens: 2 })
        if (model === 'unknown-model') expect(reported?.costUsd).toBeUndefined()
        else if (model === 'bare-plan') expect(Number(reported?.costUsd)).toBe(0)
        else
          expect(Number(reported?.costUsd)).toBeCloseTo(
            model === 'provider/priced' ? 0.000018 : 0.00002555,
            10,
          )
        expect(h.noteUsage).toHaveBeenCalledExactlyOnceWith(
          model,
          expect.objectContaining(reported ?? {}),
        )
      } finally {
        await h.host.close()
      }
    },
  )

  it.each([
    { name: '429', failure: { httpError: { status: 429, retryAfter: '0' } } },
    { name: '503', failure: { httpError: { status: 503 } } },
    {
      name: 'pre-send failure',
      failure: { networkError: 'connection refused', networkErrorCode: 'ECONNREFUSED' },
    },
    { name: 'vault rebuild', failure: undefined },
  ])(
    'R5-2: $name retry reuses one live claim, next request gets its own',
    async ({ name, failure }) => {
      const success = { text: 'done', usage: { input: 12, output: 3 } }
      const h = await setup(
        'muse-spark-1.3',
        failure === undefined ? [success] : [failure, success],
        name === 'vault rebuild',
      )
      try {
        await h.session.sendTurn([{ type: 'text', text: 'first' }])
        await h.turns.turnDone()
        expect(h.prepares()).toBe(2)
        expect(h.reserve).toHaveBeenCalledTimes(1)
        expect(h.settlements.map((item) => item.claim)).toEqual([1])
        expect(h.api.responseBodies()).toHaveLength(name === 'vault rebuild' ? 1 : 2)
        await h.session.sendTurn([{ type: 'text', text: 'second' }])
        await h.turns.turnDone()
        expect(h.reserve).toHaveBeenCalledTimes(2)
        expect(h.settlements.map((item) => item.claim)).toEqual([1, 2])
      } finally {
        await h.host.close()
      }
    },
  )
})
