import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { window } from 'vscode'
import { window as fakeWindow, FakeUri } from './mocks/vscode'
import { createModelsPanelSeam } from '../../src/core/providers/panelSeam'
import { createModelsPanel, type ModelsPanelDeps } from '../../src/host/models/modelsPanel'
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
function realCatalogue(store = memoryProvidersStore()) {
  const seam = createModelsPanelSeam({
    configFile: path.join(tmpdir(), 'models-panel-unused', 'providers.json'),
    subscriptionModels: () => Promise.resolve([]),
  })
  const { providers } = testProvidersHost({
    deps: {
      store,
      catalog: seam.catalog,
      fetcher: { fetchModels: () => Promise.resolve({ rows: [testRow('m1')] }) },
    },
  })
  return { ids: seam.catalog.ids(), providers, store }
}
describe('Models panel over the shipped preset catalogue', () => {
  it('lists every preset under its filter chip and opens each one', async () => {
    const { ids, providers, store } = realCatalogue()
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
      fields: { address: 'https://llm.example', customFormat: 'chat' as const },
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
    await send(panel, { type: 'providers/test', acceptCost: false }, () => {
      expect(latestState(panel).drafts.wizard?.test?.status).toBe('ok')
    })
    await send(
      panel,
      { type: 'models/tick', scope: { scope: 'wizard' }, ref: `${row.id}/m1`, ticked: true },
      () => {
        expect(latestState(panel).drafts.wizard?.models).toEqual(['m1'])
      },
    )
    await send(panel, { type: 'providers/save', useNow: true }, () => {
      expect(saved).toHaveBeenCalledOnce()
    })
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
  it('leaves out only a preset the card contract refuses, naming no value', async () => {
    const { providers } = realCatalogue()
    const stale = {
      ...providers,
      preset: (id: string) => {
        const preset = providers.preset(id)
        return id === 'mistral-plan' && preset !== undefined
          ? { ...preset, format: 'bare-synthetic-format' }
          : preset
      },
    }
    const { panel, warnings } = setup({ providers: stale })
    await send(panel, { type: 'modelsPanel/ready' }, () => {
      expect(latestState(panel).presets.map((card) => card.id)).toContain('anthropic')
    })
    expect(latestState(panel).presets.map((card) => card.id)).not.toContain('mistral-plan')
    expect(latestState(panel).notice).toBeUndefined()
    expect(warnings).toEqual(['Provider preset mistral-plan left out of the panel: format'])
  })
})
