// The Models panel host's shared test harness: one fake window, one
// provider host and one log per panel, so the panel's contract tests share
// a single setup instead of cloning it.
import { vi } from 'vitest'
import { window as fakeWindow, FakeUri } from '../mocks/vscode'
import {
  createModelsPanel,
  type ModelsPanel,
  type ModelsPanelDeps,
} from '../../../src/host/models/modelsPanel'
import { parseHostToPanelMessage, type ModelsPanelState } from '../../../src/shared/modelsPanel'
import { EN } from '../../../src/shared/l10n/en'
import { testProvidersHost, testRow } from './m95kFixtures'
import { FakeWebviewPanel, memoryProvidersStore } from './fakes'

export interface ModelsPanelTest {
  readonly created: ModelsPanel
  readonly panel: FakeWebviewPanel
  readonly warnings: string[]
  readonly saved: ReturnType<typeof vi.fn>
  readonly providers: ModelsPanelDeps['providers']
}

/** A panel over a one-row provider host; overrides replace any dep. */
export function setupModelsPanel(overrides: Partial<ModelsPanelDeps> = {}): ModelsPanelTest {
  const { providers } = testProvidersHost({
    deps: {
      store: memoryProvidersStore(),
      fetcher: { fetchModels: () => Promise.resolve({ rows: [testRow('m1')] }) },
    },
  })
  const warnings: string[] = []
  const saved = vi.fn()
  const created = createModelsPanel({
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
  return { created, panel, warnings, saved, providers: overrides.providers ?? providers }
}

/** The host's latest published state; throws until the first publish. */
export function latestPanelState(panel: FakeWebviewPanel): ModelsPanelState {
  for (const call of vi.mocked(panel.webview.postMessage).mock.calls.toReversed()) {
    const parsed = parseHostToPanelMessage(call[0])
    if (parsed.ok && parsed.message.type === 'modelsPanel/state') {
      return parsed.message.state
    }
  }
  throw new Error('No valid state')
}

/** Fires a webview message and waits until the host's reply lands. */
export async function sendPanelMessage(
  panel: FakeWebviewPanel,
  message: unknown,
  done: () => void,
): Promise<void> {
  panel.webview.messages.fire(message)
  await vi.waitFor(done)
}
