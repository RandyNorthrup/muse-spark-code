import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type * as vscode from 'vscode'
import { PROVIDER_SECRET_PREFIX, UI_TEXT } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import type { UsageRecording } from '../../src/core/usage/recording'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelApiHost, type ModelApiHostDeps } from '../../src/core/backends/modelapi/ModelApiHost'
import {
  createProviderRegistry,
  type RegistryModel,
} from '../../src/core/providers/providerRegistry'
import { parseHookConfig } from '../../src/core/backends/modelapi/hooks'
import {
  createSubscriptionClient,
  type SubscriptionRegistryDeps,
} from '../../src/core/providers/subscriptions/registry'
import {
  providerEntrySchema,
  writeProvidersFileAtomic,
  type ProvidersFile,
} from '../../src/core/providers/providersFile'
import { createConfiguredProviderServices } from '../../src/core/providers/configured'
import {
  type CreateResponseBody,
  type StreamEvent,
  streamEventSchema,
} from '../../src/core/backends/modelapi/schemas'
import type { ConfirmedModelRequest } from '../../src/core/backends/modelapi/transport'
import type { ProviderClient } from '../../src/core/backends/modelapi/client'
import { connectCopilotFromClick, type CopilotPort } from '../../src/host/providers/copilotClient'
import { ChatGptSignIn, type ChatGptHostPort } from '../../src/core/providers/subscriptions/chatgpt'
import * as responsesCodec from '../../src/core/backends/modelapi/codecs/responses'
import {
  fakeModelApi,
  fakeModelApiClient,
  fakeModelApiClientSettings,
  FAKE_MODEL_API_ACCOUNT_ID,
  FAKE_MODEL_API_BASE_URL,
  FAKE_MODEL_API_KEY,
  TINY_PNG_BASE64,
} from './helpers/fakeModelApi'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel, memorySecrets } from './helpers/fakes'
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
  clientFactory = (api: Parameters<typeof fakeModelApiClient>[0], log: FakeLogOutputChannel) =>
    new ModelApiClient({
      ...fakeModelApiClientSettings(log),
      baseUrl: `${source.origin}/v1`,
      fetch: api.fetch,
    }),
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
        { sessionBudgetUsd: () => Usd.from(0.09).toAmount() },
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
        expect(total?.spentUsd).toBe(Usd.from(count === 1 ? 0.05 : 0).toAmount())
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
    const io = memoryToolIo({ 'a.txt': 'actual workspace contents' }, '/ws')
    io.runHook = (_command, payload) => {
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
    const h = await setup(
      { io, loadHooks: () => Promise.resolve(hooks.hooks) },
      model,
      () => isCurrent,
    )
    try {
      await h.send()
      expect(isCurrent).toBe(false)
      expect(h.provider.responseBodies()).toHaveLength(0)
    } finally {
      await h.host.close()
    }
  })

  it('settles provider-reported cost and rejects unpriced dispatch under a dollar cap', async () => {
    const priced = pricedModel
    const h = await setup(
      {
        sessionBudgetUsd: () => Usd.from(1).toAmount(),
        getAccountId: () => Promise.resolve('profile-owner'),
      },
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
      expect(total?.spentUsd).toBe(Usd.from(0.123).toAmount())
    } finally {
      await h.host.close()
    }
    const unknown = await setup(
      { sessionBudgetUsd: () => Usd.from(1).toAmount() },
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
          sessionBudgetUsd: () => Usd.from(1).toAmount(),
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
        expect(Number(total?.spentUsd)).toBeCloseTo(outcome === 'refused' ? 0.00004 : 0.00006, 8)
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
        sessionBudgetUsd: () => Usd.from(1).toAmount(),
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
      expect(Number(total?.spentUsd)).toBeGreaterThan(0)
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

  it('names the hook call when a plan confirmation lapses on a subscription record', async () => {
    // RVCM1062E P3: a hook-model run has no schedule, so its stale
    // confirmation names the hook call instead of borrowing schedule guidance.
    const file: ProvidersFile = {
      v: 1,
      providers: [
        providerEntrySchema.parse({
          id: 'copilot',
          preset: 'copilot',
          address: 'https://github.com/copilot',
          auth: 'subscription',
          format: 'chat',
          models: ['claude-test'],
        }),
      ],
    }
    const meta = fakeModelApiClient(fakeModelApi(), new FakeLogOutputChannel())
    const client = createSubscriptionClient(meta, {
      fetch: () => Promise.reject(new Error('no HTTP past the refusal')),
      providers: () => Promise.resolve(file),
      chatgpt: () => Promise.reject(new Error('no ChatGPT sign-in in this test')),
      accountId: () => Promise.resolve('test-account'),
    })
    const body = planBody('copilot/claude-test')
    // A lapsed Copilot confirmation surfaces as an error event carrying the
    // refusal, so the test reads the event instead of a rejection.
    const events = await streamPlanConfirmed(client, body, {
      modelId: body.model,
      keyDigest: 'stale',
      runKind: 'hookModel',
      isAllowed: false,
    })
    const message = refusalOf(events, 'a refusal error event')
    expect(message).toContain(UI_TEXT.requestStaleHookModel)
    expect(message).not.toContain('schedule')
  })
  it('refuses a lapsed record with neutral retry guidance', async () => {
    // RVCM1062E P3: registry resolution knows no operation, so its
    // stale-record refusal retries neutrally instead of naming a schedule.
    const api = fakeModelApi()
    const client = fakeModelApiClient(api, new FakeLogOutputChannel())
    const registry = createProviderRegistry({
      models: () => Promise.resolve([model]),
      createClient: () => Promise.resolve(client),
      isCurrent: () => false,
    })
    await expect(registry.resolve(ref)).rejects.toThrow(UI_TEXT.requestStaleRetry)
    expect(api.responseBodies()).toHaveLength(0)
  })
})

function planBody(model: string): CreateResponseBody {
  return {
    model,
    instructions: 'Test',
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    tools: [],
    tool_choice: 'auto',
    stream: true,
    store: false,
    prompt_cache_key: 'test-cache',
    prompt_cache_retention: 'in_memory',
    max_output_tokens: 64,
    reasoning: { effort: 'none' },
    include: [],
  }
}

function noChatGpt(): Promise<never> {
  return Promise.reject(new Error('no ChatGPT sign-in in this test'))
}

interface PlanConfirmedGate {
  readonly modelId: string
  readonly keyDigest: string
  readonly runKind: ConfirmedModelRequest['runKind']
  readonly isAllowed: boolean
}

async function streamPlanConfirmed(
  client: Pick<ProviderClient, 'streamResponse'>,
  body: CreateResponseBody,
  gate: PlanConfirmedGate,
): Promise<StreamEvent[]> {
  return await Array.fromAsync(
    client.streamResponse(body, new AbortController().signal, undefined, undefined, undefined, {
      modelId: gate.modelId,
      keyDigest: gate.keyDigest,
      ...(gate.runKind !== undefined && { runKind: gate.runKind }),
      isStillAllowed: () => gate.isAllowed,
      onRequestStarted: () => undefined,
    }),
  )
}

function refusalOf(events: readonly StreamEvent[], what: string): string {
  expect(events).toHaveLength(1)
  const first = events[0]
  if (first?.type !== 'error') throw new Error(`expected ${what}`)
  return first.message
}

describe('plan-model confirmed runs', () => {
  // RVCM1062F P3: a confirmed run (hook model, review, scheduled prompt) may
  // use a plan model. The subscription client proceeds while the confirmation
  // is still allowed and refuses with the run's guidance only once lapsed.
  const copilotFile: ProvidersFile = {
    v: 1,
    providers: [
      providerEntrySchema.parse({
        id: 'copilot',
        preset: 'copilot',
        address: 'https://github.com/copilot',
        auth: 'subscription',
        format: 'chat',
        models: ['claude-test'],
      }),
    ],
  }
  const chatgptFile: ProvidersFile = {
    v: 1,
    providers: [
      providerEntrySchema.parse({
        id: 'chatgpt',
        preset: 'chatgpt',
        address: 'https://api.openai.com',
        auth: 'subscription',
        format: 'responses',
        models: ['gpt-6-astra'],
      }),
    ],
  }
  function planClient(
    dispatched: CreateResponseBody[],
    file: ProvidersFile,
    chatgpt: () => Promise<never>,
  ) {
    const meta = fakeModelApiClient(fakeModelApi(), new FakeLogOutputChannel())
    const adapter = {
      streamResponse: async function* (body: CreateResponseBody): AsyncGenerator<StreamEvent> {
        dispatched.push(body)
        await Promise.resolve()
        yield {
          type: 'response.completed',
          response: { id: 'plan-confirmed', status: 'completed', output: [] },
        }
      },
      countInputTokens: (): Promise<number> => Promise.resolve(1),
    }
    return createSubscriptionClient(meta, {
      fetch: () => Promise.reject(new Error('no HTTP past the refusal')),
      providers: () => Promise.resolve(file),
      chatgpt,
      accountId: () => Promise.resolve('test-account'),
      copilot: () => new Map([['claude-test', adapter]]),
    })
  }
  const runKinds: { readonly runKind: ConfirmedModelRequest['runKind']; readonly stale: string }[] =
    [
      { runKind: 'hookModel', stale: UI_TEXT.requestStaleHookModel },
      { runKind: 'scheduled', stale: UI_TEXT.scheduleConfirmationExpired },
      { runKind: 'review', stale: UI_TEXT.scheduleConfirmationExpired },
      { runKind: undefined, stale: UI_TEXT.scheduleConfirmationExpired },
    ]
  for (const { runKind, stale } of runKinds) {
    const name = runKind ?? 'unmarked'
    const gate = (isAllowed: boolean): PlanConfirmedGate => ({
      modelId: 'copilot/claude-test',
      keyDigest: isAllowed ? 'test-account' : 'stale',
      runKind,
      isAllowed,
    })
    it(`dispatches a still-allowed ${name} confirmation on a plan model`, async () => {
      const dispatched: CreateResponseBody[] = []
      const client = planClient(dispatched, copilotFile, noChatGpt)
      const body = planBody('copilot/claude-test')
      const events = await streamPlanConfirmed(client, body, gate(true))
      // The adapter receives the catalogue model id, and the run completes.
      expect(dispatched).toHaveLength(1)
      expect(dispatched[0]?.model).toBe('claude-test')
      expect(events.at(-1)?.type).toBe('response.completed')
    })
    it(`refuses a lapsed ${name} confirmation on a plan model before dispatch`, async () => {
      const dispatched: CreateResponseBody[] = []
      const client = planClient(dispatched, copilotFile, noChatGpt)
      const body = planBody('copilot/claude-test')
      const events = await streamPlanConfirmed(client, body, gate(false))
      expect(dispatched).toHaveLength(0)
      const message = refusalOf(events, 'a refusal error event')
      expect(message).toContain(stale)
      if (runKind === 'hookModel') expect(message).not.toContain('schedule')
    })
  }
  it('refuses a still-allowed confirmation for another model on a plan model', async () => {
    const dispatched: CreateResponseBody[] = []
    const client = planClient(dispatched, copilotFile, noChatGpt)
    const body = planBody('copilot/claude-test')
    const events = await streamPlanConfirmed(client, body, {
      modelId: 'copilot/other-model',
      keyDigest: 'test-account',
      runKind: 'hookModel',
      isAllowed: true,
    })
    expect(dispatched).toHaveLength(0)
    expect(refusalOf(events, 'a refusal error event')).toContain(UI_TEXT.requestStaleHookModel)
  })
  it('refuses a lapsed confirmation on a ChatGPT plan model before sign-in', async () => {
    const chatgpt = vi.fn(noChatGpt)
    const dispatched: CreateResponseBody[] = []
    const client = planClient(dispatched, chatgptFile, chatgpt)
    const body = planBody('chatgpt/gpt-6-astra')
    const events = await streamPlanConfirmed(client, body, {
      modelId: body.model,
      keyDigest: 'stale',
      runKind: 'hookModel',
      isAllowed: false,
    })
    expect(chatgpt).not.toHaveBeenCalled()
    // RVCM1062G P3: a lapsed confirmation names the run instead of the
    // generic plan retry sentence; the refusal still happens before sign-in.
    expect(refusalOf(events, 'a refusal error event')).toContain(UI_TEXT.requestStaleHookModel)
  })
  it('passes a still-allowed confirmation on a ChatGPT plan model to sign-in', async () => {
    const chatgpt = vi.fn(() => Promise.reject(new Error('synthetic sign-in failure')))
    const dispatched: CreateResponseBody[] = []
    const client = planClient(dispatched, chatgptFile, chatgpt)
    const body = planBody('chatgpt/gpt-6-astra')
    const events = await streamPlanConfirmed(client, body, {
      modelId: body.model,
      keyDigest: 'test-account',
      runKind: 'hookModel',
      isAllowed: true,
    })
    // Past the confirmation gate: sign-in was attempted, and the failure is
    // the sign-in failure, never the stale-confirmation refusal.
    expect(chatgpt).toHaveBeenCalledTimes(1)
    expect(refusalOf(events, 'a sign-in error event')).toBe(UI_TEXT.planUi.retry)
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

describe('confirmed-dispatch lifecycle across every branch', () => {
  // RVCM1062G: the plan-model branch must do everything the other provider
  // branches do around a confirmed dispatch, in the same order. One table
  // runs Model API, configured provider, Copilot and ChatGPT plan through
  // the same lifecycle assertions for each run kind.
  const roots: string[] = []
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  type RunScenario = 'allowed' | 'lapsed' | 'lapsing' | 'mismatched' | 'aborted'
  interface LifecycleOutcome {
    readonly status: 'completed' | 'refused'
    readonly refusal: string
    readonly dispatched: boolean
    readonly startedCalls: number
  }
  interface LifecycleBranch {
    readonly name: string
    /** How this branch surfaces a stale refusal: a throw or an error event. */
    readonly refusalText: (stale: string) => string
    drive(
      scenario: RunScenario,
      runKind: ConfirmedModelRequest['runKind'],
    ): Promise<LifecycleOutcome>
  }

  async function collectLifecycle(
    stream: AsyncGenerator<StreamEvent>,
    isDispatched: () => boolean,
    startedCalls: () => number,
  ): Promise<LifecycleOutcome> {
    try {
      let status: LifecycleOutcome['status'] = 'completed'
      let refusal = ''
      for await (const event of stream) {
        expect(streamEventSchema.safeParse(event).success).toBe(true)
        if (event.type !== 'error') continue
        status = 'refused'
        refusal = event.message
      }
      return { status, refusal, dispatched: isDispatched(), startedCalls: startedCalls() }
    } catch (error) {
      return {
        status: 'refused',
        refusal: error instanceof Error ? error.message : String(error),
        dispatched: isDispatched(),
        startedCalls: startedCalls(),
      }
    }
  }

  function lifecycleSignal(scenario: RunScenario): AbortSignal {
    const stop = new AbortController()
    if (scenario === 'aborted') stop.abort()
    return stop.signal
  }

  function lifecycleGuard(scenario: RunScenario, state: { allowed: boolean }) {
    return Object.assign(
      vi.fn(() => {
        if (scenario === 'lapsing') state.allowed = false
      }),
      { onRequestStarted: vi.fn() },
    )
  }

  function lifecycleRegistryClient(
    file: ProvidersFile,
    overrides: {
      readonly fetch: typeof fetch
      readonly chatgpt: SubscriptionRegistryDeps['chatgpt']
      readonly copilot?: SubscriptionRegistryDeps['copilot']
    },
  ) {
    const meta = fakeModelApiClient(fakeModelApi(), new FakeLogOutputChannel())
    return createSubscriptionClient(meta, {
      fetch: overrides.fetch,
      providers: () => Promise.resolve(file),
      chatgpt: overrides.chatgpt,
      accountId: () => Promise.resolve('lifecycle-account'),
      ...(overrides.copilot !== undefined && { copilot: overrides.copilot }),
    })
  }

  const MODEL_API_MODEL = 'muse-spark-1.3'
  const modelApiBranch: LifecycleBranch = {
    name: 'model-api',
    refusalText: (stale) => stale,
    drive: async (scenario, runKind) => {
      const api = fakeModelApi()
      const log = new FakeLogOutputChannel()
      const client = new ModelApiClient({
        ...fakeModelApiClientSettings(log),
        baseUrl: FAKE_MODEL_API_BASE_URL,
        fetch: api.fetch,
      })
      const state = { allowed: scenario !== 'lapsed' }
      const started = vi.fn()
      const guard = lifecycleGuard(scenario, state)
      const stream = client.streamResponse(
        { ...planBody(MODEL_API_MODEL), instructions: 'be brief' },
        lifecycleSignal(scenario),
        undefined,
        undefined,
        guard,
        {
          modelId: scenario === 'mismatched' ? 'other/model' : MODEL_API_MODEL,
          keyDigest: FAKE_MODEL_API_ACCOUNT_ID,
          ...(runKind !== undefined && { runKind }),
          isStillAllowed: () => state.allowed,
          onRequestStarted: started,
        },
      )
      return await collectLifecycle(
        stream,
        () => api.responseBodies().length > 0,
        () => started.mock.calls.length,
      )
    },
  }

  function lifecyclePinnedResponse(): {
    readonly status: number
    readonly headers: Record<string, string>
    readonly body: AsyncGenerator<Uint8Array>
    readonly close: () => void
  } {
    return {
      status: 200,
      headers: {},
      body: (async function* (): AsyncGenerator<Uint8Array> {
        await Promise.resolve()
        yield new Uint8Array(0)
      })(),
      close: () => undefined,
    }
  }

  const CONFIGURED_REF = 'openai-lifecycle/gpt-5.6-luna'
  async function driveConfiguredProvider(
    scenario: RunScenario,
    runKind: ConfirmedModelRequest['runKind'],
    origin: string | undefined,
  ): Promise<LifecycleOutcome> {
    const root = await mkdtemp(path.join(tmpdir(), 'm106-lifecycle-'))
    roots.push(root)
    const secrets = memorySecrets()
    const entry = providerEntrySchema.parse({
      id: 'openai-lifecycle',
      preset: 'openai',
      address: 'https://api.openai.com',
      format: 'responses',
      auth: 'apiKey',
      models: ['gpt-5.6-luna'],
    })
    secrets.values.set(
      `${PROVIDER_SECRET_PREFIX}${entry.id}`,
      JSON.stringify({
        v: 1,
        auth: 'apiKey',
        origin: entry.address ?? '',
        secret: 'lifecycle-key',
      }),
    )
    const configFile = path.join(root, 'providers.json')
    const written = await writeProvidersFileAtomic(configFile, {
      v: 1,
      providers: [entry],
      defaultModel: CONFIGURED_REF,
    })
    expect(written.ok).toBe(true)
    const send = vi.fn(() => Promise.resolve(lifecyclePinnedResponse()))
    const services = createConfiguredProviderServices(
      fakeModelApiClient(fakeModelApi(), new FakeLogOutputChannel()),
      {
        configFile,
        catalogFile: path.resolve('vendor/models-dev/snapshot.json'),
        secrets,
        resolve: () => Promise.resolve(['8.8.8.8']),
        send,
      },
    )
    const resolved = await services.registry.resolve(CONFIGURED_REF)
    const state = { allowed: scenario !== 'lapsed' }
    const started = vi.fn()
    const guard = lifecycleGuard(scenario, state)
    // The bytes never matter here: the stubbed decoder yields the completed
    // event, so no captured wire shape is parsed.
    const codec = responsesCodec.createResponsesCodec({
      sendPromptCacheRetention: false,
      sendPromptCacheKey: false,
    })
    const spy = vi.spyOn(responsesCodec, 'createResponsesCodec').mockReturnValue({
      ...codec,
      decodeStream: async function* (): AsyncGenerator<StreamEvent> {
        await Promise.resolve()
        yield {
          type: 'response.completed',
          response: { id: 'lifecycle', status: 'completed', output: [] },
        }
      },
    })
    try {
      const stream = resolved.client.streamResponse(
        { ...planBody(CONFIGURED_REF), instructions: 'Test' },
        lifecycleSignal(scenario),
        undefined,
        undefined,
        guard,
        {
          modelId: scenario === 'mismatched' ? 'openai-lifecycle/other' : CONFIGURED_REF,
          keyDigest: await resolved.client.currentKeyDigest(),
          // The production schedule and hook confirmations leave origin
          // unset; the bound client adds only the provider id. An origin
          // here exercises the review-style confirmation that carries one.
          ...(origin !== undefined && { origin }),
          ...(runKind !== undefined && { runKind }),
          isStillAllowed: () => state.allowed,
          onRequestStarted: started,
        },
      )
      return await collectLifecycle(
        stream,
        () => send.mock.calls.length > 0,
        () => started.mock.calls.length,
      )
    } finally {
      spy.mockRestore()
    }
  }

  const configuredBranch: LifecycleBranch = {
    name: 'configured-provider',
    // A lapse keeps the run's own guidance (RVCM1062H): the bound client
    // rethrows the shared helper's refusal instead of its unavailable text.
    refusalText: (stale) => stale,
    drive: (scenario, runKind) =>
      driveConfiguredProvider(scenario, runKind, 'https://api.openai.com'),
  }
  const configuredScheduleBranch: LifecycleBranch = {
    name: 'configured-provider-schedule',
    // The production schedule/hook path exactly as the client builds it: the
    // confirmation carries no origin and no provider id, and the bound client
    // under test adds only the provider id before the shared gate.
    refusalText: (stale) => stale,
    drive: (scenario, runKind) => driveConfiguredProvider(scenario, runKind, undefined),
  }

  class LifecycleText implements vscode.LanguageModelTextPart {
    public constructor(public value: string) {}
  }
  class LifecycleCall implements vscode.LanguageModelToolCallPart {
    public constructor(
      public callId: string,
      public name: string,
      public input: object,
    ) {}
  }
  class LifecycleResult implements vscode.LanguageModelToolResultPart {
    public constructor(
      public callId: string,
      public content: unknown[],
    ) {}
  }
  function lifecycleMessage(
    role: vscode.LanguageModelChatMessageRole,
    text: string,
  ): vscode.LanguageModelChatMessage {
    return { role, content: text === '' ? [] : [new LifecycleText(text)], name: undefined }
  }

  const copilotBranch: LifecycleBranch = {
    name: 'copilot',
    refusalText: (stale) => stale,
    drive: async (scenario, runKind) => {
      const state = { allowed: scenario !== 'lapsed' }
      const sendRequest = vi.fn(() =>
        Promise.resolve({
          stream: (async function* () {
            await Promise.resolve()
            yield new LifecycleText('lifecycle answer')
          })(),
          text: (async function* () {
            await Promise.resolve()
            yield 'lifecycle answer'
          })(),
        }),
      )
      const model: vscode.LanguageModelChat = {
        id: 'synthetic-model',
        name: 'Synthetic Model',
        vendor: 'copilot',
        family: 'synthetic',
        version: '1',
        maxInputTokens: 1000,
        countTokens: vi.fn(() => {
          if (scenario === 'lapsing') state.allowed = false
          return Promise.resolve(2)
        }),
        sendRequest,
      }
      const api: CopilotPort = {
        selectChatModels: () => Promise.resolve([model]),
        user: (text) => lifecycleMessage(1, text),
        assistant: (text) => lifecycleMessage(2, text),
        text: (text) => new LifecycleText(text),
        call: (id, name, input) => new LifecycleCall(id, name, input),
        result: (id, content) => new LifecycleResult(id, content),
        // The lifecycle never aborts mid-tokenize: a static token suffices,
        // unlike the cancellation handoff the adapter suite covers.
        cancellation: () => {
          const idle: vscode.Disposable = { dispose: () => undefined }
          return {
            token: {
              isCancellationRequested: false,
              onCancellationRequested: () => idle,
            },
            cancel: () => undefined,
            dispose: () => undefined,
          }
        },
        isText: (part): part is vscode.LanguageModelTextPart => part instanceof LifecycleText,
        isCall: (part): part is vscode.LanguageModelToolCallPart => part instanceof LifecycleCall,
      }
      const clients = await connectCopilotFromClick({
        api,
        justification: () => 'lifecycle justification',
        failureText: (code) => `lifecycle.${code}`,
        isConfidential: () => false,
        isUserInitiated: () => true,
        canSendRequest: () => true,
        recordEstimatedUsage: vi.fn(),
      })
      const adapter = clients[0]
      if (adapter === undefined) throw new Error('expected one lifecycle Copilot client')
      const file: ProvidersFile = {
        v: 1,
        providers: [
          providerEntrySchema.parse({
            id: 'copilot',
            preset: 'copilot',
            address: 'https://github.com/copilot',
            auth: 'subscription',
            format: 'chat',
            models: ['synthetic-model'],
          }),
        ],
      }
      const started = vi.fn()
      const client = lifecycleRegistryClient(file, {
        fetch: () => Promise.reject(new Error('no HTTP past the refusal')),
        chatgpt: () => Promise.reject(new Error('no ChatGPT sign-in in this test')),
        copilot: () => new Map([['synthetic-model', adapter]]),
      })
      const stream = client.streamResponse(
        planBody('copilot/synthetic-model'),
        lifecycleSignal(scenario),
        undefined,
        undefined,
        undefined,
        {
          modelId: scenario === 'mismatched' ? 'copilot/other-model' : 'copilot/synthetic-model',
          keyDigest: 'lifecycle-account',
          ...(runKind !== undefined && { runKind }),
          isStillAllowed: () => state.allowed,
          onRequestStarted: started,
        },
      )
      return await collectLifecycle(
        stream,
        () => sendRequest.mock.calls.length > 0,
        () => started.mock.calls.length,
      )
    },
  }

  const chatgptBranch: LifecycleBranch = {
    name: 'chatgpt-plan',
    refusalText: (stale) => stale,
    drive: async (scenario, runKind) => {
      const state = { allowed: scenario !== 'lapsed' }
      const port: ChatGptHostPort = {
        hostId: 'lifecycle-host',
        fetch: () => Promise.reject(new Error('no network in the lifecycle test')),
        now: () => Date.now(),
        openBrowser: () => Promise.reject(new Error('no browser in the lifecycle test')),
        startCallback: () => Promise.reject(new Error('no callback in the lifecycle test')),
        readRecord: () =>
          Promise.resolve({
            v: 1,
            auth: 'subscription',
            origin: 'https://api.openai.com',
            issuer: 'https://auth.openai.com',
            clientId: 'lifecycle-client',
            hostId: 'lifecycle-host',
            accessToken: 'lifecycle-access',
            refreshToken: 'lifecycle-refresh',
            expiresAt: Date.now() + 3600 * 1000,
            scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
            nonce: 'lifecycle-nonce',
          }),
        writeRecord: () => Promise.resolve(),
        deleteRecord: () => Promise.resolve(),
        withRefreshLock: <T>(work: () => Promise<T>): Promise<T> => work(),
      }
      const signIn = new ChatGptSignIn(port)
      if (scenario === 'lapsing') {
        const token = signIn.accessToken.bind(signIn)
        vi.spyOn(signIn, 'accessToken').mockImplementation(
          async (requestUrl, minimumValidityMs) => {
            state.allowed = false
            return await token(requestUrl, minimumValidityMs)
          },
        )
      }
      // The frame mirrors the codec test's created fixture; the run completes
      // on first contact without parsing any new wire shape.
      const fetch = vi.fn(() => {
        const frame = `data: ${JSON.stringify({
          type: 'response.created',
          response: {
            id: 'resp_lifecycle',
            status: 'in_progress',
            output: [],
            usage: null,
            prompt_cache_key: 'lifecycle',
          },
        })}\n\n`
        const bytes = new TextEncoder().encode(frame)
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(bytes)
                controller.close()
              },
            }),
            { status: 200 },
          ),
        )
      })
      const file: ProvidersFile = {
        v: 1,
        providers: [
          providerEntrySchema.parse({
            id: 'chatgpt',
            preset: 'chatgpt',
            address: 'https://api.openai.com',
            auth: 'subscription',
            format: 'responses',
            models: ['gpt-6-astra'],
          }),
        ],
      }
      const started = vi.fn()
      const client = lifecycleRegistryClient(file, {
        fetch,
        chatgpt: () => Promise.resolve(signIn),
      })
      const body = planBody('chatgpt/gpt-6-astra')
      const stream = client.streamResponse(
        body,
        lifecycleSignal(scenario),
        undefined,
        undefined,
        undefined,
        {
          modelId: scenario === 'mismatched' ? 'chatgpt/other-model' : body.model,
          keyDigest: 'lifecycle-account',
          ...(runKind !== undefined && { runKind }),
          isStillAllowed: () => state.allowed,
          onRequestStarted: started,
        },
      )
      return await collectLifecycle(
        stream,
        () => fetch.mock.calls.length > 0,
        () => started.mock.calls.length,
      )
    },
  }

  const branches: readonly LifecycleBranch[] = [
    modelApiBranch,
    configuredBranch,
    configuredScheduleBranch,
    copilotBranch,
    chatgptBranch,
  ]
  const staleFor = (runKind: ConfirmedModelRequest['runKind']): string =>
    runKind === 'hookModel' ? UI_TEXT.requestStaleHookModel : UI_TEXT.scheduleConfirmationExpired
  const lifecycleKinds: readonly ConfirmedModelRequest['runKind'][] = [
    'hookModel',
    'scheduled',
    'review',
    undefined,
  ]
  for (const branch of branches) {
    for (const runKind of lifecycleKinds) {
      const name = runKind ?? 'unmarked'
      const stale = staleFor(runKind)
      const expectRefused = async (scenario: 'lapsed' | 'lapsing'): Promise<void> => {
        const outcome = await branch.drive(scenario, runKind)
        expect(outcome.status).toBe('refused')
        expect(outcome.refusal).toBe(branch.refusalText(stale))
        expect(outcome.dispatched).toBe(false)
        expect(outcome.startedCalls).toBe(0)
      }
      it(`${branch.name} completes a still-allowed ${name} confirmation with one start receipt`, async () => {
        const outcome = await branch.drive('allowed', runKind)
        expect(outcome.status).toBe('completed')
        expect(outcome.dispatched).toBe(true)
        expect(outcome.startedCalls).toBe(1)
      })
      it(`${branch.name} refuses a lapsed ${name} confirmation before dispatch without a start receipt`, async () => {
        await expectRefused('lapsed')
      })
      it(`${branch.name} refuses a ${name} confirmation that lapses mid-dispatch`, async () => {
        await expectRefused('lapsing')
      })
    }
    it(`${branch.name} refuses a still-allowed confirmation for another model before dispatch`, async () => {
      const outcome = await branch.drive('mismatched', 'hookModel')
      expect(outcome.status).toBe('refused')
      expect(outcome.refusal).toBe(branch.refusalText(UI_TEXT.requestStaleHookModel))
      expect(outcome.dispatched).toBe(false)
      expect(outcome.startedCalls).toBe(0)
    })
    it(`${branch.name} aborts a stopped confirmation without dispatch or a start receipt`, async () => {
      const outcome = await branch.drive('aborted', 'scheduled')
      expect(outcome.status).toBe('refused')
      expect(outcome.dispatched).toBe(false)
      expect(outcome.startedCalls).toBe(0)
    })
  }
})
