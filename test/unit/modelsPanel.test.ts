import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { window } from 'vscode'
import { createModelsPanelSeam } from '../../src/core/providers/panelSeam'
import type { ModelsPanelDeps } from '../../src/host/models/modelsPanel'
import {
  parseHostToPanelMessage,
  type ModelsPanelState,
  type PanelDraft,
} from '../../src/shared/modelsPanel'
import { EN } from '../../src/shared/l10n/en'
import type { ProvidersHostDeps } from '../../src/host/providers/providersHost'
import type { PresetCatalog, ProvidersStore } from '../../src/host/providers/providerPorts'
import { UI_TEXT } from '../../src/shared/constants'
import {
  localWindowedRow,
  ollamaEntryWithWindow,
  TEST_ENTRY,
  testProvidersHost,
  testRow,
} from './helpers/m95kFixtures'
import { type FakeWebviewPanel, memoryProvidersStore } from './helpers/fakes'
import {
  chooseOpenRouter,
  latestState,
  openModelsPanel,
  resetModelsPanelWindow,
  send,
  testAndTickFirstModel,
  type OpenedModelsPanel,
} from './helpers/modelsPanelHarness'

function setup(
  overrides: Partial<ModelsPanelDeps> = {},
): OpenedModelsPanel & { providers: ModelsPanelDeps['providers'] } {
  const { providers } = testProvidersHost({
    deps: {
      store: memoryProvidersStore(),
      fetcher: { fetchModels: () => Promise.resolve({ rows: [testRow('m1')] }) },
    },
  })
  return {
    ...openModelsPanel({ providers, ...overrides }),
    providers: overrides.providers ?? providers,
  }
}
async function sendDraft(
  panel: FakeWebviewPanel,
  message: unknown,
  expected: Partial<PanelDraft>,
): Promise<void> {
  await send(panel, message, () => {
    expect(latestState(panel).drafts.wizard).toMatchObject(expected)
  })
}
async function testTickAndSave(
  panel: FakeWebviewPanel,
  providerId: string,
  saved: ReturnType<typeof vi.fn>,
) {
  await testAndTickFirstModel(panel, providerId)
  await send(panel, { type: 'providers/save', useNow: true }, () => {
    expect(saved).toHaveBeenCalledOnce()
  })
}
beforeEach(resetModelsPanelWindow)
async function chooseOllama(panel: FakeWebviewPanel): Promise<void> {
  await send(panel, { type: 'providers/select', presetId: 'ollama' }, () => {
    expect(latestState(panel).drafts.wizard?.presetId).toBe('ollama')
  })
  await send(
    panel,
    { type: 'providers/prefill', fields: { address: 'http://127.0.0.1:11434' } },
    () => {
      expect(latestState(panel).drafts.wizard?.address).toBe('http://127.0.0.1:11434')
    },
  )
}
async function testWizardDraft(panel: FakeWebviewPanel): Promise<void> {
  await send(panel, { type: 'providers/test', acceptCost: false }, () => {
    expect(latestState(panel).drafts.wizard?.test?.status).toBe('ok')
  })
}
async function tickWizardModel(panel: FakeWebviewPanel, ref: string, model: string): Promise<void> {
  await send(panel, { type: 'models/tick', scope: { scope: 'wizard' }, ref, ticked: true }, () => {
    expect(latestState(panel).drafts.wizard?.models).toEqual([model])
  })
}
describe('Models host contract', () => {
  it('keeps an OAuth credential bound to its issuer after an edited draft address', async () => {
    const test = vi.fn(() => Promise.resolve({ kind: 'ok' as const, models: 1 }))
    const { providers } = testProvidersHost({
      deps: { store: memoryProvidersStore(), tester: { test } },
    })
    const { panel, warnings } = setup({ providers })
    await chooseOpenRouter(panel)
    await send(
      panel,
      { type: 'providers/prefill', fields: { address: 'https://attacker.example' } },
      () => {
        expect(latestState(panel).drafts.wizard?.address).toBe('https://attacker.example')
      },
    )
    await send(panel, { type: 'providers/connect' }, () => {
      expect(latestState(panel).drafts.wizard?.connected).toBe(true)
    })
    await send(panel, { type: 'providers/test', acceptCost: false }, () => {
      expect(warnings.length).toBeGreaterThan(0)
    })
    expect(test).not.toHaveBeenCalled()
  })
  it('loads a host-owned edit draft and identifies edited prefills', async () => {
    const { providers } = testProvidersHost()
    const { panel } = setup({ providers })
    await send(panel, { type: 'providers/edit', providerId: 'openrouter' }, () => {
      expect(latestState(panel).drafts.edits['openrouter']?.presetId).toBe('openrouter')
    })
    await send(
      panel,
      {
        type: 'providers/prefill',
        providerId: 'openrouter',
        fields: { address: 'https://different.example' },
      },
      () => {
        expect(latestState(panel).drafts.edits['openrouter']?.address).toBe(
          'https://different.example',
        )
      },
    )
    const entries = await providers.providers()
    expect(entries[0]?.address).toBe(TEST_ENTRY.address)
  })
  it('loads models stylesheet and keeps nonce CSP', () => {
    const { panel } = setup()
    expect(panel.webview.html).toContain('dist/webview/models.css')
    expect(panel.webview.html).toContain("script-src 'nonce-")
  })
  it('answers ready and top-level selection with the shared state contract', async () => {
    const { panel } = setup()
    await send(panel, { type: 'modelsPanel/ready' }, () => {
      expect(latestState(panel).presets).toHaveLength(2)
    })
    await send(panel, { type: 'providers/select', presetId: 'openrouter' }, () => {
      expect(latestState(panel).drafts.wizard?.presetId).toBe('openrouter')
    })
    for (const call of vi.mocked(panel.webview.postMessage).mock.calls) {
      expect(parseHostToPanelMessage(call[0]).ok).toBe(true)
    }
  })
  it('saves and displays a manual local window and preserves it across rescans and ticks', async () => {
    const store = memoryProvidersStore()
    const { providers } = testProvidersHost({
      deps: {
        store,
        fetcher: { fetchModels: () => Promise.resolve({ rows: [localWindowedRow('m')] }) },
      },
    })
    const { panel } = setup({ providers })
    await chooseOllama(panel)
    await testWizardDraft(panel)
    await tickWizardModel(panel, 'ollama/m', 'm')
    const setWindow = (tokens: number, scope: 'wizard' | 'provider') =>
      send(
        panel,
        {
          type: 'models/contextWindow',
          scope: { scope, ...(scope === 'provider' && { providerId: 'ollama' }) },
          ref: 'ollama/m',
          contextTokens: tokens,
        },
        () => {
          expect(latestState(panel).models[0]?.contextTokens).toBe(tokens)
        },
      )
    await setWindow(8192, 'wizard')
    await send(panel, { type: 'providers/save', useNow: false }, () => {
      expect(latestState(panel).drafts.wizard).toBeUndefined()
    })
    expect(store.current[0]?.modelLimits?.['m']).toEqual({
      contextTokens: 8192,
      outputTokens: 8192,
    })
    await send(panel, { type: 'models/scan', providerId: 'ollama' }, () => {
      expect(latestState(panel).scans['ollama']?.status).toBe('done')
    })
    expect(latestState(panel).models[0]?.contextTokens).toBe(8192)
    const tickMessages = panel.webview.postMessage.mock.calls.length
    await send(
      panel,
      {
        type: 'models/tick',
        scope: { scope: 'provider', providerId: 'ollama' },
        ref: 'ollama/m',
        ticked: true,
      },
      () => {
        expect(panel.webview.postMessage.mock.calls.length).toBeGreaterThan(tickMessages)
        expect(latestState(panel).models[0]?.ticked).toBe(true)
      },
    )
    expect(store.current[0]?.modelLimits?.['m']?.contextTokens).toBe(8192)
    await setWindow(2048, 'provider')
    await send(panel, { type: 'providers/edit', providerId: 'ollama' }, () => {
      expect(latestState(panel).drafts.edits['ollama']?.modelLimits?.['m']?.contextTokens).toBe(
        2048,
      )
    })
    await send(
      panel,
      {
        type: 'models/contextWindow',
        scope: { scope: 'wizard', providerId: 'ollama' },
        ref: 'ollama/m',
        contextTokens: 1024,
      },
      () => {
        expect(latestState(panel).drafts.edits['ollama']?.modelLimits?.['m']?.contextTokens).toBe(
          1024,
        )
      },
    )
    await send(panel, { type: 'providers/test', providerId: 'ollama', acceptCost: false }, () => {
      expect(latestState(panel).drafts.edits['ollama']?.test?.status).toBe('ok')
    })
    await send(panel, { type: 'providers/save', providerId: 'ollama', useNow: false }, () => {
      expect(latestState(panel).drafts.edits['ollama']).toBeUndefined()
    })
    expect(store.current[0]?.modelLimits?.['m']).toEqual({
      contextTokens: 1024,
      outputTokens: 1024,
    })
    await send(
      panel,
      {
        type: 'models/tick',
        scope: { scope: 'provider', providerId: 'ollama' },
        ref: 'ollama/m',
        ticked: false,
      },
      () => {
        expect(latestState(panel).models[0]?.ticked).toBe(false)
      },
    )
    expect(store.current[0]?.modelLimits).toEqual({})
  })

  it('drops a wizard window on untick so the save stores no limits for it', async () => {
    // C-M95-4 R5 (RVCM954C finding 3): tick, set a window, untick, save.
    // The unticked model's limit must not reach the file, and a later
    // re-tick must not resurrect it.
    const store = memoryProvidersStore()
    const { providers } = testProvidersHost({
      deps: {
        store,
        fetcher: {
          fetchModels: () =>
            Promise.resolve({ rows: [localWindowedRow('m1'), localWindowedRow('m2')] }),
        },
      },
    })
    const { panel } = setup({ providers })
    await chooseOllama(panel)
    await testWizardDraft(panel)
    await send(
      panel,
      { type: 'models/tick', scope: { scope: 'wizard' }, ref: 'ollama/m1', ticked: true },
      () => {
        expect(latestState(panel).drafts.wizard?.models).toEqual(['m1'])
      },
    )
    await send(
      panel,
      { type: 'models/tick', scope: { scope: 'wizard' }, ref: 'ollama/m2', ticked: true },
      () => {
        expect(latestState(panel).drafts.wizard?.models).toEqual(['m1', 'm2'])
      },
    )
    await send(
      panel,
      {
        type: 'models/contextWindow',
        scope: { scope: 'wizard' },
        ref: 'ollama/m1',
        contextTokens: 1_000_000,
      },
      () => {
        expect(latestState(panel).drafts.wizard?.modelLimits?.['m1']?.contextTokens).toBe(1_000_000)
      },
    )
    await send(
      panel,
      {
        type: 'models/contextWindow',
        scope: { scope: 'wizard' },
        ref: 'ollama/m2',
        contextTokens: 4096,
      },
      () => {
        expect(latestState(panel).drafts.wizard?.modelLimits?.['m2']?.contextTokens).toBe(4096)
      },
    )
    await send(
      panel,
      { type: 'models/tick', scope: { scope: 'wizard' }, ref: 'ollama/m1', ticked: false },
      () => {
        expect(latestState(panel).drafts.wizard?.models).toEqual(['m2'])
      },
    )
    expect(latestState(panel).drafts.wizard?.modelLimits?.['m1']).toBeUndefined()
    await send(
      panel,
      { type: 'models/tick', scope: { scope: 'wizard' }, ref: 'ollama/m1', ticked: true },
      () => {
        expect(latestState(panel).drafts.wizard?.models).toEqual(['m2', 'm1'])
      },
    )
    expect(latestState(panel).drafts.wizard?.modelLimits?.['m1']).toBeUndefined()
    await send(
      panel,
      { type: 'models/tick', scope: { scope: 'wizard' }, ref: 'ollama/m1', ticked: false },
      () => {
        expect(latestState(panel).drafts.wizard?.models).toEqual(['m2'])
      },
    )
    await send(panel, { type: 'providers/save', useNow: false }, () => {
      expect(latestState(panel).drafts.wizard).toBeUndefined()
    })
    expect(store.current[0]?.models).toEqual(['m2'])
    expect(store.current[0]?.modelLimits?.['m1']).toBeUndefined()
    expect(store.current[0]?.modelLimits?.['m2']).toEqual({
      contextTokens: 4096,
      outputTokens: 4096,
    })
  })

  it('rejects invalid or cross-provider manual windows without persistence', async () => {
    const { panel, warnings } = setup()
    await chooseOpenRouter(panel)
    await tickWizardModel(panel, 'openrouter/m1', 'm1')
    for (const contextTokens of [0, 1.5, Infinity]) {
      const count = warnings.length
      await send(
        panel,
        {
          type: 'models/contextWindow',
          scope: { scope: 'wizard' },
          ref: 'openrouter/m1',
          contextTokens,
        },
        () => {
          expect(warnings.length).toBe(count + 1)
        },
      )
    }
    await send(
      panel,
      {
        type: 'models/contextWindow',
        scope: { scope: 'wizard' },
        ref: 'openrouter/m1',
        contextTokens: 4096,
      },
      () => {
        expect(latestState(panel).notice).toBe(EN.actionFailed)
      },
    )
    expect(latestState(panel).drafts.wizard?.modelLimits).toBeUndefined()
    await chooseOllama(panel)
    await testWizardDraft(panel)
    await tickWizardModel(panel, 'ollama/m1', 'm1')
    for (const ref of ['remote/m1', 'ollama/unlisted']) {
      const sent = panel.webview.postMessage.mock.calls.length
      await send(
        panel,
        { type: 'models/contextWindow', scope: { scope: 'wizard' }, ref, contextTokens: 4096 },
        () => {
          expect(panel.webview.postMessage.mock.calls.length).toBeGreaterThan(sent)
        },
      )
      expect(latestState(panel).notice).toBe(EN.actionFailed)
      expect(latestState(panel).drafts.wizard?.modelLimits).toBeUndefined()
    }
  })

  it('drops smuggled credentials without echoing raw validation input', async () => {
    const { panel, warnings } = setup()
    await send(
      panel,
      { type: 'providers/select', presetId: 'openrouter', secret: 'bare-synthetic-secret' },
      () => {
        expect(warnings).toHaveLength(1)
      },
    )
    expect(warnings.join(',')).not.toContain('bare-synthetic-secret')
    expect(panel.webview.postMessage).not.toHaveBeenCalled()
  })
  it('never forwards exception text to state or logs', async () => {
    const host = testProvidersHost()
    const { panel, warnings } = setup({
      providers: {
        ...host.providers,
        connectOpenRouter: () => Promise.reject(new Error('bare-synthetic-secret')),
      },
    })
    await chooseOpenRouter(panel)
    await send(panel, { type: 'providers/connect' }, () => {
      expect(warnings.length).toBeGreaterThan(0)
    })
    expect(JSON.stringify(panel.webview.postMessage.mock.calls)).not.toContain(
      'bare-synthetic-secret',
    )
    expect(warnings.join(',')).not.toContain('bare-synthetic-secret')
  })
  it('retains a password-box draft for test, scan and save without crossing the bridge', async () => {
    const { panel, providers, saved } = setup()
    vi.mocked(window.showInputBox).mockResolvedValue('bare-synthetic-secret')
    await chooseOpenRouter(panel)
    await send(panel, { type: 'providers/enterKey', mode: 'new' }, () => {
      expect(latestState(panel).drafts.wizard?.keyPresent).toBe(true)
    })
    expect(await providers.providers()).toEqual([])
    await testTickAndSave(panel, 'openrouter', saved)
    expect(await providers.providers()).toHaveLength(1)
    expect(JSON.stringify(panel.webview.postMessage.mock.calls)).not.toContain(
      'bare-synthetic-secret',
    )
  })
  it('cancel drops a connected draft without persisting any provider', async () => {
    const { panel, providers } = setup()
    await chooseOpenRouter(panel)
    await send(panel, { type: 'providers/connect' }, () => {
      expect(latestState(panel).drafts.wizard?.connected).toBe(true)
    })
    await send(panel, { type: 'providers/wizard', event: 'cancel' }, () => {
      expect(latestState(panel).drafts.wizard).toBeUndefined()
    })
    expect(await providers.providers()).toEqual([])
  })
  it('carries a ticked local model window into the saved provider', async () => {
    // C-M95-4 R3: ticking a scanned local model on saves its server's
    // reported window, so the request path never meets a missing one.
    const rows = [localWindowedRow('qwen3:8b')]
    const { providers } = testProvidersHost({
      deps: {
        store: memoryProvidersStore([
          {
            id: 'ollama',
            preset: 'ollama',
            address: 'http://127.0.0.1:11434',
            auth: 'none',
            models: [],
          },
        ]),
        fetcher: { fetchModels: () => Promise.resolve({ rows }) },
      },
    })
    const { panel } = setup({ providers })
    await send(panel, { type: 'models/scan', providerId: 'ollama' }, () => {
      expect(latestState(panel).models).toHaveLength(1)
    })
    await send(
      panel,
      {
        type: 'models/tick',
        scope: { scope: 'provider', providerId: 'ollama' },
        ref: 'ollama/qwen3:8b',
        ticked: true,
      },
      () => {
        expect(latestState(panel).models[0]?.ticked).toBe(true)
      },
    )
    expect(await providers.providers()).toEqual([ollamaEntryWithWindow(['qwen3:8b'])])
  })

  it('saves a new local provider with its scanned window', async () => {
    // C-M95-4 R3: the panel wizard carries the scanned window the same
    // way the quick pick does.
    const rows = [localWindowedRow('qwen3:8b')]
    const { providers } = testProvidersHost({
      deps: {
        store: memoryProvidersStore([]),
        fetcher: { fetchModels: () => Promise.resolve({ rows }) },
      },
    })
    const { panel } = setup({ providers })
    await chooseOllama(panel)
    await testWizardDraft(panel)
    await tickWizardModel(panel, 'ollama/qwen3:8b', 'qwen3:8b')
    await send(panel, { type: 'providers/save', useNow: false }, () => {
      expect(latestState(panel).drafts.wizard).toBeUndefined()
    })
    expect(await providers.providers()).toEqual([
      { ...ollamaEntryWithWindow(['qwen3:8b']), privateNetwork: false },
    ])
  })

  it('pins and ticks provider models through top-level messages', async () => {
    const { providers } = testProvidersHost({
      deps: {
        store: memoryProvidersStore([{ ...TEST_ENTRY, models: ['m1'] }]),
        fetcher: { fetchModels: () => Promise.resolve({ rows: [testRow('m1')] }) },
      },
    })
    const { panel } = setup({ providers })
    await send(panel, { type: 'models/scan', providerId: TEST_ENTRY.id }, () => {
      expect(latestState(panel).models).toHaveLength(1)
    })
    await send(
      panel,
      { type: 'models/pin', providerId: TEST_ENTRY.id, ref: 'openrouter/m1', pinned: true },
      () => {
        expect(latestState(panel).models[0]?.pinned).toBe(true)
      },
    )
    await send(
      panel,
      {
        type: 'models/tick',
        scope: { scope: 'provider', providerId: TEST_ENTRY.id },
        ref: 'openrouter/m1',
        ticked: false,
      },
      () => {
        expect(latestState(panel).models[0]?.ticked).toBe(false)
      },
    )
  })
})

