import type { UsageRecording } from '../../src/core/usage/recording'
import { describe, expect, it, vi } from 'vitest'
import { ModelApiHost, type ModelApiHostDeps } from '../../src/core/backends/modelapi/ModelApiHost'
import {
  createProviderRegistry,
  type RegistryModel,
} from '../../src/core/providers/providerRegistry'
import { parseHookConfig } from '../../src/core/backends/modelapi/hooks'
import {
  fakeModelApi,
  fakeModelApiClient,
  fakeModelApiClientSettings,
  FAKE_MODEL_API_KEY,
  TINY_PNG_BASE64,
} from './helpers/fakeModelApi'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memorySessionStore } from './helpers/fakeSessionStore'
import { watchSessionTurns } from './helpers/sessionTurns'

const ref = 'team/small'
const model: RegistryModel = {
  ref,
  origin: 'https://provider.example.test',
  pricing: { kind: 'local' },
  evidence: {
    capabilities: { toolCalling: true },
    maxOutputTokens: 100,
    effortLevels: ['low', 'high'],
  },
}

const pricedModel: RegistryModel = {
  ...model,
  pricing: { kind: 'priced', card: { input: 0.000001, output: 0.000002, source: 'user' } },
}

async function setup(
  options: Partial<ModelApiHostDeps> = {},
  source: RegistryModel = model,
  isCurrent = () => true,
  clientFactory = fakeModelApiClient,
) {
  const meta = fakeModelApi()
  const provider = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({ 'a.txt': 'actual workspace contents' }, '/ws')
  const client = clientFactory(provider, log)
  const store = memorySessionStore()
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({
      client: fakeModelApiClient(meta, log),
      workspaceRoot: '/ws',
      io,
      log,
    }),
    store,
    models: createProviderRegistry({
      models: () => Promise.resolve([source]),
      createClient: () => Promise.resolve(client),
      isCurrent,
    }),
    ...options,
  })
  const session = await host.startSession({
    workspaceRoot: '/ws',
    modelId: source.ref,
    approvalMode: 'onRequest',
  })
  const watched = watchSessionTurns(session)
  const send = async () => {
    await session.sendTurn([{ type: 'text', text: 'read a.txt' }])
    await watched.turnDone()
  }
  return { host, session, meta, provider, io, store, send, ...watched }
}

