import { beforeEach, describe, expect, it } from 'vitest'
import { openChatPanel } from '../../src/host/views/chatPanel'
import { FakeWebviewPanel, fakeHostContext } from './helpers/fakes'
// Same module instance the production code receives through the `vscode`
// alias in vitest.config.ts, imported by path so its mock surface is typed.
import { window as fakeWindow } from './mocks/vscode'

function openFakePanel(): FakeWebviewPanel {
  const panel = openChatPanel(fakeHostContext())
  if (!(panel instanceof FakeWebviewPanel)) {
    throw new TypeError('expected the fake panel')
  }
  return panel
}

describe('openChatPanel', () => {
  beforeEach(() => {
    fakeWindow.createWebviewPanel.mockReset()
    fakeWindow.createWebviewPanel.mockImplementation(
      (viewType, title) => new FakeWebviewPanel(viewType, title),
    )
  })

  it('creates an Untitled panel beside the active editor that keeps its state when hidden', () => {
    openChatPanel(fakeHostContext())
    expect(fakeWindow.createWebviewPanel).toHaveBeenCalledWith(
      'museSpark.chatPanel',
      'Untitled',
      -2,
      { retainContextWhenHidden: true },
    )
  })

  it('wires the panel webview and answers ready', () => {
    const panel = openFakePanel()
    expect(panel.webview.html).toContain('<script nonce=')
    panel.webview.messages.fire({ type: 'ready' })
    expect(panel.webview.postMessage).toHaveBeenCalledOnce()
  })

  it('stops handling messages once the panel is disposed', () => {
    const panel = openFakePanel()
    panel.dispose()
    panel.webview.messages.fire({ type: 'ready' })
    expect(panel.webview.postMessage).not.toHaveBeenCalled()
  })
})