// The fixture catalogue above has two presets; the shipped one is the
// contract. A card the shared schema refuses once emptied the whole dropdown
// (0.16.0: Mistral's plan key carried a category the panel did not know).
function realCatalogue(
  store: ProvidersStore = memoryProvidersStore(),
  loopbackFetch?: typeof fetch,
) {
  const seam = createModelsPanelSeam({
    configFile: path.join(tmpdir(), 'models-panel-unused', 'providers.json'),
    subscriptionModels: () => Promise.resolve([]),
  })
  const providers = catalogueProviders(seam.catalog, store, {
    ...(loopbackFetch !== undefined && { loopbackFetch }),
  })
  return { ids: seam.catalog.ids(), providers, store }
}

/** Providers over `catalog` whose every scan answers the one model `m1`. */
function catalogueProviders(
  catalog: PresetCatalog,
  store: ProvidersStore = memoryProvidersStore(),
  extra: Partial<ProvidersHostDeps> = {},
): ModelsPanelDeps['providers'] {
  const { providers } = testProvidersHost({
    deps: {
      store,
      catalog,
      fetcher: { fetchModels: () => Promise.resolve({ rows: [testRow('m1')] }) },
      ...extra,
    },
  })
  return providers
}

/** The preset cards the ready panel lists over the shipped catalogue. */
async function shippedCards(): Promise<ModelsPanelState['presets']> {
  const { providers } = realCatalogue()
  const { panel } = setup({ providers })
  await send(panel, { type: 'modelsPanel/ready' }, () => {
    expect(latestState(panel).presets.length).toBeGreaterThan(0)
  })
  return latestState(panel).presets
}