describe('registry dispatch through the real host', () => {
  it('keeps the latest model selection when an earlier provider resolution finishes last', async () => {
    const entered = Promise.withResolvers<undefined>()
    const held = Promise.withResolvers<undefined>()
    const api = fakeModelApi()
    const client = fakeModelApiClient(api, new FakeLogOutputChannel())
    const first = { ...model, ref: 'team/first' }
    const last = { ...model, ref: 'team/last' }
    const h = await setup({
      models: createProviderRegistry({
        models: () => Promise.resolve([model, first, last]),
        createClient: async (chosen) => {
          if (chosen.ref === first.ref) {
            entered.resolve(undefined)
            await held.promise
          }
          return client
        },
        isCurrent: () => true,
      }),
    })
    try {
      const initial = h.session.setModel(first.ref)
      const refused = expect(initial).rejects.toThrow()
      await entered.promise
      await h.session.setModel(last.ref)
      held.resolve(undefined)
      await refused
      expect(await h.host.listModels(h.session.sessionId)).toContainEqual(
        expect.objectContaining({ modelId: last.ref, isActive: true }),
      )
    } finally {
      held.resolve(undefined)
      await h.host.close()
    }
  })

  it('refuses a source changed during the final credential read before HTTP dispatch', async () => {
    let isCurrent = true
    let reads = 0
    const h = await setup(
      {},
      model,
      () => isCurrent,
      (api, log) =>
        new ModelApiClient({
          ...fakeModelApiClientSettings(log),
          fetch: api.fetch,
          apiKey: () => {
            reads += 1
            if (reads === 3) isCurrent = false
            return Promise.resolve(FAKE_MODEL_API_KEY)
          },
        }),
    )
    try {
      await h.send()
      expect(reads).toBe(3)
      expect(h.provider.responseBodies()).toHaveLength(0)
    } finally {
      await h.host.close()
    }
  })

  it.each([1, 2])(
    'accounts for %s attached image fees before sending under a hard cap',
    async (count) => {
      const h = await setup(
        { sessionBudgetUsd: () => 0.09 },
        {
          ...model,
          pricing: { kind: 'priced', card: { input: 0, output: 0, image: 0.05, source: 'user' } },
          evidence: { ...model.evidence, capabilities: { toolCalling: true, vision: true } },
        },
      )
      try {
        const finished = h.turnDone()
        await h.session.sendTurn(
          Array.from({ length: count }, () => ({
            type: 'image',
            mediaType: 'image/png',
            base64Data: TINY_PNG_BASE64,
            width: 1,
            height: 1,
          })),
        )
        await finished
        expect(h.provider.responseBodies()).toHaveLength(count === 1 ? 1 : 0)
        const saved = await h.store.load(h.session.sessionId)
        const total = await h.store.budget?.read(h.session.sessionId, saved?.accountId ?? '')
        expect(total?.spentUsd).toBe(count === 1 ? 0.05 : 0)
      } finally {
        await h.host.close()
      }
    },
  )

  it('refuses an unsolicited tool call when tool capability is unknown', async () => {
    const h = await setup({}, { ...model, evidence: {} })
    try {
      h.provider.script(
        { calls: [{ name: 'read_file', arguments: '{"path":"a.txt"}', callId: 'read' }] },
        { text: 'done' },
      )
      await h.send()
      expect(h.provider.responseBodies()[0]?.['tools']).toEqual([])
      expect(JSON.stringify(h.provider.responseBodies()[1]?.['input'])).toContain(
        'no verified tool-calling capability',
      )
      expect(JSON.stringify(h.provider.responseBodies()[1]?.['input'])).not.toContain(
        'actual workspace contents',
      )
    } finally {
      await h.host.close()
    }
  })

  it('uses the separate Meta image credential while accounting to the BYO profile', async () => {
    const h = await setup({
      isPaidFeatureOn: (feature) => feature === 'imageGeneration',
      allowsPaidUse: () => Promise.resolve(true),
      getAccountId: () => Promise.resolve('profile-owner'),
      hasMetaCredential: () => true,
    })
    try {
      h.provider.script(
        {
          calls: [
            {
              name: 'generate_image',
              arguments: '{"prompt":"a cat","path":"picture.png"}',
              callId: 'image',
            },
          ],
        },
        { text: 'done' },
      )
      await h.send()
      expect(h.meta.imageBodies()).toHaveLength(1)
      expect(h.meta.responseBodies()).toHaveLength(0)
      expect(h.provider.imageBodies()).toHaveLength(0)
      expect(h.io.binaries.has('/ws/picture.png')).toBe(true)
    } finally {
      await h.host.close()
    }
  })

  it('runs an actual workspace tool through the selected client with its output and effort caps', async () => {
    const h = await setup()
    try {
      await h.session.setReasoningEffort('high')
      h.provider.script(
        { calls: [{ name: 'read_file', arguments: '{"path":"a.txt"}', callId: 'read' }] },
        { text: 'finished' },
      )
      await h.send()
      expect(h.meta.responseBodies()).toHaveLength(0)
      expect(h.provider.responseBodies()).toHaveLength(2)
      expect(h.provider.responseBodies()[0]).toMatchObject({
        model: ref,
        max_output_tokens: 100,
        reasoning: { effort: 'high' },
      })
      expect(JSON.stringify(h.provider.responseBodies()[1]?.['input'])).toContain(
        'actual workspace contents',
      )
      expect(h.events).toContainEqual(expect.objectContaining({ type: 'turnCompleted' }))
    } finally {
      await h.host.close()
    }
  })

  it('does not declare or ask for a Meta hosted tool on a model with unknown hosted capability', async () => {
    const consent = vi.fn(() => Promise.resolve(true))
    const h = await setup({ isPaidFeatureOn: () => true, allowsPaidUse: consent })
    try {
      await h.send()
      expect(consent).not.toHaveBeenCalled()
      expect(JSON.stringify(h.provider.responseBodies()[0]?.['tools'])).not.toContain(
        '"web_search"',
      )
    } finally {
      await h.host.close()
    }
  })

  it('refuses a provider resolution invalidated during a pre-call hook before sending', async () => {
    let isCurrent = true
    const hooks = parseHookConfig(
      JSON.stringify({
        hooks: {
          PreLLMCall: [{ matcher: 'team', hooks: [{ type: 'command', command: 'invalidate' }] }],
        },
      }),
      'user',
      'linux',
    )
    expect(hooks.hooks).toHaveLength(1)
    const h = await setup({ loadHooks: () => Promise.resolve(hooks.hooks) }, model, () => isCurrent)
    h.io.runHook = (_command, payload) => {
      expect(payload).toContain('"model_provider":"team"')
      isCurrent = false
      return Promise.resolve({
        exitCode: 0,
        stdout: '',
        stderr: '',
        isTimedOut: false,
        isCancelled: false,
      })
    }
    try {
      await h.send()
      expect(h.provider.responseBodies()).toHaveLength(0)
    } finally {
      await h.host.close()
    }
  })

  it('settles provider-reported cost and rejects unpriced dispatch under a dollar cap', async () => {
    const priced = pricedModel
    const h = await setup(
      { sessionBudgetUsd: () => 1, getAccountId: () => Promise.resolve('profile-owner') },
      priced,
    )
    try {
      h.provider.script({
        text: 'done',
        usageOverride: { input_tokens: 100, output_tokens: 1, provider_cost_usd: 0.123 },
      })
      await h.send()
      const stored = await h.store.load(h.session.sessionId)
      const total = await h.store.budget?.read(h.session.sessionId, stored?.accountId ?? '')
      expect(total?.spentUsd).toBe(0.123)
    } finally {
      await h.host.close()
    }
    const unknown = await setup(
      { sessionBudgetUsd: () => 1 },
      { ...model, pricing: { kind: 'unpriced' } },
    )
    try {
      await unknown.send()
      expect(unknown.provider.responseBodies()).toHaveLength(0)
    } finally {
      await unknown.host.close()
    }
  })

  it.each(['completed', 'incomplete', 'failed', 'refused'] as const)(
    'reviews on the resolved provider with its quote and a distinct profile accounting identity: %s',
    async (outcome) => {
      const recording = recordingPort()
      const consent = vi.fn(() => Promise.resolve(true))
      const priced = pricedModel
      const h = await setup(
        {
          isPaidFeatureOn: (feature) => feature === 'autoReviewer',
          allowsPaidUse: consent,
          usageRecording: recording,
          noteReviewerUsage: () => {
            throw new Error('Legacy observer has no provider tariff')
          },
          sessionBudgetUsd: () => 1,
          getAccountId: () => Promise.resolve('profile-owner'),
        },
        priced,
      )
      h.session.onEvent((event) => {
        if (event.type === 'approvalRequested')
          void h.session.decideApproval({
            approvalId: event.approvalId,
            requirementId: event.requirementId,
            choiceId: 'allow_once',
          })
      })
      try {
        h.provider.script(
          { calls: [{ name: 'bash', arguments: '{"command":"npm test"}', callId: 'check' }] },
          {
            text: 'ALLOW: runs the requested workspace checks',
            usage: { input: 10, output: 5 },
            ...(outcome === 'incomplete' && { incomplete: { reason: 'max_output_tokens' } }),
            ...(outcome === 'failed' && { failed: { code: 'model_failure', message: 'failed' } }),
            ...(outcome === 'refused' && { httpError: { status: 429 } }),
          },
          { text: 'done' },
        )
        await h.send()
        expect(recording.note).toHaveBeenCalledTimes(3)
        expect(vi.mocked(recording.note).mock.calls.map(([, call]) => call.kind)).toEqual([
          'turn',
          'reviewer',
          'turn',
        ])
        expect(vi.mocked(recording.note).mock.calls[1]?.[1]).toMatchObject({
          provider: 'team',
          model: ref,
          pricing: priced.pricing,
          outcome,
          ...(['completed', 'incomplete'].includes(outcome) && { served: ref }),
        })
        if (outcome === 'refused') {
          expect(recording.limit).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
              provider: 'team',
              raw: {},
              windows: [],
              source: 'headers',
            }),
            true,
          )
          expect(vi.mocked(recording.note).mock.calls[1]?.[1]).toMatchObject({ uncertain: false })
        }
        expect(h.provider.responseBodies()).toHaveLength(3)
        expect(h.meta.responseBodies()).toHaveLength(0)
        expect(h.provider.responseBodies()[1]).toMatchObject({
          model: ref,
          tools: [],
          max_output_tokens: 100,
        })
        expect(consent).toHaveBeenCalledWith(
          expect.objectContaining({
            feature: 'autoReviewer',
            modelId: ref,
            pricing: priced.pricing,
          }),
          false,
          h.session.sessionId,
        )
        const stored = await h.store.load(h.session.sessionId)
        const total = await h.store.budget?.read(h.session.sessionId, stored?.accountId ?? '')
        expect(total?.spentUsd).toBeCloseTo(outcome === 'refused' ? 0.00004 : 0.00006, 8)
      } finally {
        await h.host.close()
      }
    },
  )

  it('retains the reviewer reservation as uncertain when its counted one-hour writes cannot settle', async () => {
    const recording = recordingPort()
    const h = await setup(
      {
        usageRecording: recording,
        isPaidFeatureOn: (feature) => feature === 'autoReviewer',
        allowsPaidUse: () => Promise.resolve(true),
        sessionBudgetUsd: () => 1,
      },
      {
        ...model,
        pricing: {
          kind: 'priced',
          card: {
            input: 0.000001,
            output: 0.000002,
            cacheWrite: 0.000002,
            cacheWrite1h: 0.000004,
            source: 'user',
          },
        },
      },
    )
    try {
      h.provider.script(
        { calls: [{ name: 'bash', arguments: '{"command":"npm test"}', callId: 'check' }] },
        {
          text: 'ALLOW: runs the requested workspace checks',
          usageOverride: {
            input_tokens: 100,
            output_tokens: 1,
            input_tokens_details: { cache_write_tokens: 100, cache_write_tokens_1h: 50 },
          },
        },
        { text: 'must not dispatch through uncertain liability' },
      )
      await h.send()
      const stored = await h.store.load(h.session.sessionId)
      const total = await h.store.budget?.read(h.session.sessionId, stored?.accountId ?? '')
      expect(total?.hasUnknownHistoricalFees).toBe(true)
      expect(total?.spentUsd).toBeGreaterThan(0)
      expect(vi.mocked(recording.note).mock.calls[1]?.[0]?.input_tokens_details).toEqual({
        cache_write_tokens: 100,
        cache_write_tokens_1h: 50,
      })
      expect(h.provider.responseBodies()).toHaveLength(2)
    } finally {
      await h.host.close()
    }
  })

  it('invalidates a held reviewer confirmation after switching away and back to the same model', async () => {
    const entered = Promise.withResolvers<undefined>()
    const consent = Promise.withResolvers<boolean>()
    const priced = pricedModel
    const h = await setup(
      {
        store: undefined,
        isPaidFeatureOn: (feature) => feature === 'autoReviewer',
        allowsPaidUse: () => {
          entered.resolve(undefined)
          return consent.promise
        },
      },
      priced,
    )
    const approval =
      Promise.withResolvers<Extract<(typeof h.events)[number], { type: 'approvalRequested' }>>()
    h.session.onEvent((event) => {
      if (event.type === 'approvalRequested') approval.resolve(event)
    })
    const finished = h.turnDone()
    try {
      h.provider.script(
        { calls: [{ name: 'bash', arguments: '{"command":"npm test"}', callId: 'check' }] },
        { text: 'done' },
      )
      await h.session.sendTurn([{ type: 'text', text: 'run checks' }])
      await entered.promise
      await h.session.setModel('muse-spark-1.3')
      await h.session.setModel(ref)
      consent.resolve(true)
      const request = await approval.promise
      await h.session.decideApproval({
        approvalId: request.approvalId,
        requirementId: request.requirementId,
        choiceId: 'abort',
      })
      await finished
      expect(
        h.provider
          .responseBodies()
          .filter((body) => Array.isArray(body['tools']) && body['tools'].length === 0),
      ).toHaveLength(0)
      expect(h.meta.responseBodies()).toHaveLength(0)
    } finally {
      consent.resolve(false)
      await h.host.close()
    }
  })
})

function recordingPort(): UsageRecording {
  return {
    note: vi.fn(),
    limit: vi.fn(),
    today: () => Promise.resolve([]),
    flush: () => Promise.resolve(),
  }
}
