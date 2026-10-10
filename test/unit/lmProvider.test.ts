import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type * as vscode from 'vscode'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createEditorChat,
  type EditorChatDeps,
  type EditorChatProvider,
} from '../../src/host/models/lmProvider'
import { registerEditorChat } from '../../src/host/models/lmProviderBundle'
import { createTabLedger } from '../../src/host/tab/tabLedger'
import { modelPolicyFor, type ResolvedModel } from '../../src/core/backends/modelapi/modelPolicy'
import type { CreateResponseBody, StreamEvent } from '../../src/core/backends/modelapi/schemas'
import type { ModelPricing } from '../../src/core/providers/priceCard'
import { reserveRequestAmount, settleUsageAmount } from '../../src/core/providers/priceCard'
import { createProviderRegistry } from '../../src/core/providers/providerRegistry'
import { createUsageRecord } from '../../src/core/usage/journalRecord'
import * as atomic from '../../src/host/fsAtomic'
import { encodeGeminiRequest } from '../../src/core/backends/modelapi/codecs/gemini'
import { resolveModelCapabilities } from '../../src/core/providers/capabilityRecord'
import { Usd } from '../../src/shared/usd'
import { EN } from '../../src/shared/l10n/en'
import { UI_TEXT } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

const host = vi.hoisted(() => {
  class Text {
    public constructor(public readonly value: string) {}
  }
  class Call {
    public constructor(
      public readonly callId: string,
      public readonly name: string,
      public readonly input: object,
    ) {}
  }
  const config = new Map<string, unknown>()
  const dispose = vi.fn()
  const register = vi.fn((_vendor: string, _provider: unknown) => ({ dispose }))
  const change: { run?: (event: { affectsConfiguration(key: string): boolean }) => void } = {}
  return {
    LanguageModelTextPart: Text,
    LanguageModelToolCallPart: Call,
    LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
    LanguageModelChatToolMode: { Auto: 1, Required: 2 },
    ConfigurationTarget: { Global: 1 },
    lm: { registerLanguageModelChatProvider: register },
    config,
    dispose,
    register,
    change,
    window: { showWarningMessage: vi.fn(), showInputBox: vi.fn() },
    workspace: {
      isTrusted: true,
      getConfiguration: () => ({
        get: (key: string, fallback: unknown) => config.get(key) ?? fallback,
        update: (key: string, value: unknown) => {
          config.set(key, value)
          return Promise.resolve()
        },
      }),
      onDidChangeConfiguration: (
        run: (event: { affectsConfiguration(key: string): boolean }) => void,
      ) => {
        change.run = run
        return { dispose: vi.fn() }
      },
    },
  }
})
vi.mock('vscode', async (original) => ({ ...(await original<object>()), ...host }))

