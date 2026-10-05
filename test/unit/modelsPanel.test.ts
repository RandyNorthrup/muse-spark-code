// M95 lane K (PLAN.md D74, M95 acceptance 17 and the Tests' first-run
// items): the panel's WebviewPanel, its CSP and its zod-validated bridge.
// Unknown shapes are logged and dropped; the host validates and saves.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ViewColumn, window } from 'vscode'
import { window as fakeWindow } from './mocks/vscode'
import { createModelsPanel, type ModelsPanelDeps } from '../../src/host/models/modelsPanel'
import type { WizardSaveOutcome } from '../../src/host/providers/wizardSave'
import { saveProviderCredential } from '../../src/host/providers/credentialRecords'
import { EN } from '../../src/shared/l10n/en'
import { TEST_ENTRY, testProvidersHost, testRow } from './helpers/m95kFixtures'
import { FakeWebviewPanel, memoryProvidersStore } from './helpers/fakes'
import { FakeUri } from './mocks/vscode'

function panelDeps(overrides: Partial<ModelsPanelDeps> = {}): {
  readonly deps: ModelsPanelDeps
  readonly warnings: string[]
  readonly saved: WizardSaveOutcome[]
  readonly exported: string[]
} {
  const warnings: string[] = []
  const saved: WizardSaveOutcome[] = []
  const exported: string[] = []
  const { providers } = testProvidersHost({
    deps: {
      fetcher: { fetchModels: () => Promise.resolve({ rows: [testRow('m1')] }) },
    },
  })
  return {
    warnings,
    saved,
    exported,
    deps: {
      extensionUri: new FakeUri('/ext'),
      l10n: { locale: 'en', table: EN },
      log: {
        trace: () => undefined,
        info: () => undefined,
        warn: (message: string) => {
          warnings.push(message)
        },
        error: () => undefined,
      },
      providers,
      writeExportFile: (text) => {
        exported.push(text)
        return Promise.resolve()
      },
      readImportFile: () => Promise.resolve(undefined),
      confirmImport: () => Promise.resolve(true),
      onWizardSaved: (outcome) => {
        saved.push(outcome)
      },
      ...overrides,
    },
  }
}

function openedPanel(): FakeWebviewPanel {
  const panel = fakeWindow.createWebviewPanel.mock.results[0]?.value
  if (!(panel instanceof FakeWebviewPanel)) {
    throw new TypeError('expected the fake models panel')
  }
  return panel
}

beforeEach(() => {
  fakeWindow.createWebviewPanel.mockReset()
  fakeWindow.createWebviewPanel.mockImplementation(
    (viewType, title) => new FakeWebviewPanel(viewType, title),
  )
  vi.mocked(window.showInputBox).mockReset()
})

