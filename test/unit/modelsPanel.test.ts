import { beforeEach, describe, expect, it, vi } from 'vitest'
import { window } from 'vscode'
import { window as fakeWindow, FakeUri } from './mocks/vscode'
import { createModelsPanel, type ModelsPanelDeps } from '../../src/host/models/modelsPanel'
import { parseHostToPanelMessage, type ModelsPanelState } from '../../src/shared/modelsPanel'
import { EN } from '../../src/shared/l10n/en'
import {
  localWindowedRow,
  ollamaEntryWithWindow,
  TEST_ENTRY,
  testProvidersHost,
  testRow,
} from './helpers/m95kFixtures'
import { FakeWebviewPanel, memoryProvidersStore } from './helpers/fakes'

function setup(overrides: Partial<ModelsPanelDeps> = {}): {
  panel: FakeWebviewPanel
  warnings: string[]
  saved: ReturnType<typeof vi.fn>
  providers: ModelsPanelDeps['providers']
} {
  const { providers } = testProvidersHost({
    deps: {
      store: memoryProvidersStore(),
      fetcher: { fetchModels: () => Promise.resolve({ rows: [testRow('m1')] }) },
    },
  })
  const warnings: string[] = []
  const saved = vi.fn()
  createModelsPanel({
    extensionUri: new FakeUri('/ext'),
    l10n: { locale: 'en', table: EN },
    providers,
    log: {
      trace: () => undefined,
      info: () => undefined,
      error: (message) => {
        warnings.push(message)
      },
      warn: (message) => {
        warnings.push(message)
      },
    },
    writeExportFile: () => Promise.resolve(),
    readImportFile: () => Promise.resolve(undefined),
    confirmImport: () => Promise.resolve(true),
    onWizardSaved: saved,
    ...overrides,
  })
  const panel = fakeWindow.createWebviewPanel.mock.results[0]?.value
  if (!(panel instanceof FakeWebviewPanel)) {
    throw new TypeError('Expected panel')
  }
  return { panel, warnings, saved, providers: overrides.providers ?? providers }
}
function latestState(panel: FakeWebviewPanel): ModelsPanelState {
  for (const call of vi.mocked(panel.webview.postMessage).mock.calls.toReversed()) {
    const parsed = parseHostToPanelMessage(call[0])
    if (parsed.ok && parsed.message.type === 'modelsPanel/state') {
      return parsed.message.state
    }
  }
  throw new Error('No valid state')
}
async function send(panel: FakeWebviewPanel, message: unknown, done: () => void): Promise<void> {
  panel.webview.messages.fire(message)
  await vi.waitFor(done)
}
async function chooseOpenRouter(panel: FakeWebviewPanel): Promise<void> {
  await send(panel, { type: 'providers/select', presetId: 'openrouter' }, () => {
    expect(latestState(panel).drafts.wizard?.presetId).toBe('openrouter')
  })
}
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
beforeEach(() => {
  fakeWindow.createWebviewPanel.mockReset()
  fakeWindow.createWebviewPanel.mockImplementation(
    (viewType, title) => new FakeWebviewPanel(viewType, title),
  )
  vi.mocked(window.showInputBox).mockReset()
})
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
    await testWizardDraft(panel)
    await tickWizardModel(panel, 'openrouter/m1', 'm1')
    await send(panel, { type: 'providers/save', useNow: true }, () => {
      expect(saved).toHaveBeenCalledOnce()
    })
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
