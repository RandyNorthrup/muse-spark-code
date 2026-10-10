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
  setComposerModelConfirmed,
  type ModelsPanelHostDeps,
  type ModelsPanelSeam,
} from '../../src/host/models/modelsPanelEntry'
import { readProviderCredential } from '../../src/host/providers/credentialRecords'
import { EN } from '../../src/shared/l10n/en'
import { scannedTwoModels, seamBase } from './helpers/m95kFixtures'
import { FakeWebviewPanel, memoryProvidersStore, memorySecrets } from './helpers/fakes'
import { FakeUri } from './mocks/vscode'
import { fakeSurface } from './helpers/fakes'
import { recoverProviderRemovals } from '../../src/host/models/modelsPanelBundle'
import { panelRig } from './helpers/teamPanelRig'
import { parseHostToPanelMessage } from '../../src/shared/modelsPanel'
import * as teamPanelFactory from '../../src/core/team/teamPanelEntry'

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

function hostWithState(values: Map<string, unknown>): ReturnType<typeof hostDeps> {
  return hostDeps({
    globalState: {
      get: (key) => values.get(key),
      update: (key, value) => {
        values.set(key, value)
        return Promise.resolve()
      },
    },
  })
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

const unsubscribeTeamTree = () => undefined

function teamEditorPanel(hasConfiguration: boolean) {
  const rig = panelRig({ confirmOrchestrator: vi.fn(() => Promise.resolve()) })
  const binding = {
    isEnabled: () => true,
    state: rig.deps.state,
    reload: rig.reload,
    onTreeChange: () => unsubscribeTeamTree,
    tree: () => undefined,
    handle: () => Promise.resolve(),
    ...(hasConfiguration && {
      configuration: {
        offers: rig.deps.offers,
        defaultRef: rig.deps.defaultRef,
        maxWorkers: rig.deps.maxWorkers,
        remainingDailyBudgetUsd: rig.deps.remainingDailyBudgetUsd,
        records: rig.deps.records,
        confirmOrchestrator: rig.deps.confirmOrchestrator,
      },
    }),
  }
  const { host, composed } = hostDeps({ team: binding })
  const features = createModelsPanelFeatures(host, seam().seam)
  features.openPanel({ section: 'roles' })
  const panel = fakeWindow.createWebviewPanel.mock.results[0]?.value
  if (!(panel instanceof FakeWebviewPanel)) throw new TypeError('Expected team panel')
  const latest = () => {
    for (const [raw] of panel.webview.postMessage.mock.calls.toReversed()) {
      const parsed = parseHostToPanelMessage(raw)
      if (parsed.ok && parsed.message.type === 'modelsPanel/state') return parsed.message.state
    }
    return undefined
  }
  panel.webview.messages.fire({ type: 'modelsPanel/ready' })
  return { panel, latest, composed, rig }
}

describe('createModelsPanelFeatures', () => {
  it('keeps sections hidden when the engine is enabled but configuration ports are absent', async () => {
    const factory = vi.spyOn(teamPanelFactory, 'createTeamPanel')
    try {
      const { panel, latest, rig } = teamEditorPanel(false)
      await vi.waitFor(() => {
        expect(latest()?.presets.length).toBeGreaterThan(0)
      })
      expect(latest()?.roles).toBeUndefined()
      expect(latest()?.agents).toBeUndefined()
      expect(rig.update).not.toHaveBeenCalled()
      expect(factory).not.toHaveBeenCalled()
      panel.dispose()
    } finally {
      factory.mockRestore()
    }
  })
  it('uses the captured configuration ports and saves without changing the current composer', async () => {
    const { panel, latest, composed, rig } = teamEditorPanel(true)
    await vi.waitFor(() => {
      expect(latest()?.roles).toBeDefined()
    })
    panel.webview.messages.fire({ type: 'roles/template', template: 'pair' })
    await vi.waitFor(() => {
      expect(latest()?.roles?.document.roles).toHaveLength(2)
    })
    panel.webview.messages.fire({ type: 'roles/orchestrator', modelRef: 'main/main' })
    panel.webview.messages.fire({ type: 'roles/save' })
    await vi.waitFor(() => {
      expect(rig.reload).toHaveBeenCalledOnce()
    })
    expect(rig.deps.confirmOrchestrator).toHaveBeenCalledWith('main/main')
    expect(composed).toEqual([])
    panel.dispose()
  })

  it('rejects a void model refusal and restores the surface post method', async () => {
    const surface = fakeSurface('receipt')
    const previous = surface.post
    await expect(
      setComposerModelConfirmed(surface, 'openrouter/m1', () => Promise.resolve()),
    ).rejects.toThrow()
    expect(surface.post).toBe(previous)
    await setComposerModelConfirmed(surface, 'openrouter/m1', () => {
      surface.post({ type: 'sessionInfo', modelId: 'openrouter/m1' })
      return Promise.resolve()
    })
    expect(surface.post).toBe(previous)
  })
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

  it('keeps a stored OAuth entry across a restart', async () => {
    const values = new Map<string, unknown>([
      [
        'museSpark.providerPendingRemovals',
        [
          {
            entry: {
              id: 'openrouter',
              preset: 'openrouter',
              address: 'https://openrouter.ai',
              auth: 'apiKey',
              models: [],
            },
            removedAt: 1,
          },
        ],
      ],
    ])
    const { host, secrets } = hostWithState(values)
    await secrets.store('museSpark.provider.openrouter', '{"v":1}')
    const features = createModelsPanelFeatures(host, seam().seam)
    await features.completePendingRemovals()
    expect(await secrets.get('museSpark.provider.openrouter')).toBeUndefined()
  })

  it('finishes removals left behind at the next start', async () => {
    const values = new Map<string, unknown>([
      [
        'museSpark.providerPendingRemovals',
        [
          {
            entry: {
              id: 'x',
              preset: 'x',
              address: 'https://x.example',
              auth: 'apiKey',
              models: [],
            },
            removedAt: 1,
          },
        ],
      ],
    ])
    const { host, secrets } = hostWithState(values)
    const features = createModelsPanelFeatures(host, seam().seam)
    await recoverProviderRemovals(
      values.get('museSpark.providerPendingRemovals'),
      () => features,
      host.log,
    )
    expect(fakeWindow.createWebviewPanel).not.toHaveBeenCalled()
    expect(await secrets.get('museSpark.provider.x')).toBeUndefined()
    expect(values.get('museSpark.providerPendingRemovals')).toEqual([])
  })
})
