// The Models panel's host side over fakes, shared by its host tests: one
// panel opened through the real `createModelsPanel`, the state it posted
// last, and the message round trips the wizard tests drive.

import { expect, vi } from 'vitest'
import { window } from 'vscode'
import { createModelsPanel, type ModelsPanelDeps } from '../../../src/host/models/modelsPanel'
import { EN } from '../../../src/shared/l10n/en'
import { parseHostToPanelMessage, type ModelsPanelState } from '../../../src/shared/modelsPanel'
import { window as fakeWindow, FakeUri } from '../mocks/vscode'
import { FakeWebviewPanel, memorySessionBudgetConfig } from './fakes'

export interface OpenedModelsPanel {
  readonly panel: FakeWebviewPanel
  /** Every warning and error the panel logged, in order. */
  readonly warnings: string[]
  /** The panel's `onWizardSaved` callback. */
  readonly saved: ReturnType<typeof vi.fn>
}

/**
 * Each test starts with no panel opened yet, a fresh fake webview for the
 * next one, and an unscripted input box.
 */
export function resetModelsPanelWindow(): void {
  fakeWindow.createWebviewPanel.mockReset()
  fakeWindow.createWebviewPanel.mockImplementation(
    (viewType, title) => new FakeWebviewPanel(viewType, title),
  )
  vi.mocked(window.showInputBox).mockReset()
}

/**
 * Opens the Models panel over `deps.providers`, with a log that keeps its
 * warnings and errors, idle import and export ports and an in-memory
 * spending limit; anything else in `deps` replaces those defaults.
 */
export function openModelsPanel(
  deps: Pick<ModelsPanelDeps, 'providers'> & Partial<ModelsPanelDeps>,
): OpenedModelsPanel {
  const warnings: string[] = []
  const saved = vi.fn()
  createModelsPanel({
    extensionUri: new FakeUri('/ext'),
    l10n: { locale: 'en', table: EN },
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
    sessionBudget: memorySessionBudgetConfig(),
    ...deps,
  })
  const panel = fakeWindow.createWebviewPanel.mock.results[0]?.value
  if (!(panel instanceof FakeWebviewPanel)) {
    throw new TypeError('Expected panel')
  }
  return { panel, warnings, saved }
}

/** The last state the panel posted that passes the shared schema. */
export function latestState(panel: FakeWebviewPanel): ModelsPanelState {
  for (const call of vi.mocked(panel.webview.postMessage).mock.calls.toReversed()) {
    const parsed = parseHostToPanelMessage(call[0])
    if (parsed.ok && parsed.message.type === 'modelsPanel/state') {
      return parsed.message.state
    }
  }
  throw new Error('No valid state')
}

/** Posts `message` from the webview and waits until `done` passes. */
export async function send(
  panel: FakeWebviewPanel,
  message: unknown,
  done: () => void,
): Promise<void> {
  panel.webview.messages.fire(message)
  await vi.waitFor(done)
}

/** Opens the wizard on the OpenRouter preset. */
export async function chooseOpenRouter(panel: FakeWebviewPanel): Promise<void> {
  await send(panel, { type: 'providers/select', presetId: 'openrouter' }, () => {
    expect(latestState(panel).drafts.wizard?.presetId).toBe('openrouter')
  })
}

/** Runs the draft's free test, then ticks `<providerId>/m1` as its one model. */
export async function testAndTickFirstModel(
  panel: FakeWebviewPanel,
  providerId: string,
): Promise<void> {
  await send(panel, { type: 'providers/test', acceptCost: false }, () => {
    expect(latestState(panel).drafts.wizard?.test?.status).toBe('ok')
  })
  await send(
    panel,
    { type: 'models/tick', scope: { scope: 'wizard' }, ref: `${providerId}/m1`, ticked: true },
    () => {
      expect(latestState(panel).drafts.wizard?.models).toEqual(['m1'])
    },
  )
}