/** `providers` with Mistral's plan preset in a format the card contract refuses. */
function withRefusedMistralPlan(
  providers: ModelsPanelDeps['providers'],
): ModelsPanelDeps['providers'] {
  return {
    ...providers,
    preset: (id: string) => {
      const preset = providers.preset(id)
      return id === 'mistral-plan' && preset !== undefined
        ? { ...preset, format: 'bare-synthetic-format' }
        : preset
    },
  }
}

/** A loopback fetch that answers 200 only on the given ports. */
function answeringFetch(ports: readonly number[]): typeof fetch {
  return (url: unknown) =>
    ports.map(String).includes(new URL(String(url)).port)
      ? Promise.resolve(new Response('{}', { status: 200 }))
      : Promise.reject(new Error('connection refused'))
}
describe('Models panel over the shipped preset catalogue', () => {
  it('lists every preset under its filter chip and opens each one', async () => {
    const store = memoryProvidersStore()
    const { ids, providers } = realCatalogue(store)
    const subscribe = (id: string, address: string) =>
      vi.fn(() => {
        store.current.push({ id, preset: id, address, auth: 'subscription', models: [] })
        return Promise.resolve()
      })
    const connectChatGpt = subscribe('chatgpt', 'https://api.openai.com')
    const connectCopilot = subscribe('copilot', 'https://github.com/copilot')
    const { panel, warnings } = setup({ providers, connectChatGpt, connectCopilot })
    await send(panel, { type: 'modelsPanel/ready' }, () => {
      expect(latestState(panel).presets.map((preset) => preset.id)).toEqual(ids)
    })
    expect(warnings).toEqual([])
    const category = new Map(latestState(panel).presets.map((card) => [card.id, card.category]))
    expect(category.get('anthropic')).toBe('cloud')
    expect(category.get('openrouter')).toBe('aggregator')
    expect(category.get('ollama')).toBe('local')
    expect(category.get('custom')).toBe('custom')
    for (const id of ['mistral-plan', 'chatgpt', 'copilot']) {
      expect(category.get(id)).toBe('subscription')
    }
    for (const id of ids) {
      if (id === 'chatgpt' || id === 'copilot') {
        const connect = id === 'chatgpt' ? connectChatGpt : connectCopilot
        await send(panel, { type: 'providers/select', presetId: id }, () => {
          expect(connect).toHaveBeenCalledOnce()
          expect(latestState(panel).scans[id]?.status).toBe('done')
        })
        continue
      }
      await send(panel, { type: 'providers/select', presetId: id }, () => {
        expect(latestState(panel).drafts.wizard).toMatchObject({ presetId: id, step: 'configure' })
      })
    }
    expect(warnings).toEqual([])
    expect(latestState(panel).notice).toBeUndefined()
  })
  it.each([
    { id: 'anthropic', key: 'sk-ant-bare-synthetic-secret', address: 'https://api.anthropic.com' },
    {
      id: 'custom',
      key: 'bare-synthetic-secret',
      address: 'https://llm.example',
      fields: {
        address: 'https://llm.example',
        customFormat: 'chat' as const,
        modelLimits: { m1: { contextTokens: 128_000, outputTokens: 4000 } },
      },
    },
  ])('adds $id through the wizard without the key crossing the bridge', async (row) => {
    const { providers } = realCatalogue()
    const { panel, saved, warnings } = setup({ providers })
    vi.mocked(window.showInputBox).mockResolvedValue(row.key)
    await send(panel, { type: 'providers/select', presetId: row.id }, () => {
      expect(latestState(panel).drafts.wizard?.presetId).toBe(row.id)
    })
    if (row.fields !== undefined) {
      await send(panel, { type: 'providers/prefill', fields: row.fields }, () => {
        expect(latestState(panel).drafts.wizard?.address).toBe(row.address)
      })
    }
    await send(panel, { type: 'providers/enterKey', mode: 'new' }, () => {
      expect(latestState(panel).drafts.wizard).toMatchObject({ keyPresent: true, keyShapeOk: true })
    })
    await testTickAndSave(panel, row.id, saved)
    expect(await providers.providers()).toMatchObject([
      {
        id: row.id,
        preset: row.id,
        address: row.address,
        models: ['m1'],
        ...(row.fields !== undefined && { format: row.fields.customFormat }),
      },
    ])
    expect(warnings).toEqual([])
    expect(JSON.stringify(panel.webview.postMessage.mock.calls)).not.toContain(
      'bare-synthetic-secret',
    )
  })
  it('offers every answering local server and fills the chosen port', async () => {
    const { providers } = realCatalogue(memoryProvidersStore(), answeringFetch([11_434, 1234]))
    const { panel, warnings } = setup({ providers })
    await send(panel, { type: 'providers/scanLocal' }, () => {
      expect(latestState(panel).localScan?.found).toHaveLength(2)
    })
    // Both answers are offered, in catalogue order, from preset data.
    expect(latestState(panel).localScan?.found).toEqual([
      { presetId: 'ollama', label: 'Ollama', port: 11_434 },
      { presetId: 'lmstudio', label: 'LM Studio', port: 1234 },
    ])
    // The scan finishes the scan, not the job: no wizard, no failure notice.
    expect(latestState(panel).drafts.wizard).toBeUndefined()
    expect(latestState(panel).notice).toBeUndefined()
    expect(warnings).toEqual([])
    // Choosing one opens its wizard with the answering port filled.
    await send(panel, { type: 'providers/select', presetId: 'lmstudio' }, () => {
      expect(latestState(panel).drafts.wizard?.presetId).toBe('lmstudio')
    })
    await send(panel, { type: 'providers/prefill', fields: { loopbackPort: 1234 } }, () => {
      expect(latestState(panel).drafts.wizard).toMatchObject({
        loopbackPort: 1234,
        address: 'http://127.0.0.1:1234',
      })
    })
    // A local wizard starts on its usual port even before choosing.
    await send(panel, { type: 'providers/select', presetId: 'ollama' }, () => {
      expect(latestState(panel).drafts.wizard).toMatchObject({
        loopbackPort: 11_434,
        address: 'http://127.0.0.1:11434',
      })
    })
  })
  it('says nothing is running when no local server answers', async () => {
    const { providers } = realCatalogue(memoryProvidersStore(), answeringFetch([]))
    const { panel, warnings } = setup({ providers })
    await send(panel, { type: 'providers/scanLocal' }, () => {
      expect(latestState(panel).localScan).toBeDefined()
    })
    expect(latestState(panel).localScan?.found).toEqual([])
    // Each local app with its usual port, from preset data, never hard-coded.
    expect(latestState(panel).localScan?.checked).toEqual([
      { presetId: 'ollama', label: 'Ollama', port: 11_434 },
      { presetId: 'lmstudio', label: 'LM Studio', port: 1234 },
      { presetId: 'vllm', label: 'vLLM', port: 8000 },
      { presetId: 'llamacpp', label: 'llama.cpp', port: 8080 },
    ])
    expect(latestState(panel).drafts.wizard).toBeUndefined()
    expect(latestState(panel).notice).toBeUndefined()
    expect(warnings).toEqual([])
  })
  it('gives the Mistral plan key its own label and sentence', async () => {
    const cards = await shippedCards()
    const mistral = cards.find((card) => card.id === 'mistral')
    const plan = cards.find((card) => card.id === 'mistral-plan')
    expect(mistral).toBeDefined()
    expect(plan).toBeDefined()
    expect(plan?.label).not.toBe(mistral?.label)
    expect(plan?.description).not.toBe(mistral?.description)
    expect(plan?.description).toContain('subscription')
  })
  it('gives Copilot its own sentence, not ChatGPT’s', async () => {
    const cards = await shippedCards()
    const chatgpt = cards.find((card) => card.id === 'chatgpt')
    const copilot = cards.find((card) => card.id === 'copilot')
    expect(chatgpt).toBeDefined()
    expect(copilot).toBeDefined()
    expect(copilot?.description).not.toBe(chatgpt?.description)
    expect(copilot?.description).toContain('Copilot plan')
  })
  it('leaves out only a preset the card contract refuses, naming no value', async () => {
    const { providers } = realCatalogue()
    const { panel, warnings } = setup({ providers: withRefusedMistralPlan(providers) })
    await send(panel, { type: 'modelsPanel/ready' }, () => {
      expect(latestState(panel).presets.map((card) => card.id)).toContain('anthropic')
    })
    expect(latestState(panel).presets.map((card) => card.id)).not.toContain('mistral-plan')
    expect(latestState(panel).notice).toBeUndefined()
    expect(warnings).toEqual(['Provider preset mistral-plan left out of the panel: format'])
  })
})

