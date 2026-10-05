import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UsagePanel } from '../../src/host/usage/usagePanel'
import { usagePanelLoader } from '../../src/host/usage/usagePanelBundle'
import { createUsagePanel } from '../../src/host/usage/usagePanelEntry'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { USAGE_TEXT } from '../../src/shared/l10n/usageTable'
import { EN } from '../../src/shared/l10n/en'
import { FakeWebviewPanel, fakeHostContext } from './helpers/fakes'
import { fakeUsageAccess, usageState } from './helpers/usageAdapters'
import { commands, env, Uri, window, workspace } from './mocks/vscode'

const { confirm, updateHistory } = vi.hoisted(() => ({
  confirm: vi.fn<(...args: unknown[]) => Promise<string | undefined>>(),
  updateHistory: vi.fn<(...args: unknown[]) => Promise<void>>(),
}))
vi.mock('vscode', async () => {
  const fake = await import('./mocks/vscode')
  return {
    ...fake,
    ConfigurationTarget: { Global: 1 },
    window: { ...fake.window, showWarningMessage: confirm },
    workspace: { ...fake.workspace, getConfiguration: () => ({ update: updateHistory }) },
  }
})

function openPanel() {
  const fake = fakeUsageAccess()
  const context = fakeHostContext()
  const openModels = vi.fn().mockResolvedValue(undefined)
  const panel = new UsagePanel({
    ...context,
    usage: fake.usage,
    journalFolder: Uri.file('/data/usage'),
    openModels,
  })
  panel.open()
  const tab: unknown = window.createWebviewPanel.mock.results.at(-1)?.value
  if (!(tab instanceof FakeWebviewPanel)) throw new TypeError('expected usage tab')
  const ports = fake.connections[0]
  if (ports === undefined) throw new TypeError('expected usage ports')
  return { ...fake, context, panel, tab, ports, openModels }
}

