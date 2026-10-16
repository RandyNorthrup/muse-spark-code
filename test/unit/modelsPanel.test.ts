import { beforeEach, describe, expect, it, vi } from 'vitest'
import { window } from 'vscode'
import { window as fakeWindow } from './mocks/vscode'
import { parseHostToPanelMessage } from '../../src/shared/modelsPanel'
import { TEST_ENTRY, testProvidersHost, testRow } from './helpers/m95kFixtures'
import { FakeWebviewPanel, memoryProvidersStore } from './helpers/fakes'
import {
  latestPanelState as latestState,
  sendPanelMessage as send,
  setupModelsPanel as setup,
} from './helpers/modelsPanelHarness'
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