/** A seam on a temporary production file: saves really validate and write. */
async function productionSeam(resolve?: (host: string) => Promise<readonly string[]>): Promise<{
  folder: string
  configFile: string
  seam: ReturnType<typeof createModelsPanelSeam>
}> {
  const folder = await mkdtemp(path.join(tmpdir(), 'models-panel-round2-'))
  const configFile = path.join(folder, 'providers.json')
  const seam = createModelsPanelSeam({
    configFile,
    subscriptionModels: () => Promise.resolve([]),
    ...(resolve !== undefined && { resolve }),
  })
  return { folder, configFile, seam }
}

/**
 * An OpenRouter wizard on a private LAN address with its key entered, ready
 * for Test; `isConsented` answers the private-network question.
 */
async function privateAddressDraft(
  seam: ReturnType<typeof createModelsPanelSeam>,
  isConsented: boolean,
  deps: Pick<ProvidersHostDeps, 'tester' | 'fetcher'>,
): Promise<FakeWebviewPanel> {
  const host = testProvidersHost({
    confirmPrivateNetwork: () => Promise.resolve(isConsented),
    deps: {
      store: memoryProvidersStore(),
      policy: seam.policy,
      ...deps,
    },
  })
  const { panel } = setup({ providers: host.providers })
  vi.mocked(window.showInputBox).mockResolvedValue('bare-synthetic-secret')
  await chooseOpenRouter(panel)
  await send(
    panel,
    { type: 'providers/prefill', fields: { address: 'https://lan.example' } },
    () => {
      expect(latestState(panel).drafts.wizard?.address).toBe('https://lan.example')
    },
  )
  await send(panel, { type: 'providers/enterKey', mode: 'new' }, () => {
    expect(latestState(panel).drafts.wizard?.keyPresent).toBe(true)
  })
  return panel
}