describe('UsagePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.createWebviewPanel.mockImplementation((type, title) => new FakeWebviewPanel(type, title))
    commands.executeCommand.mockResolvedValue(undefined)
    window.showSaveDialog.mockResolvedValue(undefined)
    confirm.mockResolvedValue(undefined)
    updateHistory.mockResolvedValue(undefined)
    workspace.fs.writeFile.mockResolvedValue(undefined)
  })

  it('uses only local usage assets under the unchanged security policy and reveals one tab', () => {
    const { panel, tab } = openPanel()
    expect(window.createWebviewPanel).toHaveBeenCalledWith(
      'museSpark.usagePanel',
      'Usage & cost',
      1,
      {},
    )
    expect(tab.webview.options).toEqual({
      enableScripts: true,
      enableCommandUris: false,
      localResourceRoots: [Uri.joinPath(fakeHostContext().extensionUri, 'dist', 'webview')],
    })
    expect(tab.webview.html).toContain('/usage.js')
    expect(tab.webview.html).toContain('/usage.css')
    expect(tab.webview.html).toContain("default-src 'none'")
    expect(tab.webview.html).toContain("script-src 'nonce-")
    const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(
      tab.webview.html,
    )?.[1]
    expect(policy).toBeDefined()
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|connect-src|https:/)
    panel.open()
    expect(window.createWebviewPanel).toHaveBeenCalledOnce()
    expect(tab.reveal).toHaveBeenCalledWith(undefined, false)
  })

  it('validates both directions and preserves unknown tokens and cost', async () => {
    const { tab, ports, receive } = openPanel()
    for (const bad of [
      null,
      { type: 'sendMessage', text: 'secret' },
      { type: 'usage/deleteHistory', requestId: 'x', approved: true },
      {
        type: 'usage/query',
        query: {
          range: 'custom',
          from: '2026-10-05',
          to: '2026-10-04',
          groupBy: 'model',
          metric: 'cost',
        },
      },
    ]) {
      tab.webview.messages.fire(bad)
    }
    expect(receive).not.toHaveBeenCalled()
    expect(tab.webview.postMessage).toHaveBeenLastCalledWith({
      type: 'usage/error',
      code: 'invalidMessage',
    })
    tab.webview.messages.fire({ type: 'usage/ready' })
    await vi.waitFor(() => {
      expect(receive).toHaveBeenCalledExactlyOnceWith({ type: 'usage/ready' })
    })
    ports.post({ type: 'usage/state', state: usageState() })
    const message: unknown = tab.webview.postMessage.mock.calls.at(-1)?.[0]
    expect(message).toMatchObject({ state: { totals: { tokens: { input: 123 } } } })
    expect(message).not.toHaveProperty('state.totals.tokens.output')
    expect(message).not.toHaveProperty('state.totals.costs.0.usd')
    const calls = tab.webview.postMessage.mock.calls.length
    ports.post({ type: 'usage/state', state: Object.assign(usageState(), { v: 2 }) })
    expect(tab.webview.postMessage).toHaveBeenCalledTimes(calls)
  })

  it('writes only a save-dialog selection, including a remote URI, and declines after disposal', async () => {
    const { ports, panel } = openPanel()
    expect(await ports.saveFile('private export', 'csv')).toBe(false)
    expect(workspace.fs.writeFile).not.toHaveBeenCalled()
    const target = Uri.parse('vscode-remote://ssh-remote/export.json')
    window.showSaveDialog.mockResolvedValue(target)
    expect(await ports.saveFile('private export', 'json')).toBe(true)
    expect(window.showSaveDialog).toHaveBeenLastCalledWith({
      saveLabel: 'Export',
      filters: { JSON: ['json'] },
    })
    expect(workspace.fs.writeFile).toHaveBeenCalledExactlyOnceWith(
      target,
      new TextEncoder().encode('private export'),
    )
    panel.dispose()
    expect(await ports.saveFile('late export', 'csv')).toBe(false)
    expect(workspace.fs.writeFile).toHaveBeenCalledOnce()
  })

  it('requires the counted delete confirmation and routes settings, folder, models and safe consoles', async () => {
    const { ports, context, openModels } = openPanel()
    expect(await ports.confirmDelete(1234)).toBe(false)
    expect(confirm).toHaveBeenLastCalledWith(
      'Delete usage history?',
      expect.objectContaining({
        modal: true,
        detail: expect.stringContaining('1,234 usage records'),
      }),
      'Delete history',
      'Cancel',
    )
    confirm.mockResolvedValue('Delete history')
    expect(await ports.confirmDelete(1234)).toBe(true)
    await ports.openSettings()
    await ports.revealFolder()
    await ports.openModels('ollama', 'local')
    expect(commands.executeCommand).toHaveBeenCalledWith(
      'workbench.action.openSettings',
      'museSpark.usageHistory',
    )
    expect(commands.executeCommand).toHaveBeenCalledWith('revealFileInOS', Uri.file('/data/usage'))
    expect(openModels).toHaveBeenCalledExactlyOnceWith('ollama', 'local')
    await ports.setHistory(true)
    expect(updateHistory).toHaveBeenCalledExactlyOnceWith('usageHistory', true, 1)
    for (const unsafe of [
      'command:doSomething',
      'file:///private',
      'http://127.0.0.1',
      'https://user:pass@example.com',
    ])
      await expect(ports.openExternal(unsafe)).rejects.toThrow(USAGE_TEXT.unsupported)
    expect(env.openExternal).not.toHaveBeenCalled()
    await ports.openExternal('https://example.com/console')
    expect(env.openExternal).toHaveBeenCalledExactlyOnceWith(
      Uri.parse('https://example.com/console'),
    )
    expect(context.log.warn).not.toHaveBeenCalled()
  })

  it('serializes service work, reports errors without raw data, and closes the bridge with its tab', async () => {
    const { panel, tab, receive, dispose, context, ports } = openPanel()
    receive.mockRejectedValueOnce(new Error('sensitive path'))
    tab.webview.messages.fire({ type: 'usage/ready' })
    await vi.waitFor(() => {
      expect(tab.webview.postMessage).toHaveBeenCalledWith({
        type: 'usage/error',
        code: 'readFailed',
      })
    })
    expect(context.log.warn).toHaveBeenCalledExactlyOnceWith('Usage page action failed')
    panel.dispose()
    tab.webview.messages.fire({ type: 'usage/refresh' })
    ports.post({ type: 'usage/state', state: usageState() })
    expect(receive).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
    panel.open()
    expect(window.createWebviewPanel).toHaveBeenCalledTimes(2)
  })

  it('loads the usage table in the lazy factory and rejects missing/corrupt bundles before retrying', async () => {
    const context = fakeHostContext()
    workspace.fs.readFile.mockResolvedValue(new TextEncoder().encode(JSON.stringify(USAGE_EN)))
    const factory = vi.fn(createUsagePanel)
    const load = vi
      .fn<() => unknown>()
      .mockReturnValueOnce({ wrong: true })
      .mockReturnValue({ createUsagePanel: factory })
    const bundle = usagePanelLoader({
      bundlePath: '/dist/usagePanel.js',
      log: context.log,
      loadBundle: load,
    })
    expect(load).not.toHaveBeenCalled()
    expect(() => bundle()).toThrow()
    const loaded = bundle()
    expect(bundle()).toBe(loaded)
    await loaded.createUsagePanel({
      ...context,
      l10n: { locale: 'de', table: EN },
      service: { usage: fakeUsageAccess().usage, journalFolder: Uri.file('/usage') },
      openModels: () => Promise.resolve(),
    })
    expect(workspace.fs.readFile).toHaveBeenCalledWith(
      Uri.joinPath(context.extensionUri, 'l10n', 'usage.de.json'),
    )
    expect(factory).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
