// M95 lane K (PLAN.md D74, M95 acceptance 19): the bundle entry composes
// the host with the seam — one panel tab, the quick pick end to end, the
// workspace suggestion, and the startup completion.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import { window } from 'vscode'
import { window as fakeWindow } from './mocks/vscode'
import { confirmModal, pickMany, pickOne } from './helpers/vscodeViews'
import {
  createModelsPanelFeatures,
  type ModelsPanelHostDeps,
  type ModelsPanelSeam,
} from '../../src/host/models/modelsPanelEntry'
import { readProviderCredential } from '../../src/host/providers/credentialRecords'
import { EN } from '../../src/shared/l10n/en'
import { scannedTwoModels, seamBase } from './helpers/m95kFixtures'
import { FakeWebviewPanel, memoryProvidersStore, memorySecrets } from './helpers/fakes'
import { FakeUri } from './mocks/vscode'

function seam(): { readonly seam: ModelsPanelSeam } {
  return {
    seam: {
      ...seamBase(),
      ...scannedTwoModels(),
      store: memoryProvidersStore(),
      tester: { test: () => Promise.resolve({ kind: 'ok', models: 2 }) },
    },
  }
}

function hostDeps(overrides: Partial<ModelsPanelHostDeps> = {}): {
  readonly host: ModelsPanelHostDeps
  readonly secrets: ReturnType<typeof memorySecrets>
  readonly composed: string[]
} {
  const secrets = memorySecrets()
  const composed: string[] = []
  return {
    secrets,
    composed,
    host: {
      secrets,
      extensionUri: new FakeUri('/ext'),
      l10n: { locale: 'en', table: EN },
      log: {
        trace: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      globalState: {
        get: () => undefined,
        update: () => Promise.resolve(),
      },
      suggestedProviderSetting: () => '',
      isRemote: false,
      setComposerModel: (modelRef) => {
        composed.push(modelRef)
        return Promise.resolve()
      },
      writeExportFile: () => Promise.resolve(),
      readImportFile: () => Promise.resolve(undefined),
      ...overrides,
    },
  }
}

beforeEach(() => {
  fakeWindow.createWebviewPanel.mockReset()
  fakeWindow.createWebviewPanel.mockImplementation(
    (viewType, title) => new FakeWebviewPanel(viewType, title),
  )
  for (const mock of [
    window.showQuickPick,
    window.showInputBox,
    window.showWarningMessage,
    window.showInformationMessage,
  ]) {
    vi.mocked(mock).mockReset()
  }
})

describe('createModelsPanelFeatures', () => {
  it('opens one panel tab and reopens it after disposal', () => {
    const { host } = hostDeps()
    const features = createModelsPanelFeatures(host, seam().seam)
    features.openPanel()
    features.openPanel({ wizard: true })
    expect(fakeWindow.createWebviewPanel).toHaveBeenCalledOnce()
    const panel = fakeWindow.createWebviewPanel.mock.results[0]?.value
    if (!(panel instanceof FakeWebviewPanel)) {
      throw new TypeError('expected the fake models panel')
    }
    panel.dispose()
    features.openPanel()
    expect(fakeWindow.createWebviewPanel).toHaveBeenCalledTimes(2)
  })

  it('runs the quick pick end to end through VS Code', async () => {
    const { host, secrets, composed } = hostDeps()
    const built = seam()
    const features = createModelsPanelFeatures(host, built.seam)
    // The rows keep the adapter's id beside the label: the single picks
    // answer with `id`, the multi pick with `quickPickId`.
    const openRouterRow: vscode.QuickPickItem & { readonly id: string } = {
      id: 'openrouter',
      label: 'OpenRouter',
    }
    const pasteRow: vscode.QuickPickItem & { readonly id: string } = {
      id: 'paste',
      label: 'Enter key…',
    }
    const modelRows: (vscode.QuickPickItem & { readonly quickPickId: string })[] = [
      { label: 'm1', quickPickId: 'm1' },
      { label: 'm2', quickPickId: 'm2' },
    ]
    const acceptModelRow: vscode.QuickPickItem & { readonly id: string } = {
      id: 'accept',
      label: 'Accept: m1',
    }
    const acceptBudgetRow: vscode.QuickPickItem & { readonly id: string } = {
      id: 'accept',
      label: 'Accept: 5.00',
    }
    vi.mocked(pickOne).mockResolvedValueOnce(openRouterRow).mockResolvedValueOnce(pasteRow)
    vi.mocked(pickMany).mockResolvedValueOnce(modelRows)
    vi.mocked(pickOne).mockResolvedValueOnce(acceptModelRow).mockResolvedValueOnce(acceptBudgetRow)
    vi.mocked(window.showInputBox).mockResolvedValueOnce('sk-or-pasted')
    vi.mocked(confirmModal).mockResolvedValueOnce('Save')
    const outcome = await features.runQuickPick()
    expect(outcome).toEqual({ providerId: 'openrouter', modelRef: 'openrouter/m1' })
    expect(composed).toEqual(['openrouter/m1'])
    expect(await built.seam.store.defaultModel()).toBe('openrouter/m1')
    expect(await readProviderCredential(secrets, 'openrouter')).toEqual({
      v: 1,
      auth: 'apiKey',
      origin: 'https://openrouter.ai',
      secret: 'sk-or-pasted',
    })
  })

  it('reads the workspace suggestion from the setting', () => {
    const suggested = hostDeps({ suggestedProviderSetting: () => 'openrouter' })
    const features = createModelsPanelFeatures(suggested.host, seam().seam)
    expect(features.suggestedPreset()).toBe('openrouter')
    const attacker = hostDeps({ suggestedProviderSetting: () => 'https://attacker.example/v1' })
    const refused = createModelsPanelFeatures(attacker.host, seam().seam)
    expect(refused.suggestedPreset()).toBeUndefined()
  })

  it.each([
    { id: 'openrouter', address: 'https://openrouter.ai', auth: 'oauth' },
    { id: 'x', address: 'https://x.example', auth: 'apiKey' },
  ])('finishes a stored $auth removal across a restart', async (entry) => {
    const values = new Map<string, unknown>([
      [
        'museSpark.providerPendingRemovals',
        [{ entry: { ...entry, presetId: entry.id, models: [] }, removedAt: 1 }],
      ],
    ])
    const { host, secrets } = hostDeps({
      globalState: {
        get: (key: string) => values.get(key),
        update: (key: string, value: unknown) => {
          values.set(key, value)
          return Promise.resolve()
        },
      },
    })
    await secrets.store(`museSpark.provider.${entry.id}`, '{"v":1}')
    const features = createModelsPanelFeatures(host, seam().seam)
    await features.completePendingRemovals()
    expect(await secrets.get(`museSpark.provider.${entry.id}`)).toBeUndefined()
    expect(values.get('museSpark.providerPendingRemovals')).toEqual([])
  })
})
