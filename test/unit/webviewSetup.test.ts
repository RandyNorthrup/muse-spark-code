import { describe, expect, it, vi } from 'vitest'
import type { ChatSurface } from '../../src/host/views/chatSurface'
import { configureWebview } from '../../src/host/views/webviewSetup'
import { WEBVIEW_DOCUMENT_ATTRIBUTE, WEBVIEW_L10N_ELEMENT_ID } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { FakeWebview, fakeHostContext, testSettings } from './helpers/fakes'

const NONCE_PATTERN = /script-src 'nonce-([^']+)'/

function nonceOf(html: string): string | undefined {
  return NONCE_PATTERN.exec(html)?.[1]
}

const DOCUMENT_PATTERN = new RegExp(`<body [^>]*${WEBVIEW_DOCUMENT_ATTRIBUTE}="([^"]+)"`)

/** The id written on the document's `<body>` (M107); a document without one fails. */
function documentIdOf(html: string): string {
  const id = DOCUMENT_PATTERN.exec(html)?.[1]
  if (id === undefined) throw new Error('the document carries no id')
  return id
}

function setup(context = fakeHostContext(), restoredSessionId?: string) {
  const webview = new FakeWebview()
  const reveal = vi.fn<() => void>()
  const markUnread = vi.fn<() => void>()
  const setTitle = vi.fn<(title: string) => void>()
  const onFocused = vi.fn<(surface: ChatSurface) => void>()
  const surface = configureWebview(webview, context, {
    id: 'test',
    restoredSessionId,
    reveal,
    markUnread,
    setTitle,
    onFocused,
  })
  return { webview, context, surface, reveal, markUnread, setTitle, onFocused }
}

describe('configureWebview', () => {
  it('validates lazy estimator requests and drops pending work after dispose or clear', async () => {
    const request = {
      goal: { kind: 'milestone', milestoneId: 'M117' },
      asOf: '2026-10-07T00:00:00.000Z',
      fleet: 'current',
      optimize: 'cost',
    }
    const valid = setup()
    valid.webview.messages.fire({ type: 'estimateRun', requestId: 'request-1', request })
    await vi.waitFor(() => {
      expect(valid.context.onConversationMessage).toHaveBeenCalledWith(valid.surface, {
        type: 'estimateRun',
        requestId: 'request-1',
        request,
      })
    })
    valid.webview.messages.fire({ type: 'estimateRun', request: {} })
    await vi.waitFor(() => {
      expect(valid.context.log.warn).toHaveBeenCalled()
    })
    expect(valid.context.onConversationMessage).toHaveBeenCalledOnce()
    valid.surface.dispose()
    for (const close of ['dispose', 'clear']) {
      const pending = setup()
      pending.webview.messages.fire({ type: 'estimateRun', request })
      if (close === 'dispose') pending.surface.dispose()
      else
        pending.webview.messages.fire({
          type: 'clearConversation',
          sourceSessionId: null,
          attachmentEpoch: 1,
        })
      await import('../../src/shared/estimatorProtocol')
      expect(
        pending.context.onConversationMessage.mock.calls.filter(
          ([, message]) => message.type === 'estimateRun',
        ),
      ).toHaveLength(0)
      pending.surface.dispose()
    }
  })

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

  it('writes the table installed at activation into the document (D33)', () => {
    const context = {
      ...fakeHostContext(),
      l10n: { locale: 'ja', table: { ...EN, sendTitle: '送信' } },
    }
    const { webview } = setup(context)
    expect(webview.html).toContain('<html lang="ja">')
    expect(webview.html).toContain('"sendTitle":"送信"')
    expect(webview.html).toContain(`id="${WEBVIEW_L10N_ELEMENT_ID}"`)
  })

  it('uses a fresh nonce for every configuration', () => {
    const first = setup().webview
    const second = setup().webview
    expect(nonceOf(first.html)).toBeDefined()
    expect(nonceOf(first.html)).not.toBe(nonceOf(second.html))
  })

  it('answers ready with init, then reports the surface as ready', () => {
    const { webview, context, surface } = setup()
    webview.messages.fire({ type: 'ready', attachmentEpoch: 4 })
    expect(webview.postMessage).toHaveBeenCalledWith({
      type: 'init',
      emptyStateHint: 'Type /model to pick the right tool for the job.',
      composerPlaceholder:
        'ctrl esc (cmd esc on macOS, ctrl alt esc on Windows) to focus or unfocus Muse',
      settings: testSettings,
    })
    expect(context.onSurfaceReady).toHaveBeenCalledWith(surface, 4)
  })

  it('names each document it builds, and Reload retires the old name at once', () => {
    // M107 RVM107W1B/RVM107W1D: Show resources must not post into, or hear from,
    // a replaced document. The host issues the id; the webview only echoes it.
    const { webview, context, surface } = setup()
    const first = webview.html
    const firstId = documentIdOf(first)
    expect(firstId).toMatch(/^[\w-]{32}$/)
    expect(surface.documentId).toBe(firstId)
    expect(firstId).not.toBe(nonceOf(first))
    surface.reload()
    expect(webview.html).not.toBe(first)
    const secondId = documentIdOf(webview.html)
    expect(secondId).toMatch(/^[\w-]{32}$/)
    expect(secondId).not.toBe(firstId)
    expect(surface.documentId).toBe(secondId)
    expect(webview.html).not.toContain(firstId)
    expect(setup().surface.documentId).not.toBe(secondId)
    webview.messages.fire({ type: 'ready' })
    expect(context.onSurfaceReady).toHaveBeenCalledWith(surface, undefined)
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

  it('reports its document taking focus, and keeps that out of the conversation (M25)', () => {
    const { webview, context, surface, onFocused } = setup()
    webview.messages.fire({ type: 'surfaceFocused' })
    expect(onFocused).toHaveBeenCalledWith(surface)
    expect(context.onConversationMessage).not.toHaveBeenCalled()
  })

  // M25: a restored panel handed its session out once, so a resume that
  // failed (not signed in yet, a CLI hiccup) lost the conversation for good.
  it('keeps the restored session until one is live or the conversation is cleared (M25)', () => {
    const live = setup(fakeHostContext(), 'old').surface
    expect(live.takeRestoredSessionId()).toBe('old')
    expect(live.takeRestoredSessionId()).toBe('old')
    live.post({ type: 'sessionInfo', modelId: 'muse-spark-1.3' })
    expect(live.takeRestoredSessionId()).toBe('old')
    live.post({ type: 'sessionInfo', modelId: 'muse-spark-1.3', sessionId: 'new' })
    expect(live.takeRestoredSessionId()).toBeUndefined()
    const resumed = setup(fakeHostContext(), 'old').surface
    resumed.post({ type: 'historyLoaded', sessionId: 'old', items: [], todos: [] })
    expect(resumed.takeRestoredSessionId()).toBeUndefined()
    const cleared = setup(fakeHostContext(), 'old').surface
    cleared.post({ type: 'conversationCleared' })
    expect(cleared.takeRestoredSessionId()).toBeUndefined()
  })

  it('stops handling messages once disposed', () => {
    const { webview, surface } = setup()
    surface.dispose()
    webview.messages.fire({ type: 'ready' })
    expect(webview.postMessage).not.toHaveBeenCalled()
  })
})
