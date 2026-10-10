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
async function fixture(pricing: ModelPricing = defaultPricing) {
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
      capabilities: { toolCalling: true, vision: true },
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
  }
  const engine = createEditorChat(deps)
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
    run,
  }
}

function isProvider(value: unknown): value is EditorChatProvider {
  return (
    typeof value === 'object' && value !== null && 'provideLanguageModelChatInformation' in value
  )
}

describe('editor chat exposure and admission', () => {
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
    expect(f.note).toHaveBeenCalledOnce()
    expect(f.note).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        outcome: 'failed',
        uncertain: true,
        retainedLiabilityUsd: Usd.from(0.032).toAmount(),
      }),
    )
    expect(await f.ledger.todayUsage()).toMatchObject({ uncertainUsd: Usd.from(0.032).toAmount() })
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
    const handle = registerEditorChat({
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
    host.config.set('editorChatDailyBudgetUsd', 0)
    host.change.run?.({ affectsConfiguration: (key) => key.endsWith('editorChatDailyBudgetUsd') })
    expect(host.dispose).toHaveBeenCalledOnce()
    expect(host.register).toHaveBeenCalledOnce()
    host.config.set('editorChatDailyBudgetUsd', 1)
    host.change.run?.({ affectsConfiguration: (key) => key.endsWith('editorChatDailyBudgetUsd') })
    expect(host.register).toHaveBeenCalledTimes(2)
    handle.dispose()
    expect(host.dispose).toHaveBeenCalledTimes(2)
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
