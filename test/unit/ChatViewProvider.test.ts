import { describe, expect, it } from 'vitest'
import { ChatViewProvider } from '../../src/host/views/ChatViewProvider'
import { FakeWebviewView, fakeHostContext } from './helpers/fakes'

describe('ChatViewProvider', () => {
  it('configures the resolved view and answers ready', () => {
    const view = new FakeWebviewView()
    new ChatViewProvider(fakeHostContext()).resolveWebviewView(view)
    expect(view.webview.options.enableScripts).toBe(true)
    expect(view.webview.html).toContain('<script nonce=')
    view.webview.messages.fire({ type: 'ready' })
    expect(view.webview.postMessage).toHaveBeenCalledOnce()
  })

  it('stops handling messages when the view is disposed', () => {
    const view = new FakeWebviewView()
    new ChatViewProvider(fakeHostContext()).resolveWebviewView(view)
    view.disposed.fire()
    view.webview.messages.fire({ type: 'ready' })
    expect(view.webview.postMessage).not.toHaveBeenCalled()
  })
})