const folders: string[] = []
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => removeFolder(folder)))
  vi.clearAllMocks()
  vi.restoreAllMocks()
  host.config.clear()
  host.workspace.isTrusted = true
})
const ref = 'chosen/model'
const card = { input: 0.00001, output: 0.00002, cacheWrite: 0.00003, source: 'user' as const }
const token = () => {
  const listeners = new Set<() => unknown>()
  const state = { cancelled: false }
  const value: vscode.CancellationToken = {
    get isCancellationRequested() {
      return state.cancelled
    },
    onCancellationRequested: (run) => {
      const callback = () => {
        run(undefined)
      }
      listeners.add(callback)
      return {
        dispose: () => {
          listeners.delete(callback)
        },
      }
    },
  }
  return {
    value,
    cancel: () => {
      state.cancelled = true
      for (const run of listeners) run()
    },
    listeners,
  }
}
const completed: StreamEvent = {
  type: 'response.completed',
  response: {
    id: 'response',
    status: 'completed',
    output: [],
    usage: { input_tokens: 20, output_tokens: 10 },
  },
}
const messages = [{ role: 1, content: [{ value: 'hello' }] }]
const defaultPricing: ModelPricing = { kind: 'priced', card }
async function fixture(pricing: ModelPricing = defaultPricing, isConfirmed = true) {
  const directory = await mkdtemp(path.join(tmpdir(), 'muse-editor-chat-'))
  folders.push(directory)
  const now = { value: new Date(2026, 9, 10, 12).getTime() }
  const log = new FakeLogOutputChannel()
  const ledger = createTabLedger({
    directory,
    windowId: 'first',
    now: () => now.value,
    sleep: () => Promise.resolve(),
    log,
  })
  const note = vi.fn<EditorChatDeps['recording']['note']>()
  const settings = {
    selected: [ref],
    cap: 1,
    allowed: true,
    current: true,
    limits: true,
    inputTokens: 1000,
  }
  const sent: CreateResponseBody[] = []
  const script: {
    events: readonly StreamEvent[]
    run?: (signal: AbortSignal) => Promise<void>
    retry?: boolean
  } = {
    events: [{ type: 'response.output_text.delta', item_id: 'text', delta: 'answer' }, completed],
  }
  const model: ResolvedModel = {
    ref,
    get contextTokens() {
      return settings.limits ? settings.inputTokens : undefined
    },
    origin: 'https://example.test',
    isCurrent: () => settings.current,
    policy: modelPolicyFor(ref, {
      pricing,
      capabilities: { toolCalling: true, vision: true, reasoning: false },
      maxOutputTokens: 100,
    }),
    price: {
      reserve: (usage) => {
        switch (pricing.kind) {
          case 'local': {
            return Usd.from(0).toAmount()
          }
          case 'priced': {
            return reserveRequestAmount(pricing.card, {
              ...usage,
              cacheWriteTokens: usage.inputTokens,
            })
          }
          default: {
            return undefined
          }
        }
      },
      settle: (usage) => {
        switch (pricing.kind) {
          case 'local': {
            return Usd.from(0).toAmount()
          }
          case 'priced': {
            return settleUsageAmount(pricing.card, usage)
          }
          default: {
            return undefined
          }
        }
      },
    },
    client: {
      streamResponse: async function* (body, signal, _retry, _budget, guard) {
        guard?.(undefined)
        guard?.onRequestStarted?.()
        sent.push(body)
        if (script.retry === true) guard?.(undefined)
        await script.run?.(signal)
        yield* script.events
      },
      countInputTokens: () => Promise.reject(new Error('counting must be offline')),
      listModels: () => Promise.resolve([ref]),
      currentKeyDigest: () => Promise.resolve('nonsecret'),
      retryDelayMs: () => 0,
      waitBeforeRetry: () => Promise.resolve(),
    },
  }
  const deps: EditorChatDeps = {
    models: {
      resolve: (id) => (id === ref ? Promise.resolve(model) : Promise.reject(new Error('unknown'))),
    },
    ledger,
    recording: {
      note,
      limit: vi.fn(),
      today: () => Promise.resolve([]),
      flush: () => Promise.resolve(),
    },
    selected: () => settings.selected,
    cap: () => settings.cap,
    allowed: () => settings.allowed,
    now: () => now.value,
    saveSelected: (refs) => {
      settings.selected = [...refs]
      return Promise.resolve()
    },
    saveCap: (amount) => {
      settings.cap = Number(amount)
      return Promise.resolve()
    },
    confirmations: () => confirmations,
    saveConfirmation: (id, evidence) => {
      if (evidence === undefined) Reflect.deleteProperty(confirmations, id)
      else confirmations[id] = evidence
      return Promise.resolve()
    },
  }
  const confirmations: Record<string, string> = {}
  const engine = createEditorChat(deps)
  if (isConfirmed && (pricing.kind === 'priced' || pricing.kind === 'local')) {
    settings.selected = []
    host.window.showWarningMessage.mockResolvedValue(UI_TEXT.editorChatEnable)
    await engine.toggle(ref)
    host.window.showWarningMessage.mockClear()
  }
  const progress = { report: vi.fn() }
  const cancellation = token()
  const run = (provider: EditorChatProvider = engine.provider) =>
    provider.provideLanguageModelChatResponse(
      { id: ref },
      messages,
      {},
      progress,
      cancellation.value,
    )
  return {
    deps,
    engine,
    ledger,
    note,
    settings,
    sent,
    script,
    model,
    progress,
    cancellation,
    directory,
    now,
    confirmations,
    run,
  }
}

function isProvider(value: unknown): value is EditorChatProvider {
  return (
    typeof value === 'object' && value !== null && 'provideLanguageModelChatInformation' in value
  )
}

async function expectRetainedReservation(f: Awaited<ReturnType<typeof fixture>>, usage?: unknown) {
  expect(f.note).toHaveBeenCalledExactlyOnceWith(
    usage,
    expect.objectContaining({
      outcome: 'failed',
      uncertain: true,
      retainedLiabilityUsd: Usd.from(0.032).toAmount(),
    }),
  )
  expect(await f.ledger.todayUsage()).toMatchObject({
    totalUsd: Usd.from(0.032).toAmount(),
    uncertainUsd: Usd.from(0.032).toAmount(),
  })
}

