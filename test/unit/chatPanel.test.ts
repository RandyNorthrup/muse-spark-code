import { beforeEach, describe, expect, it } from 'vitest'
import { openChatPanel } from '../../src/host/views/chatPanel'
import { SurfaceRegistry } from '../../src/host/views/surfaceRegistry'
import { FakeWebviewPanel, fakeHostContext, fakeSurface } from './helpers/fakes'
// Same module instance the production code receives through the `vscode`
// alias in vitest.config.ts, imported by path so its mock surface is typed.
import { window as fakeWindow } from './mocks/vscode'

function openFakePanel(registry = new SurfaceRegistry()) {
  const panel = openChatPanel(fakeHostContext(), registry)
  if (!(panel instanceof FakeWebviewPanel)) {
    throw new TypeError('expected the fake panel')
  }
  return { panel, registry }
}

describe('openChatPanel', () => {
  beforeEach(() => {
    fakeWindow.createWebviewPanel.mockReset()
    fakeWindow.createWebviewPanel.mockImplementation(
      (viewType, title) => new FakeWebviewPanel(viewType, title),
    )
  })

  it('creates an Untitled panel beside the active editor that keeps its state when hidden', () => {
    openFakePanel()
    expect(fakeWindow.createWebviewPanel).toHaveBeenCalledWith(
      'museSpark.chatPanel',
      'Untitled',
      -2,
      { retainContextWhenHidden: true },
    )
  })

  it('registers the panel as the active surface with a unique id', () => {
    const registry = new SurfaceRegistry()
    registry.add(fakeSurface('sidebar'))
    const { panel } = openFakePanel(registry)
    expect(registry.size).toBe(2)
    expect(registry.active?.id).toMatch(/^panel:[0-9a-f-]{36}$/)
    registry.active?.reveal()
    expect(panel.reveal).toHaveBeenCalledWith(undefined, false)
  })

  it('wires the panel webview and answers ready', () => {
    const { panel } = openFakePanel()
    expect(panel.webview.html).toContain('<script nonce=')
    panel.webview.messages.fire({ type: 'ready' })
    expect(panel.webview.postMessage).toHaveBeenCalledOnce()
  })

  it('unregisters and stops handling messages once the panel is disposed', () => {
    const { panel, registry } = openFakePanel()
    panel.dispose()
    expect(registry.size).toBe(0)
    panel.webview.messages.fire({ type: 'ready' })
    expect(panel.webview.postMessage).not.toHaveBeenCalled()
  })

  it('names the tab after the conversation and marks it while inactive', () => {
    const { panel, registry } = openFakePanel()
    registry.active?.setTitle('Parser fix')
    expect(panel.title).toBe('Parser fix')
    registry.active?.markUnread()
    expect(panel.title).toBe('Parser fix')
    panel.active = false
    registry.active?.markUnread()
    expect(panel.title).toBe('● Parser fix')
    registry.active?.setTitle('Renamed')
    expect(panel.title).toBe('● Renamed')
    panel.active = true
    panel.viewStateChanges.fire({ webviewPanel: panel })
    expect(panel.title).toBe('Renamed')
  })
})
