import { beforeEach, describe, expect, it, vi } from 'vitest'
import { window } from 'vscode'
import { createModelsPanel, type ModelsPanelDeps } from '../../src/host/models/modelsPanel'
import { parseHostToPanelMessage, type ModelsPanelState } from '../../src/shared/modelsPanel'
import { EN } from '../../src/shared/l10n/en'
import type { JudgePanelFacts } from '../../src/shared/judgePanel'
import { testProvidersHost, testRow } from './helpers/m95kFixtures'
import { FakeWebviewPanel, memoryProvidersStore } from './helpers/fakes'
import { window as fakeWindow, FakeUri } from './mocks/vscode'
import { judgeFacts, modelApiFacts, subscriptionFacts } from './judgePanelFixtures'

function setup(overrides: Partial<ModelsPanelDeps> = {}): {
  panel: FakeWebviewPanel
  warnings: string[]
  controller: ReturnType<typeof createModelsPanel>
} {
  const { providers } = testProvidersHost({
    deps: {
      store: memoryProvidersStore(),
      fetcher: { fetchModels: () => Promise.resolve({ rows: [testRow('m1')] }) },
    },
  })
  const warnings: string[] = []
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
    onWizardSaved: () => undefined,
    ...overrides,
  })
  const panel = fakeWindow.createWebviewPanel.mock.results.at(-1)?.value
  if (!(panel instanceof FakeWebviewPanel)) {
    throw new TypeError('Expected panel')
  }
  return { panel, warnings, controller }
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

function stateCount(panel: FakeWebviewPanel): number {
  return vi.mocked(panel.webview.postMessage).mock.calls.filter((call) => {
    const parsed = parseHostToPanelMessage(call[0])
    return parsed.ok && parsed.message.type === 'modelsPanel/state'
  }).length
}

beforeEach(() => {
  fakeWindow.createWebviewPanel.mockReset()
  fakeWindow.createWebviewPanel.mockImplementation(
    (viewType, title) => new FakeWebviewPanel(viewType, title),
  )
  vi.mocked(window.showInputBox).mockReset()
})

describe('judge panel host', () => {
  it('does not ask on reveal, ready, or a forged message for a subscription', async () => {
    const requestFirstCharge = vi.fn(() => Promise.resolve())
    const { panel, controller } = setup({
      judge: { read: () => subscriptionFacts(), requestFirstCharge },
    })
    controller.reveal()
    expect(requestFirstCharge).not.toHaveBeenCalled()
    expect(latestState(panel).judge?.askFirstCharge).toBe(false)
    expect(latestState(panel).judge?.showSubscriptionNote).toBe(true)
    const beforeReady = stateCount(panel)
    panel.webview.messages.fire({ type: 'modelsPanel/ready' })
    await vi.waitFor(() => {
      expect(stateCount(panel)).toBeGreaterThan(beforeReady)
    })
    expect(requestFirstCharge).not.toHaveBeenCalled()
    const beforeAsk = stateCount(panel)
    panel.webview.messages.fire({ type: 'judge/askConsent' })
    await vi.waitFor(() => {
      expect(stateCount(panel)).toBe(beforeAsk + 1)
    })
    expect(requestFirstCharge).not.toHaveBeenCalled()
    expect(latestState(panel).judge?.askFirstCharge).toBe(false)
  })

  it('asks once for a Model API charge and not again after the grant', async () => {
    let facts = modelApiFacts()
    const requestFirstCharge = vi.fn(() => {
      facts = { ...facts, consent: 'granted', reason: undefined }
      return Promise.resolve()
    })
    const { panel, controller } = setup({
      judge: { read: () => facts, requestFirstCharge },
    })
    controller.reveal()
    expect(requestFirstCharge).not.toHaveBeenCalled()
    expect(latestState(panel).judge?.askFirstCharge).toBe(true)
    const before = stateCount(panel)
    panel.webview.messages.fire({ type: 'judge/askConsent' })
    panel.webview.messages.fire({ type: 'judge/askConsent' })
    await vi.waitFor(() => {
      expect(stateCount(panel)).toBe(before + 2)
    })
    expect(requestFirstCharge).toHaveBeenCalledTimes(1)
    expect(latestState(panel).judge?.consent).toBe('granted')
    expect(latestState(panel).judge?.askFirstCharge).toBe(false)
  })

  it('asks when a paid source is selected on Muse Code', async () => {
    const requestFirstCharge = vi.fn(() => Promise.resolve())
    const { panel, controller } = setup({
      judge: {
        read: () =>
          judgeFacts({
            billing: 'subscription',
            paidSourceSelected: true,
            consent: 'needed',
            reason: 'consent-needed',
            inputPerMillion: 1,
            outputPerMillion: 4,
            dailyBudgetUsd: 2,
          }),
        requestFirstCharge,
      },
    })
    controller.reveal({ section: 'judge' })
    expect(requestFirstCharge).not.toHaveBeenCalled()
    const navigate = vi
      .mocked(panel.webview.postMessage)
      .mock.calls.map((call) => parseHostToPanelMessage(call[0]))
      .find((parsed) => parsed.ok && parsed.message.type === 'modelsPanel/navigate')
    expect(navigate?.ok).toBe(true)
    if (navigate?.ok && navigate.message.type === 'modelsPanel/navigate') {
      expect(navigate.message.section).toBe('judge')
    }
    const before = stateCount(panel)
    panel.webview.messages.fire({ type: 'judge/askConsent' })
    await vi.waitFor(() => {
      expect(stateCount(panel)).toBe(before + 1)
    })
    expect(requestFirstCharge).toHaveBeenCalledTimes(1)
  })

  it('publishes unavailable and does not ask when the report is unreadable', () => {
    const requestFirstCharge = vi.fn(() => Promise.resolve())
    const { panel, warnings, controller } = setup({
      judge: {
        read: () => {
          throw new Error('boom-secret-value')
        },
        requestFirstCharge,
      },
    })
    controller.reveal()
    expect(requestFirstCharge).not.toHaveBeenCalled()
    expect(latestState(panel).judge?.reason).toBe('source-unavailable')
    expect(latestState(panel).judge?.askFirstCharge).toBe(false)
    expect(warnings).toContain('Judge panel status could not be read')
    expect(warnings.join('\n')).not.toContain('boom-secret-value')
    const extra = setup({
      judge: {
        read: () => ({ ...subscriptionFacts(), unexpected: 'field' }) as JudgePanelFacts,
        requestFirstCharge,
      },
    })
    extra.controller.reveal()
    expect(requestFirstCharge).not.toHaveBeenCalled()
    expect(extra.warnings).toContain('Judge panel status could not be read')
    expect(JSON.stringify(latestState(extra.panel).judge)).not.toContain('unexpected')
  })

  it('says the judge is unavailable when no source lane is connected', () => {
    const { panel, controller } = setup()
    controller.reveal({ section: 'not-a-section' })
    expect(latestState(panel).judge?.reason).toBe('source-unavailable')
    expect(latestState(panel).judge?.askFirstCharge).toBe(false)
    const navigate = vi
      .mocked(panel.webview.postMessage)
      .mock.calls.map((call) => parseHostToPanelMessage(call[0]))
      .find((parsed) => parsed.ok && parsed.message.type === 'modelsPanel/navigate')
    if (navigate?.ok && navigate.message.type === 'modelsPanel/navigate') {
      expect(navigate.message.section).toBe('providers')
    }
  })
})