describe('createModelsPanel', () => {
  it('opens the panel with a strict CSP and the models bundle', () => {
    createModelsPanel(panelDeps().deps)
    const panel = openedPanel()
    expect(fakeWindow.createWebviewPanel).toHaveBeenCalledWith(
      'museSpark.modelsPanel',
      'Models & Agents',
      ViewColumn.One,
      { retainContextWhenHidden: true },
    )
    expect(panel.webview.html).toContain('dist/webview/models.js')
    expect(panel.webview.html).toContain("script-src 'nonce-")
    expect(panel.webview.html).not.toMatch(/src="http/)
    expect(panel.webview.html).not.toMatch(/href="http/)
    expect(panel.webview.options).toMatchObject({
      enableScripts: true,
      localResourceRoots: expect.any(Array),
    })
  })

  it('drops malformed messages and unknown sections in the log', async () => {
    const parts = panelDeps()
    createModelsPanel(parts.deps)
    const panel = openedPanel()
    panel.webview.messages.fire('not an object')
    panel.webview.messages.fire({ type: 'models/tick', payload: { id: 'm1' } })
    await vi.waitFor(() => {
      expect(parts.warnings).toHaveLength(2)
    })
    expect(panel.webview.postMessage).not.toHaveBeenCalled()
  })

  it('prefills a preset without any secret, and names an unknown one', async () => {
    const parts = panelDeps()
    createModelsPanel(parts.deps)
    const panel = openedPanel()
    panel.webview.messages.fire({ type: 'providers/select', payload: { presetId: 'openrouter' } })
    await vi.waitFor(() => {
      expect(panel.webview.postMessage).toHaveBeenCalled()
    })
    const prefilled = vi.mocked(panel.webview.postMessage).mock.calls[0]?.[0] as {
      type: string
      state: Record<string, unknown>
    }
    expect(prefilled.type).toBe('providers/prefilled')
    expect(prefilled.state).toMatchObject({ presetId: 'openrouter', name: 'OpenRouter' })
    // The shape hint renders; a secret never does.
    expect(prefilled.state).toMatchObject({ keyHint: 'sk-or-…' })
    expect(prefilled.state).not.toHaveProperty('secret')
    panel.webview.messages.fire({ type: 'providers/select', payload: { presetId: 'nope' } })
    await vi.waitFor(() => {
      expect(parts.warnings.length).toBeGreaterThan(0)
    })
  })

  it('takes the key through the password box, never the webview', async () => {
    createModelsPanel(panelDeps().deps)
    const panel = openedPanel()
    vi.mocked(window.showInputBox).mockResolvedValue('sk-or-x')
    panel.webview.messages.fire({ type: 'providers/enterKey', payload: { presetId: 'openrouter' } })
    await vi.waitFor(() => {
      expect(panel.webview.postMessage).toHaveBeenCalledWith({
        type: 'providers/keyState',
        state: { presetId: 'openrouter', hasKey: true },
      })
    })
  })

  it('tests the stored credential and scans its models', async () => {
    const { providers, secrets } = testProvidersHost({
      deps: {
        fetcher: { fetchModels: () => Promise.resolve({ rows: [testRow('m1')] }) },
      },
    })
    await saveProviderCredential(secrets, 'openrouter', {
      v: 1,
      auth: 'oauth',
      origin: 'https://openrouter.ai',
      secret: 'sk-or-test-key',
    })
    createModelsPanel(panelDeps({ providers }).deps)
    const panel = openedPanel()
    panel.webview.messages.fire({ type: 'providers/test', payload: { id: 'openrouter' } })
    await vi.waitFor(() => {
      expect(panel.webview.postMessage).toHaveBeenCalledWith({
        type: 'providers/tested',
        state: { id: 'openrouter', result: { kind: 'ok', models: 3 } },
      })
    })
    panel.webview.messages.fire({ type: 'models/scan', payload: { id: 'openrouter' } })
    await vi.waitFor(() => {
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'models/scanned' }),
      )
    })
  })

  it('saves a draft through Save, writing file and secret together', async () => {
    const { providers } = testProvidersHost({ deps: { store: memoryProvidersStore() } })
    const parts = panelDeps({ providers })
    createModelsPanel(parts.deps)
    const panel = openedPanel()
    panel.webview.messages.fire({
      type: 'providers/save',
      payload: {
        provider: {
          id: 'openrouter',
          presetId: 'openrouter',
          address: 'https://openrouter.ai',
          auth: 'oauth',
          models: ['openai/gpt-oss-20b'],
        },
        credential: 'sk-or-saved',
        credentialAuth: 'oauth',
        defaultModel: 'openrouter/openai/gpt-oss-20b',
        useNow: true,
      },
    })
    await vi.waitFor(() => {
      expect(parts.saved).toHaveLength(1)
    })
    expect(parts.saved[0]).toMatchObject({
      providerId: 'openrouter',
      modelRef: 'openrouter/openai/gpt-oss-20b',
      composerSet: true,
    })
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'providers/saved',
      state: {
        providerId: 'openrouter',
        modelRef: 'openrouter/openai/gpt-oss-20b',
        composerSet: true,
      },
    })
  })

  it('removes with undo, and exports and imports the file', async () => {
    const parts = panelDeps({
      readImportFile: () =>
        Promise.resolve(JSON.stringify({ version: 1, providers: [TEST_ENTRY] })),
    })
    createModelsPanel(parts.deps)
    const panel = openedPanel()
    panel.webview.messages.fire({ type: 'providers/remove', payload: { id: 'openrouter' } })
    await vi.waitFor(() => {
      expect(panel.webview.postMessage).toHaveBeenCalledWith({
        type: 'providers/removed',
        state: { id: 'openrouter', removed: true },
      })
    })
    panel.webview.messages.fire({ type: 'providers/undo', payload: { id: 'openrouter' } })
    await vi.waitFor(() => {
      expect(panel.webview.postMessage).toHaveBeenCalledWith({
        type: 'providers/unremoved',
        state: { id: 'openrouter', restored: true },
      })
    })
    panel.webview.messages.fire({ type: 'providers/export' })
    await vi.waitFor(() => {
      expect(parts.exported).toHaveLength(1)
    })
    // The text is this lane's own export; the cast names its document shape
    // for the count assertion (PLAN.md §8). A foreign shape is covered by
    // the malformed-import tests, which never reach this cast.
    const exported = JSON.parse(parts.exported[0] ?? '') as { providers: readonly unknown[] }
    expect(exported.providers).toHaveLength(1)
    panel.webview.messages.fire({ type: 'providers/importPreview' })
    await vi.waitFor(() => {
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'providers/importPreviewed' }),
      )
    })
  })
})