describe('editor chat exposure and admission', () => {
  it('settings alone require recorded consent before any admission or dispatch', async () => {
    const f = await fixture(defaultPricing, false)
    host.window.showWarningMessage.mockResolvedValue(undefined)
    await expect(f.run()).rejects.toThrow(UI_TEXT.editorChatRefused)
    expect(host.window.showWarningMessage).toHaveBeenCalledOnce()
    expect(f.sent).toHaveLength(0)
    expect(await f.ledger.todayTotal()).toMatchObject({ totalUsd: Usd.from(0).toAmount() })
    host.window.showWarningMessage.mockResolvedValue(UI_TEXT.editorChatEnable)
    await f.run()
    await f.run()
    expect(host.window.showWarningMessage).toHaveBeenCalledTimes(2)
    expect(f.confirmations[ref]).toBeDefined()
    f.settings.cap = 2
    host.window.showWarningMessage.mockResolvedValue(undefined)
    await expect(f.run()).rejects.toThrow()
    expect(f.sent).toHaveLength(2)
    expect(host.window.showWarningMessage).toHaveBeenCalledTimes(3)
  })
  it('a confirmation persistence failure cannot admit a charge', async () => {
    const f = await fixture(defaultPricing, false)
    host.window.showWarningMessage.mockResolvedValue(UI_TEXT.editorChatEnable)
    const engine = createEditorChat({
      ...f.deps,
      saveConfirmation: () => Promise.reject(new Error('storage failed')),
    })
    await expect(f.run(engine.provider)).rejects.toThrow()
    expect(f.sent).toHaveLength(0)
    expect(await f.ledger.todayTotal()).toMatchObject({ totalUsd: Usd.from(0).toAmount() })
  })
  it('changed prices require fresh confirmation and mandatory reasoning without known levels is withdrawn', async () => {
    const f = await fixture()
    const changed = {
      ...f.model,
      policy: modelPolicyFor(ref, {
        maxOutputTokens: 100,
        pricing: { kind: 'priced', card: { ...card, input: 0.000011 } },
        capabilities: { reasoning: false },
      }),
    }
    const engine = createEditorChat({
      ...f.deps,
      models: { resolve: () => Promise.resolve(changed) },
    })
    host.window.showWarningMessage.mockResolvedValue(undefined)
    await expect(f.run(engine.provider)).rejects.toThrow()
    expect(host.window.showWarningMessage.mock.calls[0]?.[0]).toContain('$11.00 input')
    expect(f.sent).toHaveLength(0)
    const mandatory = createEditorChat({
      ...f.deps,
      models: {
        resolve: () =>
          Promise.resolve({
            ...f.model,
            policy: modelPolicyFor(ref, {
              pricing: defaultPricing,
              maxOutputTokens: 100,
              capabilities: { reasoning: true },
              canDisableReasoning: false,
              effortLevels: [],
            }),
          }),
      },
    })
    expect(
      await mandatory.provider.provideLanguageModelChatInformation({}, f.cancellation.value),
    ).toEqual([])
    await expect(f.run(mandatory.provider)).rejects.toThrow()
    expect(host.window.showWarningMessage).toHaveBeenCalledOnce()
    expect(f.sent).toHaveLength(0)
  })
  it('keeps a known non-reasoning model available without allowing an effort option', async () => {
    const f = await fixture()
    const model = {
      ...f.model,
      policy: modelPolicyFor(ref, {
        pricing: defaultPricing,
        maxOutputTokens: 100,
        capabilities: { reasoning: false },
        canDisableReasoning: false,
        effortLevels: [],
      }),
    }
    const engine = createEditorChat({
      ...f.deps,
      models: { resolve: () => Promise.resolve(model) },
    })
    await f.run(engine.provider)
    expect(f.sent[0]?.reasoning.effort).toBe('none')
    await expect(
      engine.provider.provideLanguageModelChatResponse(
        { id: ref },
        messages,
        { modelOptions: { reasoningEffort: 'high' } },
        f.progress,
        f.cancellation.value,
      ),
    ).rejects.toThrow()
    expect(f.sent).toHaveLength(1)
  })
  it('defaults to reasoning off when off is a listed level nobody asked to change', async () => {
    const f = await fixture()
    const model = {
      ...f.model,
      policy: modelPolicyFor(ref, {
        pricing: defaultPricing,
        maxOutputTokens: 100,
        capabilities: { reasoning: true },
        effortLevels: ['none', 'low', 'medium', 'high'],
      }),
    }
    const engine = createEditorChat({
      ...f.deps,
      models: { resolve: () => Promise.resolve(model) },
    })
    expect(
      await engine.provider.provideLanguageModelChatInformation({}, f.cancellation.value),
    ).toHaveLength(1)
    await f.run(engine.provider)
    expect(f.sent[0]?.reasoning.effort).toBe('none')
  })
  it('defaults to reasoning off when the catalogue toggle allows disabling', async () => {
    const f = await fixture()
    const model = {
      ...f.model,
      policy: modelPolicyFor(ref, {
        pricing: defaultPricing,
        maxOutputTokens: 100,
        capabilities: { reasoning: true },
        canDisableReasoning: true,
        effortLevels: ['high', 'xhigh'],
      }),
    }
    const engine = createEditorChat({
      ...f.deps,
      models: { resolve: () => Promise.resolve(model) },
    })
    await f.run(engine.provider)
    expect(f.sent[0]?.reasoning.effort).toBe('none')
  })
  it('honours a requested off level when off is listed without a disable flag', async () => {
    const f = await fixture()
    const model = {
      ...f.model,
      policy: modelPolicyFor(ref, {
        pricing: defaultPricing,
        maxOutputTokens: 100,
        capabilities: { reasoning: true },
        canDisableReasoning: false,
        effortLevels: ['none', 'low'],
      }),
    }
    const engine = createEditorChat({
      ...f.deps,
      models: { resolve: () => Promise.resolve(model) },
    })
    await engine.provider.provideLanguageModelChatResponse(
      { id: ref },
      messages,
      { modelOptions: { reasoningEffort: 'none' } },
      f.progress,
      f.cancellation.value,
    )
    expect(f.sent[0]?.reasoning.effort).toBe('none')
  })
  it('an Enable click after the model is removed writes no grant', async () => {
    const f = await fixture(defaultPricing, false)
    host.window.showWarningMessage.mockImplementation(() => {
      f.settings.selected = []
      return Promise.resolve(UI_TEXT.editorChatEnable)
    })
    await expect(f.run()).rejects.toThrow(UI_TEXT.editorChatRefused)
    expect(f.sent).toHaveLength(0)
    expect(f.confirmations[ref]).toBeUndefined()
    f.settings.selected = [ref]
    host.window.showWarningMessage.mockResolvedValue(UI_TEXT.editorChatEnable)
    await f.run()
    expect(host.window.showWarningMessage).toHaveBeenCalledTimes(2)
    expect(f.sent).toHaveLength(1)
  })
  it('withdraws unknown reasoning without evidence that it can be disabled', async () => {
    const f = await fixture()
    const engine = createEditorChat({
      ...f.deps,
      models: {
        resolve: () =>
          Promise.resolve({
            ...f.model,
            policy: modelPolicyFor(ref, {
              pricing: defaultPricing,
              maxOutputTokens: 100,
            }),
          }),
      },
    })
    expect(
      await engine.provider.provideLanguageModelChatInformation({}, f.cancellation.value),
    ).toEqual([])
    await expect(f.run(engine.provider)).rejects.toThrow()
    expect(host.window.showWarningMessage).not.toHaveBeenCalled()
    expect(f.sent).toHaveLength(0)
  })
  it('quotes every base, cache, request, image, reasoning and long-context rate', async () => {
    const f = await fixture(
      {
        kind: 'priced',
        card: {
          input: 0,
          output: 0,
          cachedInput: 0.000001,
          cacheWrite: 0.000002,
          cacheWrite1h: 0.000003,
          request: 0.5,
          image: 0.6,
          source: 'user',
          longContextTier: {
            fromTokens: 2000,
            input: 0.000004,
            output: 0.000005,
            cachedInput: 0.000006,
            cacheWrite: 0.000007,
            cacheWrite1h: 0.000008,
          },
        },
      },
      false,
    )
    f.settings.selected = []
    host.window.showWarningMessage.mockResolvedValue(UI_TEXT.editorChatEnable)
    await f.engine.toggle(ref)
    const quote = host.window.showWarningMessage.mock.calls[0]?.[0]
    for (const text of [
      '$0.00 input',
      '$0.00 output (including reasoning)',
      '$1.00 cache read',
      '$2.00 cache write',
      '$3.00 1-hour cache write',
      '$0.50 per request',
      '$0.60 per image',
      'From 2,000 input tokens',
      '$4.00 input',
      '$5.00 output',
      '$6.00 cache read',
      '$7.00 cache write',
      '$8.00 1-hour cache write',
      'Shared daily cap: $1.00',
    ])
      expect(quote).toContain(text)
  })
  it.each([
    { hasCache: false, reported: undefined, expected: 1.1007 },
    { hasCache: true, reported: undefined, expected: 1.100712 },
    { hasCache: true, reported: 1.12, expected: 1.12 },
  ])(
    'records the complete production settlement, including images and caches ($hasCache, $reported)',
    async ({ hasCache, reported, expected }) => {
      const pricing: ModelPricing = {
        kind: 'priced',
        card: {
          ...card,
          request: 0.5,
          image: 0.6,
          cachedInput: 0.000001,
          cacheWrite1h: 0.00004,
          longContextTier: { fromTokens: 15, input: 0.00002, output: 0.00003 },
        },
      }
      const f = await fixture(pricing, false)
      f.settings.cap = 4
      f.script.events = [
        {
          ...completed,
          response: {
            ...completed.response,
            usage: {
              input_tokens: 20,
              output_tokens: 10,
              ...(reported !== undefined && { provider_cost_usd: reported }),
              output_tokens_details: { reasoning_tokens: 4 },
              ...(hasCache && {
                input_tokens_details: {
                  cached_tokens: 2,
                  cache_write_tokens: 4,
                  cache_write_tokens_1h: 1,
                },
              }),
            },
          },
        },
      ]
      const resolver = createProviderRegistry({
        models: () =>
          Promise.resolve([
            {
              ref,
              origin: f.model.origin,
              pricing,
              contextTokens: 1000,
              evidence: {
                maxOutputTokens: 100,
                capabilities: { vision: true, reasoning: false },
              },
            },
          ]),
        createClient: () => Promise.resolve(f.model.client),
        isCurrent: () => true,
      })
      const engine = createEditorChat({ ...f.deps, models: resolver })
      host.window.showWarningMessage.mockResolvedValue(UI_TEXT.editorChatEnable)
      await engine.provider.provideLanguageModelChatResponse(
        { id: ref },
        [...messages, { role: 1, content: [{ data: new Uint8Array([1]), mimeType: 'image/png' }] }],
        {},
        f.progress,
        f.cancellation.value,
      )
      const call = f.note.mock.calls[0]
      if (call === undefined || call[1].units?.images !== 1) throw new Error('Missing settlement')
      const record = createUsageRecord(call[0], {
        id: 'record',
        at: f.now.value,
        client: 'test',
        model: ref,
        backend: 'modelApi',
        kind: 'vscodeChat',
        pricing,
        units: call[1].units,
        ...(call[1].providerCostUsd !== undefined && { providerCostUsd: call[1].providerCostUsd }),
        provider: 'chosen',
        startedAt: f.now.value,
        outcome: 'completed',
      })
      const total = await f.ledger.todayTotal()
      if (!total.ok) throw new Error('Missing ledger')
      expect(record.cost.usd).toBe(Number(total.totalUsd))
      expect(record.cost.usd).toBe(expected)
      expect(record.cost.certainty).toBe(reported === undefined ? 'computed' : 'reported')
      expect(record.tokens.reasoning).toBe(4)
    },
  )
  it('reports real durable settlement failure with its retained reservation', async () => {
    const f = await fixture()
    const original = atomic.writeFileAtomically
    vi.spyOn(atomic, 'writeFileAtomically').mockImplementation(async (file, text, options) => {
      const row: unknown = JSON.parse(
        typeof text === 'string' ? text : Buffer.from(text).toString('utf8'),
      )
      if (
        typeof row === 'object' &&
        row !== null &&
        'reportedUsd' in row &&
        row.reportedUsd !== '0'
      )
        throw new Error('settlement write failed')
      await original(file, text, options)
    })
    await expect(f.run()).rejects.toThrow(UI_TEXT.editorChatRefused)
    await expectRetainedReservation(f, expect.anything())
  })
  it('retains liability and refuses success when terminal usage cannot be settled', async () => {
    const f = await fixture()
    f.script.events = [{ ...completed, response: { ...completed.response, usage: undefined } }]
    await expect(f.run()).rejects.toThrow(UI_TEXT.editorChatRefused)
    await expectRetainedReservation(f)
  })
  it.each([undefined, 'high'])(
    'uses only a supported mandatory Gemini reasoning level (%s)',
    async (requested) => {
      const f = await fixture(defaultPricing, false)
      const nativeRecord = resolveModelCapabilities(
        { provider: 'gemini', nativeModel: 'gemini-3.5-flash-lite', format: 'gemini' },
        [
          {
            source: { kind: 'user' },
            fields: {
              reasoning: {
                modes: { state: 'yes', value: ['level'] },
                forced: { state: 'yes', value: true },
                canDisable: { state: 'no' },
                effortLevels: { state: 'yes', value: ['low', 'high'] },
              },
            },
          },
        ],
      )
      const model: ResolvedModel = {
        ...f.model,
        policy: modelPolicyFor(ref, {
          pricing: defaultPricing,
          maxOutputTokens: 100,
          capabilities: { reasoning: true },
          canDisableReasoning: false,
          effortLevels: ['low', 'high'],
        }),
        client: {
          ...f.model.client,
          streamResponse: async function* (body, signal, retry, budget, guard) {
            const native = encodeGeminiRequest(body, 'gemini-3.5-flash-lite', nativeRecord)
            expect(native.body['generationConfig']).toMatchObject({
              thinkingConfig: { thinkingLevel: requested ?? 'low' },
            })
            yield* f.model.client.streamResponse(body, signal, retry, budget, guard)
          },
        },
      }
      const engine = createEditorChat({
        ...f.deps,
        models: { resolve: () => Promise.resolve(model) },
      })
      host.window.showWarningMessage.mockResolvedValue(UI_TEXT.editorChatEnable)
      expect(
        await engine.provider.provideLanguageModelChatInformation({}, f.cancellation.value),
      ).toHaveLength(1)
      const options =
        requested === undefined ? {} : { modelOptions: { reasoningEffort: requested } }
      await engine.provider.provideLanguageModelChatResponse(
        { id: ref },
        messages,
        options,
        f.progress,
        f.cancellation.value,
      )
      expect(f.sent[0]?.reasoning.effort).toBe(requested ?? 'low')
      expect(f.note).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ outcome: 'completed', uncertain: false }),
      )
      await expect(
        engine.provider.provideLanguageModelChatResponse(
          { id: ref },
          messages,
          { modelOptions: { reasoningEffort: 'none' } },
          f.progress,
          f.cancellation.value,
        ),
      ).rejects.toThrow()
      expect(f.sent).toHaveLength(1)
    },
  )
  it('uses the native Meta model reference and supported reasoning effort', async () => {
    const f = await fixture()
    const native = 'muse-spark-1.3'
    const selected = `meta/${native}`
    const model = { ...f.model, ref: native, policy: modelPolicyFor(native) }
    f.settings.selected = [selected]
    f.settings.cap = 4
    const engine = createEditorChat({
      ...f.deps,
      models: {
        resolve: (id) =>
          id === native
            ? Promise.resolve(model)
            : Promise.reject(new Error('wrong native reference')),
      },
    })
    await engine.provider.provideLanguageModelChatResponse(
      { id: selected },
      messages,
      {},
      f.progress,
      f.cancellation.value,
    )
    expect(f.sent[0]).toMatchObject({ model: native, reasoning: { effort: 'minimal' } })
  })
  it('keeps completed calls tallied when durable settlement throws', async () => {
    const f = await fixture()
    const engine = createEditorChat({
      ...f.deps,
      ledger: { ...f.ledger, settle: () => Promise.reject(new Error('private provider detail')) },
    })
    await expect(f.run(engine.provider)).rejects.toThrow(UI_TEXT.editorChatRefused)
    expect(f.note).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: 'failed', uncertain: true }),
    )
    expect(await f.ledger.todayUsage()).toMatchObject({ uncertainUsd: Usd.from(0.032).toAmount() })
  })
  it('cancels an active caller on provider disposal without waiting for another chunk', async () => {
    const f = await fixture()
    f.script.run = (signal) => {
      f.engine.cancelAll()
      expect(signal.aborted).toBe(true)
      signal.throwIfAborted()
      return Promise.resolve()
    }
    await expect(f.run()).rejects.toThrow(UI_TEXT.editorChatRefused)
    expect(f.note).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ outcome: 'cancelled' }),
    )
  })
  it('honours a cap lowered while reservation is being written, before dispatch', async () => {
    const f = await fixture()
    const engine = createEditorChat({
      ...f.deps,
      ledger: {
        ...f.ledger,
        admit: async (...args) => {
          const admission = await f.ledger.admit(...args)
          f.settings.cap = 0.001
          return admission
        },
      },
    })
    await expect(f.run(engine.provider)).rejects.toThrow(UI_TEXT.editorChatRefused)
    expect(f.sent).toHaveLength(0)
    expect(await f.ledger.todayTotal()).toMatchObject({ totalUsd: Usd.from(0).toAmount() })
  })
  it('reports provider-truncated completion as incomplete and settles its usage', async () => {
    const f = await fixture()
    f.script.events = [
      { type: 'response.incomplete', response: { ...completed.response, status: 'incomplete' } },
    ]
    await f.run()
    expect(f.note).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: 'incomplete' }),
    )
  })
  it.each<ModelPricing>([{ kind: 'unpriced' }, { kind: 'plan' }])(
    'withdraws and refuses $kind models before dispatch',
    async (pricing) => {
      const f = await fixture(pricing)
      expect(
        await f.engine.provider.provideLanguageModelChatInformation({}, f.cancellation.value),
      ).toEqual([])
      await expect(f.run()).rejects.toThrow(UI_TEXT.editorChatRefused)
      expect(f.sent).toHaveLength(0)
    },
  )
  it.each(['selected', 'cap', 'allowed', 'current', 'limits'])(
    'refuses invalid %s before reserving or dispatching',
    async (guard) => {
      const f = await fixture()
      switch (guard) {
        case 'selected': {
          f.settings.selected = []
          break
        }
        case 'cap': {
          f.settings.cap = 0
          break
        }
        case 'allowed': {
          f.settings.allowed = false
          break
        }
        case 'current': {
          f.settings.current = false
          break
        }
        default: {
          f.settings.limits = false
        }
      }
      await expect(f.run()).rejects.toThrow()
      expect(f.sent).toHaveLength(0)
      const total = await f.ledger.todayTotal()
      expect(total.ok).toBe(true)
      expect(f.note).not.toHaveBeenCalled()
    },
  )
  it('offers only the chosen model with its own limits and capabilities, counts offline', async () => {
    const f = await fixture()
    expect(
      await f.engine.provider.provideLanguageModelChatInformation({}, f.cancellation.value),
    ).toMatchObject([
      {
        id: ref,
        maxInputTokens: 1000,
        maxOutputTokens: 100,
        capabilities: { toolCalling: true, imageInput: true },
      },
    ])
    expect(await f.engine.provider.provideTokenCount({ id: ref }, 'é', f.cancellation.value)).toBe(
      2,
    )
    expect(f.sent).toHaveLength(0)
  })
  it('streams text, settles actual usage, records exactly one vscodeChat call', async () => {
    const f = await fixture()
    await f.run()
    expect(f.progress.report).toHaveBeenCalledWith(expect.objectContaining({ value: 'answer' }))
    expect(f.sent[0]).toMatchObject({ model: ref, max_output_tokens: 100, store: false })
    expect(f.note).toHaveBeenCalledExactlyOnceWith(
      completed.response.usage,
      expect.objectContaining({ kind: 'vscodeChat', outcome: 'completed', uncertain: false }),
    )
    expect(await f.ledger.todayTotal()).toMatchObject({
      ok: true,
      totalUsd: Usd.from(0.0004).toAmount(),
    })
    expect(f.cancellation.listeners.size).toBe(0)
  })
  it('blocks at the cap before sending, including concurrent windows', async () => {
    const f = await fixture()
    f.settings.cap = 0.035
    const other = createTabLedger({
      directory: f.directory,
      windowId: 'second',
      now: f.deps.now,
      sleep: () => Promise.resolve(),
      log: new FakeLogOutputChannel(),
    })
    const engines = [f.engine, createEditorChat({ ...f.deps, ledger: other })]
    f.script.events = [] // Dispatched but no terminal: retain each admitted reservation.
    const results = await Promise.allSettled(
      engines.map((engine) =>
        engine.provider.provideLanguageModelChatResponse(
          { id: ref },
          messages,
          {},
          f.progress,
          f.cancellation.value,
        ),
      ),
    )
    expect(results.every((result) => result.status === 'rejected')).toBe(true)
    expect(f.sent.length).toBeLessThanOrEqual(1)
    const total = await f.ledger.todayTotal()
    if (!total.ok) throw new Error('ledger read')
    expect(Usd.from(total.totalUsd).compare(Usd.from(f.settings.cap))).toBeLessThanOrEqual(0)
    await expect(f.run()).rejects.toThrow()
    expect(f.sent).toHaveLength(1)
  })
  it('serves local models at zero cost with a positive configured cap', async () => {
    const f = await fixture({ kind: 'local' })
    f.settings.cap = 0.00001
    await f.run()
    expect(await f.ledger.todayTotal()).toMatchObject({ totalUsd: Usd.from(0).toAmount() })
    expect(f.note).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pricing: { kind: 'local' } }),
    )
  })
  it('retains liability for interrupted or retrying dispatch and records failure once', async () => {
    const f = await fixture()
    f.script.retry = true
    await expect(f.run()).rejects.toThrow()
    await expectRetainedReservation(f)
  })
  it('fails closed on corrupt durable history', async () => {
    const f = await fixture()
    await f.run()
    await writeFile(path.join(f.directory, '2026-10-10', 'first.json'), 'corrupt')
    await expect(f.run()).rejects.toThrow()
    expect(f.sent).toHaveLength(1)
  })
  it('settles a pre-midnight reservation into its original day', async () => {
    const f = await fixture()
    f.script.run = () => {
      f.now.value += 24 * 60 * 60 * 1000
      return Promise.resolve()
    }
    await f.run()
    const yesterday: unknown = JSON.parse(
      await readFile(path.join(f.directory, '2026-10-10', 'first.json'), 'utf8'),
    )
    expect(yesterday).toMatchObject({ reportedUsd: Usd.from(0.0004).toAmount() })
    expect(await f.ledger.todayTotal()).toMatchObject({ totalUsd: Usd.from(0).toAmount() })
  })
  it('cancels dispatched work, retains liability and removes listeners', async () => {
    const f = await fixture()
    f.script.run = (signal) => {
      f.cancellation.cancel()
      signal.throwIfAborted()
      return Promise.resolve()
    }
    await expect(f.run()).rejects.toThrow()
    expect(f.note).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ outcome: 'cancelled', uncertain: true }),
    )
    expect(f.cancellation.listeners.size).toBe(0)
  })
  it('rechecks opt-in at dispatch and rolls back an unsent reservation', async () => {
    const f = await fixture()
    const original = f.ledger.admit
    const engine = createEditorChat({
      ...f.deps,
      ledger: {
        ...f.ledger,
        admit: async (...args) => {
          const admission = await original(...args)
          f.settings.selected = []
          return admission
        },
      },
    })
    await expect(
      engine.provider.provideLanguageModelChatResponse(
        { id: ref },
        messages,
        {},
        f.progress,
        f.cancellation.value,
      ),
    ).rejects.toThrow()
    expect(f.sent).toHaveLength(0)
    expect(await f.ledger.todayTotal()).toMatchObject({ totalUsd: Usd.from(0).toAmount() })
  })
  it('converts tools, calls, results and image data through the captured transport seam', async () => {
    const f = await fixture()
    f.settings.inputTokens = 2000
    const history = [
      ...messages,
      { role: 2, content: [{ callId: 'call', name: 'read', input: { path: 'a' } }] },
      {
        role: 1,
        content: [
          { callId: 'call', content: [{ value: 'result' }] },
          { data: new Uint8Array([1]), mimeType: 'image/png' },
        ],
      },
    ]
    f.script.events = [
      {
        type: 'response.output_item.done',
        item: { type: 'function_call', call_id: 'next', name: 'read', arguments: '{"path":"b"}' },
      },
      completed,
    ]
    await f.engine.provider.provideLanguageModelChatResponse(
      { id: ref },
      history,
      {
        tools: [
          { name: 'read', description: 'read file', inputSchema: { type: 'object' } },
          { name: 'noop', description: 'no arguments' },
        ],
      },
      f.progress,
      f.cancellation.value,
    )
    expect(f.sent[0]?.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'function_call', call_id: 'call' }),
        expect.objectContaining({ type: 'function_call_output', output: 'result' }),
        expect.objectContaining({
          type: 'message',
          content: [expect.objectContaining({ image_url: 'data:image/png;base64,AQ==' })],
        }),
      ]),
    )
    expect(f.progress.report).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'next', input: { path: 'b' } }),
    )
    expect(f.sent[0]?.tools[1]).toMatchObject({
      name: 'noop',
      parameters: { type: 'object', properties: {} },
    })
  })
  it.each([
    { role: 0, content: [{ value: 'system' }] },
    { role: 1, content: [{ unknown: 'bad' }] },
  ])('rejects unsupported message content before dispatch', async (message) => {
    const f = await fixture()
    await expect(
      f.engine.provider.provideLanguageModelChatResponse(
        { id: ref },
        [message],
        {},
        f.progress,
        f.cancellation.value,
      ),
    ).rejects.toThrow()
    expect(f.sent).toHaveLength(0)
  })
  it('requires priced consent before persisting opt-in and asks for a missing cap', async () => {
    const f = await fixture()
    f.settings.selected = []
    f.settings.cap = 0
    host.window.showInputBox.mockResolvedValue('1')
    host.window.showWarningMessage.mockResolvedValue(UI_TEXT.editorChatEnable)
    await f.engine.toggle(ref)
    expect(f.settings.selected).toEqual([ref])
    expect(f.settings.cap).toBe(1)
    expect(host.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('All installed extensions'),
      { modal: true },
      UI_TEXT.editorChatEnable,
    )
    await f.engine.toggle(ref)
    expect(f.settings.selected).toEqual([])
    expect(host.window.showWarningMessage).toHaveBeenCalledOnce()
  })
  it('dismissed consent leaves the model off', async () => {
    const f = await fixture()
    f.settings.selected = []
    host.window.showWarningMessage.mockResolvedValue(undefined)
    await f.engine.toggle(ref)
    expect(f.settings.selected).toEqual([])
  })
  it('keeps activation lazy, registers a fake vscode.lm caller only after opt-in', async () => {
    const f = await fixture()
    const loader = vi.fn(() => ({ createEditorChat, createTabLedger, setUiText: vi.fn() }))
    const state = new Map<string, unknown>()
    const handle = registerEditorChat({
      globalState: {
        get: (key) => state.get(key),
        update: (key, value) => {
          state.set(key, value)
          return Promise.resolve()
        },
      },
      extensionPath: 'C:/extension',
      storagePath: f.directory,
      windowId: 'lazy',
      table: { table: EN, locale: 'en' },
      log: new FakeLogOutputChannel(),
      models: () => Promise.resolve(f.deps.models),
      recording: f.deps.recording,
      allowed: () => true,
      loadBundle: loader,
    })
    expect(loader).not.toHaveBeenCalled()
    expect(host.register).not.toHaveBeenCalled()
    host.config.set('editorChatModels', [ref])
    host.config.set('editorChatDailyBudgetUsd', 1)
    host.change.run?.({ affectsConfiguration: () => true })
    expect(host.register).toHaveBeenCalledOnce()
    const provider: unknown = host.register.mock.calls[0]?.[1]
    if (!isProvider(provider)) throw new Error('missing provider')
    expect(
      await provider.provideLanguageModelChatInformation({}, f.cancellation.value),
    ).toHaveLength(1)
    expect(loader).toHaveBeenCalledOnce()
    await provider.provideLanguageModelChatResponse(
      { id: ref },
      messages,
      {},
      f.progress,
      f.cancellation.value,
    )
    expect(f.note).toHaveBeenCalledOnce()
    expect(host.window.showWarningMessage).toHaveBeenCalledOnce()
    expect(state.get('museSpark.editorChatConfirmations')).toHaveProperty(ref)
    host.config.set('editorChatDailyBudgetUsd', 0)
    host.change.run?.({ affectsConfiguration: (key) => key.endsWith('editorChatDailyBudgetUsd') })
    expect(host.dispose).toHaveBeenCalledOnce()
    expect(host.register).toHaveBeenCalledOnce()
    host.config.set('editorChatDailyBudgetUsd', 1)
    host.change.run?.({ affectsConfiguration: (key) => key.endsWith('editorChatDailyBudgetUsd') })
    expect(host.register).toHaveBeenCalledTimes(2)
    await provider.provideLanguageModelChatResponse(
      { id: ref },
      messages,
      {},
      f.progress,
      f.cancellation.value,
    )
    expect(host.window.showWarningMessage).toHaveBeenCalledTimes(2)
    host.config.set('editorChatModels', [])
    host.change.run?.({ affectsConfiguration: (key) => key.endsWith('editorChatModels') })
    host.config.set('editorChatModels', [ref])
    host.change.run?.({ affectsConfiguration: (key) => key.endsWith('editorChatModels') })
    await provider.provideLanguageModelChatResponse(
      { id: ref },
      messages,
      {},
      f.progress,
      f.cancellation.value,
    )
    expect(host.window.showWarningMessage).toHaveBeenCalledTimes(3)
    handle.dispose()
    expect(host.dispose).toHaveBeenCalledTimes(3)
    await expect(
      provider.provideLanguageModelChatResponse(
        { id: ref },
        messages,
        {},
        f.progress,
        f.cancellation.value,
      ),
    ).rejects.toThrow()
  })
})