/** The panel over the shipped catalogue of `seam`, with both sign-in connectors spied. */
function signInPanel(
  seam: ReturnType<typeof createModelsPanelSeam>,
  extra: Partial<ModelsPanelDeps>,
) {
  const connectChatGpt = vi.fn(() => Promise.resolve())
  const connectCopilot = vi.fn(() => Promise.resolve())
  const { panel } = setup({
    providers: catalogueProviders(seam.catalog),
    connectChatGpt,
    connectCopilot,
    ...extra,
  })
  return { panel, connectChatGpt, connectCopilot }
}

describe('PROVWIZ2 round 2 regressions', () => {
  it.each(['providers/edit', 'providers/enterKey'] as const)(
    'seeds saved custom limits on %s and saves edits through the production store',
    async (type) => {
      const { folder, seam } = await productionSeam()
      try {
        const { providers } = realCatalogue(seam.store)
        await providers.saveDraft({
          provider: {
            id: 'custom',
            preset: 'custom',
            auth: 'apiKey',
            address: 'https://llm.example',
            format: 'chat',
            models: ['m1'],
            modelLimits: { m1: { contextTokens: 128_000, outputTokens: 4000 } },
          },
          credential: 'synthetic-key',
          credentialAuth: 'apiKey',
          defaultModel: 'custom/m1',
          useNow: false,
        })
        const { panel, warnings } = setup({ providers })
        vi.mocked(window.showInputBox).mockResolvedValue('synthetic-replacement')
        await send(
          panel,
          { type, providerId: 'custom', ...(type === 'providers/enterKey' && { mode: 'change' }) },
          () => {
            expect(latestState(panel).drafts.edits['custom']).toBeDefined()
          },
        )
        expect(latestState(panel).drafts.edits['custom']).toMatchObject({
          customFormat: 'chat',
          modelLimits: { m1: { contextTokens: 128_000, outputTokens: 4000 } },
          blockers: [],
        })
        await send(
          panel,
          {
            type: 'providers/prefill',
            providerId: 'custom',
            fields: {
              address: 'https://llm.example/v2',
              modelLimits: { m1: { contextTokens: 256_000, outputTokens: 8000 } },
            },
          },
          () => {
            expect(latestState(panel).drafts.edits['custom']?.address).toBe(
              'https://llm.example/v2',
            )
          },
        )
        await send(
          panel,
          { type: 'providers/enterKey', mode: 'change', providerId: 'custom' },
          () => {
            expect(latestState(panel).drafts.edits['custom']?.keyPresent).toBe(true)
          },
        )
        await send(
          panel,
          { type: 'providers/test', acceptCost: false, providerId: 'custom' },
          () => {
            expect(latestState(panel).drafts.edits['custom']?.test?.status).toBe('ok')
          },
        )
        await send(panel, { type: 'providers/save', useNow: false, providerId: 'custom' }, () => {
          expect(latestState(panel).drafts.edits['custom']).toBeUndefined()
        })
        const stored = await seam.store.list()
        expect(stored).toHaveLength(1)
        expect(stored[0]).toMatchObject({
          address: 'https://llm.example/v2',
          format: 'chat',
          modelLimits: { m1: { contextTokens: 256_000, outputTokens: 8000 } },
        })
        expect(warnings).toEqual([])
      } finally {
        await rm(folder, { recursive: true, force: true })
      }
    },
  )

  it('returns through Test with incomplete custom limits kept and revalidates Models and Save', async () => {
    const { folder, seam } = await productionSeam()
    try {
      const { providers } = testProvidersHost({
        deps: { store: seam.store, catalog: seam.catalog },
      })
      const { panel } = setup({ providers })
      const saveDraft = vi.spyOn(providers, 'saveDraft')
      vi.mocked(window.showInputBox).mockResolvedValue('synthetic-key')
      await sendDraft(
        panel,
        { type: 'providers/select', presetId: 'custom' },
        { presetId: 'custom' },
      )
      await sendDraft(
        panel,
        {
          type: 'providers/prefill',
          fields: {
            address: 'https://llm.example',
            modelLimits: { m1: { contextTokens: 128_000 } },
          },
        },
        { address: 'https://llm.example' },
      )
      await sendDraft(
        panel,
        { type: 'models/tick', scope: { scope: 'wizard' }, ref: 'custom/m1', ticked: true },
        { models: ['m1'] },
      )
      await sendDraft(panel, { type: 'providers/enterKey', mode: 'new' }, { keyPresent: true })
      await sendDraft(
        panel,
        { type: 'providers/test', acceptCost: false },
        { test: { status: 'ok' } },
      )
      for (const step of ['credential', 'test', 'models'] as const) {
        await sendDraft(panel, { type: 'providers/wizard', event: 'next' }, { step })
      }
      expect(latestState(panel).drafts.wizard?.blockers).toEqual([UI_TEXT.customLimitsMissing])
      await sendDraft(panel, { type: 'providers/wizard', event: 'back' }, { step: 'test' })
      expect(latestState(panel).drafts.wizard?.blockers).toEqual([])
      expect(latestState(panel).drafts.wizard?.modelLimits).toEqual({
        m1: { contextTokens: 128_000 },
      })
      await sendDraft(panel, { type: 'providers/wizard', event: 'next' }, { step: 'models' })
      expect(latestState(panel).drafts.wizard?.blockers).toEqual([UI_TEXT.customLimitsMissing])
      await send(panel, { type: 'providers/save', useNow: false }, () => {
        expect(latestState(panel).drafts.wizard?.errors).toEqual([
          UI_TEXT.providerSaveWriteConflict,
        ])
        expect(latestState(panel).notice).toBeUndefined()
      })
      expect(saveDraft).not.toHaveBeenCalled()
      expect(await seam.store.list()).toEqual([])
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })

  it('saves a custom server with per-model limits through the production store', async () => {
    const { folder, configFile, seam } = await productionSeam()
    try {
      const { providers } = testProvidersHost({
        deps: {
          store: seam.store,
          catalog: seam.catalog,
          fetcher: { fetchModels: () => Promise.resolve({ rows: [testRow('m1')] }) },
        },
      })
      const { panel, saved, warnings } = setup({ providers })
      vi.mocked(window.showInputBox).mockResolvedValue('bare-synthetic-secret')
      await send(panel, { type: 'providers/select', presetId: 'custom' }, () => {
        expect(latestState(panel).drafts.wizard?.presetId).toBe('custom')
      })
      await send(
        panel,
        {
          type: 'providers/prefill',
          fields: { address: 'https://llm.example', customFormat: 'chat' },
        },
        () => {
          expect(latestState(panel).drafts.wizard?.address).toBe('https://llm.example')
        },
      )
      await send(panel, { type: 'providers/enterKey', mode: 'new' }, () => {
        expect(latestState(panel).drafts.wizard).toMatchObject({
          keyPresent: true,
          keyShapeOk: true,
        })
      })
      await send(panel, { type: 'providers/test', acceptCost: false }, () => {
        expect(latestState(panel).drafts.wizard?.test?.status).toBe('ok')
      })
      for (const step of ['credential', 'test', 'models']) {
        await send(panel, { type: 'providers/wizard', event: 'next' }, () => {
          expect(latestState(panel).drafts.wizard?.step).toBe(step)
        })
      }
      // The scan fills the reported context window; the longest reply is
      // still missing, so the blocker stands.
      expect(latestState(panel).drafts.wizard?.modelLimits).toEqual({
        m1: { contextTokens: 128_000 },
      })
      await send(
        panel,
        { type: 'models/tick', scope: { scope: 'wizard' }, ref: 'custom/m1', ticked: true },
        () => {
          expect(latestState(panel).drafts.wizard?.models).toEqual(['m1'])
        },
      )
      expect(latestState(panel).drafts.wizard?.blockers).toEqual([UI_TEXT.customLimitsMissing])
      await send(
        panel,
        {
          type: 'providers/prefill',
          fields: { modelLimits: { m1: { contextTokens: 128_000, outputTokens: 4000 } } },
        },
        () => {
          expect(latestState(panel).drafts.wizard?.blockers).toEqual([])
        },
      )
      await send(panel, { type: 'providers/save', useNow: true }, () => {
        expect(saved).toHaveBeenCalledOnce()
      })
      const savedFile = JSON.parse(await readFile(configFile, 'utf8')) as {
        providers: { id: string; modelLimits: Record<string, unknown> }[]
      }
      expect(savedFile.providers).toHaveLength(1)
      expect(savedFile.providers[0]?.id).toBe('custom')
      expect(savedFile.providers[0]?.modelLimits).toEqual({
        m1: { contextTokens: 128_000, outputTokens: 4000 },
      })
      expect(warnings).toEqual([])
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })

  // One panel per case: setup returns the first panel of the test.
  it('tests a private endpoint with the consent just granted', async () => {
    const resolve = vi.fn(() => Promise.resolve(['10.0.0.8']))
    const { folder, seam } = await productionSeam(resolve)
    try {
      const test = vi.fn(() => Promise.resolve({ kind: 'ok' as const, models: 2 }))
      const fetchModels = vi.fn(() => Promise.resolve({ rows: [testRow('m1')] }))
      const panel = await privateAddressDraft(seam, true, {
        tester: { test },
        fetcher: { fetchModels },
      })
      // The first Test after one consent sends once, with the grant on the
      // entry, and shows its result.
      await send(panel, { type: 'providers/test', acceptCost: false }, () => {
        expect(latestState(panel).drafts.wizard?.test?.status).toBe('ok')
      })
      expect(test).toHaveBeenCalledOnce()
      expect(test).toHaveBeenCalledWith(
        expect.objectContaining({ address: 'https://lan.example', privateNetwork: true }),
        'bare-synthetic-secret',
        false,
      )
      expect(fetchModels).toHaveBeenCalledWith(
        expect.objectContaining({ privateNetwork: true }),
        'bare-synthetic-secret',
      )
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })

  it('sends nothing when the private-network question is declined', async () => {
    const resolve = vi.fn(() => Promise.resolve(['10.0.0.8']))
    const { folder, seam } = await productionSeam(resolve)
    try {
      const declinedTest = vi.fn(() => Promise.resolve({ kind: 'ok' as const, models: 2 }))
      const declinedFetch = vi.fn(() => Promise.resolve({ rows: [testRow('m1')] }))
      const panel = await privateAddressDraft(seam, false, {
        tester: { test: declinedTest },
        fetcher: { fetchModels: declinedFetch },
      })
      await send(panel, { type: 'providers/test', acceptCost: false }, () => {
        expect(latestState(panel).notice).toBe(UI_TEXT.actionFailed)
      })
      expect(declinedTest).not.toHaveBeenCalled()
      expect(declinedFetch).not.toHaveBeenCalled()
      expect(latestState(panel).drafts.wizard?.test).toBeUndefined()
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })

  it('keeps valid saved providers when one preset card is refused', async () => {
    const { folder, seam } = await productionSeam()
    try {
      const store = memoryProvidersStore([
        {
          id: 'anthropic',
          preset: 'anthropic',
          address: 'https://api.anthropic.com',
          auth: 'apiKey',
          models: ['m1'],
        },
        {
          id: 'mistral-plan',
          preset: 'mistral-plan',
          address: 'https://api.mistral.ai/v1',
          auth: 'apiKey',
          models: ['mistral-medium'],
        },
      ])
      const providers = catalogueProviders(seam.catalog, store)
      const { panel, warnings } = setup({ providers: withRefusedMistralPlan(providers) })
      await send(panel, { type: 'modelsPanel/ready' }, () => {
        expect(latestState(panel).providers).toHaveLength(2)
      })
      const rows = latestState(panel).providers
      const anthropic = rows.find((row) => row.id === 'anthropic')
      const plan = rows.find((row) => row.id === 'mistral-plan')
      expect(anthropic?.unavailable).toBeUndefined()
      expect(anthropic?.label).toBe('Anthropic')
      expect(plan?.unavailable).toContain('mistral-plan')
      expect(latestState(panel).notice).toBeUndefined()
      expect(warnings).toEqual([
        'Provider preset mistral-plan left out of the panel: format',
        'Provider mistral-plan left out of the panel: mistral-plan',
      ])
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })

  // One panel per case: setup returns the first panel of the test.
  it('refuses ChatGPT sign-in in a remote window before any connector runs', async () => {
    const { folder, seam } = await productionSeam()
    try {
      const { panel, connectChatGpt } = signInPanel(seam, { isRemote: true })
      await send(panel, { type: 'providers/select', presetId: 'chatgpt' }, () => {
        expect(latestState(panel).notice).toBe(UI_TEXT.signInRemoteWindow)
      })
      expect(connectChatGpt).not.toHaveBeenCalled()
      await send(panel, { type: 'providers/connectSubscription', providerId: 'chatgpt' }, () => {
        expect(latestState(panel).notice).toBe(UI_TEXT.signInRemoteWindow)
      })
      expect(connectChatGpt).not.toHaveBeenCalled()
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })

  it('refuses Copilot sign-in in a confidential workspace before any connector runs', async () => {
    const { folder, seam } = await productionSeam()
    try {
      const { panel, connectCopilot } = signInPanel(seam, { isConfidential: () => true })
      await send(panel, { type: 'providers/select', presetId: 'copilot' }, () => {
        expect(latestState(panel).notice).toBe(UI_TEXT.planUi.copilotConfidential)
      })
      expect(connectCopilot).not.toHaveBeenCalled()
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })

  it('refuses a sign-in with no connector as not offered here', async () => {
    const { folder, seam } = await productionSeam()
    try {
      const { panel } = setup({ providers: catalogueProviders(seam.catalog) })
      await send(panel, { type: 'providers/select', presetId: 'chatgpt' }, () => {
        expect(latestState(panel).notice).toBe(UI_TEXT.signInNotOffered)
      })
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
})
