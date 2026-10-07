import { beforeEach, vi } from 'vitest'
import { window } from 'vscode'
import { window as fakeWindow, FakeUri } from '../mocks/vscode'
import { createModelsPanel, type ModelsPanelDeps } from '../../../src/host/models/modelsPanel'
import { parseHostToPanelMessage, type ModelsPanelState } from '../../../src/shared/modelsPanel'
import { EN } from '../../../src/shared/l10n/en'
import { testProvidersHost, testRow } from './m95kFixtures'
import { FakeWebviewPanel, memoryProvidersStore } from './fakes'

export function setup(overrides: Partial<ModelsPanelDeps> = {}): {
  panel: FakeWebviewPanel
  warnings: string[]
  saved: ReturnType<typeof vi.fn>
  providers: ModelsPanelDeps['providers']
  controller: ReturnType<typeof createModelsPanel>
} {
  const { providers } = testProvidersHost({
    deps: {
      store: memoryProvidersStore(),
      fetcher: { fetchModels: () => Promise.resolve({ rows: [testRow('m1')] }) },
    },
  })
  const warnings: string[] = []
  const saved = vi.fn()
  const controller = createModelsPanel({
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
  const panel = fakeWindow.createWebviewPanel.mock.results.at(-1)?.value
  if (!(panel instanceof FakeWebviewPanel)) {
    throw new TypeError('Expected panel')
  }
  return { panel, warnings, saved, controller, providers: overrides.providers ?? providers }
}
export function latestState(panel: FakeWebviewPanel): ModelsPanelState {
  for (const call of vi.mocked(panel.webview.postMessage).mock.calls.toReversed()) {
    const parsed = parseHostToPanelMessage(call[0])
    if (parsed.ok && parsed.message.type === 'modelsPanel/state') {
      return parsed.message.state
    }
  }
  throw new Error('No valid state')
}
export function resetModelsPanelMocks() {
  beforeEach(() => {
    fakeWindow.createWebviewPanel.mockReset()
    fakeWindow.createWebviewPanel.mockImplementation(
      (viewType, title) => new FakeWebviewPanel(viewType, title),
    )
    vi.mocked(window.showInputBox).mockReset()
  })
}
