import { beforeEach, describe, expect, it, vi } from 'vitest'
import { window } from 'vscode'
import { window as fakeWindow, FakeUri } from './mocks/vscode'
import { createModelsPanel, type ModelsPanelDeps } from '../../src/host/models/modelsPanel'
import type { PresetCatalog, PresetInfo } from '../../src/host/providers/providerPorts'
import { parseHostToPanelMessage, type ModelsPanelState } from '../../src/shared/modelsPanel'
import { EN } from '../../src/shared/l10n/en'
import { TEST_ENTRY, testProvidersHost, testRow } from './helpers/m95kFixtures'
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
function selectedProviders() {
  return testProvidersHost({
    deps: {
      store: memoryProvidersStore([{ ...TEST_ENTRY, models: ['m1'] }]),
      fetcher: { fetchModels: () => Promise.resolve({ rows: [testRow('m1')] }) },
    },
  })
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
beforeEach(() => {
  fakeWindow.createWebviewPanel.mockReset()
  fakeWindow.createWebviewPanel.mockImplementation(
    (viewType, title) => new FakeWebviewPanel(viewType, title),
  )
  vi.mocked(window.showInputBox).mockReset()
})
// Azure's seam entry carries no address (the user gives the resource), so
// the card must still ask for a resource and deployment, and the wizard's
// deployment must become the saved model id the turn sends.
const AZURE_SEAM_PRESET: PresetInfo = {
  id: 'azure',
  name: 'Azure OpenAI',
  description: 'Azure OpenAI v1 API on your own resource and deployment',
  kind: 'cloud',
  origin: '',
  format: 'responses',
  auth: 'apiKey',
  keyHint: 'Azure key',
  keyPage: '',
  isKeyShape: () => true,
  freeTest: 'none',
  localProbes: [],
}
const AZURE_CATALOG: PresetCatalog = {
  get: (id) => (id === 'azure' ? AZURE_SEAM_PRESET : undefined),
  has: (id) => id === 'azure',
  ids: () => ['azure'],
}
function azureHost(): ModelsPanelDeps['providers'] {
  return testProvidersHost({
    deps: { catalog: AZURE_CATALOG, store: memoryProvidersStore([]) },
  }).providers
}
describe('Models host contract', () => {
  it('sets editor-chat exposure idempotently and refuses references outside visible rows', async () => {
    const { providers } = selectedProviders()
    const selected = new Set<string>()
    const toggle = vi.fn((ref: string) => {
      if (selected.has(ref)) selected.delete(ref)
      else selected.add(ref)
      return Promise.resolve()
    })
    const { panel, warnings } = setup({
      providers,
      editorChat: { available: () => true, selected: (ref) => selected.has(ref), toggle },
    })
    await send(panel, { type: 'models/scan', providerId: TEST_ENTRY.id }, () => {
      expect(latestState(panel).models[0]?.editorChat).toBe(false)
    })
    const message = {
      type: 'models/tick',
      scope: { scope: 'editorChat' },
      ref: 'openrouter/m1',
      ticked: true,
    }
    await send(panel, message, () => {
      expect(latestState(panel).models[0]?.editorChat).toBe(true)
    })
    const before = panel.webview.postMessage.mock.calls.length
    await send(panel, message, () => {
      expect(panel.webview.postMessage.mock.calls.length).toBeGreaterThan(before)
    })
    expect(toggle).toHaveBeenCalledTimes(1)
    await send(panel, { ...message, ref: 'outside/model' }, () => {
      expect(warnings).toHaveLength(1)
    })
    expect(toggle).toHaveBeenCalledTimes(1)
  })
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
    await send(panel, { type: 'providers/test', acceptCost: false }, () => {
      expect(latestState(panel).drafts.wizard?.test?.status).toBe('ok')
    })
    await send(
      panel,
      { type: 'models/tick', scope: { scope: 'wizard' }, ref: 'openrouter/m1', ticked: true },
      () => {
        expect(latestState(panel).drafts.wizard?.models).toEqual(['m1'])
      },
    )
    await send(panel, { type: 'providers/save', useNow: true }, () => {
      expect(saved).toHaveBeenCalledOnce()
    })
    expect(await providers.providers()).toHaveLength(1)
    expect(JSON.stringify(panel.webview.postMessage.mock.calls)).not.toContain(
      'bare-synthetic-secret',
    )
  })
  it('lists Azure as an azure-resource card instead of a custom address box', async () => {
    const { panel } = setup({ providers: azureHost() })
    await send(panel, { type: 'modelsPanel/ready' }, () => {
      expect(latestState(panel).presets.map((preset) => preset.id)).toEqual(['azure'])
    })
    expect(latestState(panel).presets[0]?.originKind).toBe('azure-resource')
  })
  it('saves the Azure deployment as the request model', async () => {
    const providers = azureHost()
    const { panel, saved } = setup({ providers })
    vi.mocked(window.showInputBox).mockResolvedValue('bare-synthetic-secret')
    await send(panel, { type: 'providers/select', presetId: 'azure' }, () => {
      expect(latestState(panel).drafts.wizard?.presetId).toBe('azure')
    })
    await send(
      panel,
      { type: 'providers/prefill', fields: { azureResource: 'myres', deployment: 'my-deploy' } },
      () => {
        expect(latestState(panel).drafts.wizard?.address).toBe(
          'https://myres.openai.azure.com/openai/v1',
        )
      },
    )
    await send(panel, { type: 'providers/enterKey', mode: 'new' }, () => {
      expect(latestState(panel).drafts.wizard?.keyPresent).toBe(true)
    })
    await send(panel, { type: 'providers/test', acceptCost: false }, () => {
      expect(latestState(panel).drafts.wizard?.test?.status).toBe('ok')
    })
    await send(panel, { type: 'providers/save', useNow: true }, () => {
      expect(saved).toHaveBeenCalledOnce()
    })
    const entries = await providers.providers()
    expect(entries.map((entry) => entry.models)).toEqual([['my-deploy']])
    expect(entries[0]?.address).toBe('https://myres.openai.azure.com/openai/v1')
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
  it('pins and ticks provider models through top-level messages', async () => {
    const { providers } = selectedProviders()
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
