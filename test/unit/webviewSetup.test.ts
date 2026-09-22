import { describe, expect, it } from 'vitest'
import { configureWebview } from '../../src/host/views/webviewSetup'
import { FakeWebview, fakeHostContext } from './helpers/fakes'

const NONCE_PATTERN = /script-src 'nonce-([^']+)'/

function nonceOf(html: string): string | undefined {
  return NONCE_PATTERN.exec(html)?.[1]
}

describe('configureWebview', () => {
  it('enables scripts and restricts local resources to the webview bundle', () => {
    const webview = new FakeWebview()
    configureWebview(webview, fakeHostContext())
    expect(webview.options.enableScripts).toBe(true)
    expect(webview.options.localResourceRoots?.map((uri) => uri.path)).toEqual([
      '/ext/dist/webview',
    ])
  })

  it('renders HTML pointing at the bundled script and stylesheet', () => {
    const webview = new FakeWebview()
    configureWebview(webview, fakeHostContext())
    expect(webview.html).toContain('file://webview/ext/dist/webview/main.js')
    expect(webview.html).toContain('file://webview/ext/dist/webview/main.css')
    expect(webview.html).toContain(webview.cspSource)
  })

  it('uses a fresh nonce for every configuration', () => {
    const first = new FakeWebview()
    const second = new FakeWebview()
    configureWebview(first, fakeHostContext())
    configureWebview(second, fakeHostContext())
    expect(nonceOf(first.html)).toBeDefined()
    expect(nonceOf(first.html)).not.toBe(nonceOf(second.html))
  })

  it('answers ready with an init message', () => {
    const webview = new FakeWebview()
    configureWebview(webview, fakeHostContext())
    webview.messages.fire({ type: 'ready' })
    expect(webview.postMessage).toHaveBeenCalledWith({
      type: 'init',
      extensionVersion: '1.2.3',
      emptyStateHint: 'Type /model to pick the right tool for the job.',
      composerPlaceholder: 'ctrl esc to focus or unfocus Muse',
    })
  })

  it('drops malformed messages and logs a warning', () => {
    const webview = new FakeWebview()
    const context = fakeHostContext()
    configureWebview(webview, context)
    webview.messages.fire({ type: 'bogus' })
    expect(webview.postMessage).not.toHaveBeenCalled()
    expect(context.log.warn).toHaveBeenCalledOnce()
    expect(String(context.log.warn.mock.calls[0]?.[0])).toContain(
      'Dropped malformed webview message',
    )
  })

  it('stops handling messages once disposed', () => {
    const webview = new FakeWebview()
    const subscription = configureWebview(webview, fakeHostContext())
    subscription.dispose()
    webview.messages.fire({ type: 'ready' })
    expect(webview.postMessage).not.toHaveBeenCalled()
  })
})
