import { describe, expect, it, vi } from 'vitest'
import { configureWebview } from '../../src/host/views/webviewSetup'
import { FakeWebview, fakeHostContext, testSettings } from './helpers/fakes'

const NONCE_PATTERN = /script-src 'nonce-([^']+)'/

function nonceOf(html: string): string | undefined {
  return NONCE_PATTERN.exec(html)?.[1]
}

function setup(context = fakeHostContext()) {
  const webview = new FakeWebview()
  const reveal = vi.fn<() => void>()
  const markUnread = vi.fn<() => void>()
  const setTitle = vi.fn<(title: string) => void>()
  const surface = configureWebview(webview, context, { id: 'test', reveal, markUnread, setTitle })
  return { webview, context, surface, reveal, markUnread, setTitle }
}

describe('configureWebview', () => {
  it('enables scripts and restricts local resources to the webview bundle', () => {
    const { webview } = setup()
    expect(webview.options.enableScripts).toBe(true)
    expect(webview.options.localResourceRoots?.map((uri) => uri.path)).toEqual([
      '/ext/dist/webview',
    ])
  })

  it('renders HTML pointing at the bundled script and stylesheet', () => {
    const { webview } = setup()
    expect(webview.html).toContain('file://webview/ext/dist/webview/main.js')
    expect(webview.html).toContain('file://webview/ext/dist/webview/main.css')
    expect(webview.html).toContain(webview.cspSource)
  })

  it('uses a fresh nonce for every configuration', () => {
    const first = setup().webview
    const second = setup().webview
    expect(nonceOf(first.html)).toBeDefined()
    expect(nonceOf(first.html)).not.toBe(nonceOf(second.html))
  })

  it('answers ready with init, then reports the surface as ready', () => {
    const { webview, context, surface } = setup()
    webview.messages.fire({ type: 'ready' })
    expect(webview.postMessage).toHaveBeenCalledWith({
      type: 'init',
      emptyStateHint: 'Type /model to pick the right tool for the job.',
      composerPlaceholder: 'ctrl esc to focus or unfocus Muse',
      settings: testSettings,
    })
    expect(context.onSurfaceReady).toHaveBeenCalledWith(surface)
  })

  it('reports composer focus changes with the originating surface', () => {
    const { webview, context, surface } = setup()
    webview.messages.fire({ type: 'inputFocusChanged', focused: true })
    expect(context.onInputFocusChanged).toHaveBeenCalledWith(surface, true)
    webview.messages.fire({ type: 'inputFocusChanged', focused: false })
    expect(context.onInputFocusChanged).toHaveBeenLastCalledWith(surface, false)
  })

  it('routes conversation messages to the controller with the surface', () => {
    const { webview, context, surface } = setup()
    const message = { type: 'sendMessage', localId: 'l1', text: 'hello', attachmentIds: [] }
    webview.messages.fire(message)
    webview.messages.fire({ type: 'cancelTurn' })
    expect(context.onConversationMessage).toHaveBeenNthCalledWith(1, surface, message)
    expect(context.onConversationMessage).toHaveBeenNthCalledWith(2, surface, {
      type: 'cancelTurn',
    })
    expect(context.onSurfaceReady).not.toHaveBeenCalled()
  })

  it('exposes the surface id and the reveal, unread and title callbacks', () => {
    const { surface, reveal, markUnread, setTitle } = setup()
    expect(surface.id).toBe('test')
    surface.reveal()
    surface.markUnread()
    surface.setTitle('Renamed')
    expect(reveal).toHaveBeenCalledOnce()
    expect(markUnread).toHaveBeenCalledOnce()
    expect(setTitle).toHaveBeenCalledWith('Renamed')
  })

  it('posts host messages through the surface handle', () => {
    const { webview, surface } = setup()
    surface.post({ type: 'focusInput' })
    expect(webview.postMessage).toHaveBeenCalledWith({ type: 'focusInput' })
  })

  it('drops malformed messages and logs a warning', () => {
    const { webview, context } = setup()
    webview.messages.fire({ type: 'inputFocusChanged', focused: 'yes' })
    expect(webview.postMessage).not.toHaveBeenCalled()
    expect(context.onInputFocusChanged).not.toHaveBeenCalled()
    expect(context.onConversationMessage).not.toHaveBeenCalled()
    expect(context.log.warn).toHaveBeenCalledOnce()
    expect(String(context.log.warn.mock.calls[0]?.[0])).toContain(
      'Dropped malformed webview message',
    )
  })

  it('stops handling messages once disposed', () => {
    const { webview, surface } = setup()
    surface.dispose()
    webview.messages.fire({ type: 'ready' })
    expect(webview.postMessage).not.toHaveBeenCalled()
  })
})
