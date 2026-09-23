import { describe, expect, it } from 'vitest'
import { ChatViewProvider, SIDEBAR_SURFACE_ID } from '../../src/host/views/ChatViewProvider'
import { SurfaceRegistry } from '../../src/host/views/surfaceRegistry'
import { FakeWebviewView, fakeHostContext } from './helpers/fakes'

function resolve() {
  const registry = new SurfaceRegistry()
  const view = new FakeWebviewView()
  new ChatViewProvider(fakeHostContext(), registry).resolveWebviewView(view)
  return { registry, view }
}

describe('ChatViewProvider', () => {
  it('configures the resolved view, registers it, and answers ready', () => {
    const { registry, view } = resolve()
    expect(view.webview.options.enableScripts).toBe(true)
    expect(view.webview.html).toContain('<script nonce=')
    expect(registry.active?.id).toBe(SIDEBAR_SURFACE_ID)
    view.webview.messages.fire({ type: 'ready' })
    expect(view.webview.postMessage).toHaveBeenCalledOnce()
  })

  it('reveals by showing the view with focus', () => {
    const { registry, view } = resolve()
    registry.active?.reveal()
    expect(view.show).toHaveBeenCalledWith(false)
  })

  it('unregisters and stops handling messages when the view is disposed', () => {
    const { registry, view } = resolve()
    view.disposed.fire()
    expect(registry.size).toBe(0)
    view.webview.messages.fire({ type: 'ready' })
    expect(view.webview.postMessage).not.toHaveBeenCalled()
  })

  it('badges the hidden view when the conversation needs attention, clearing it when shown', () => {
    const { registry, view } = resolve()
    view.visible = false
    registry.active?.markUnread()
    expect(view.badge).toEqual({ tooltip: 'Muse needs your attention', value: 1 })
    view.visible = true
    view.visibility.fire()
    expect(view.badge).toBeUndefined()
    registry.active?.markUnread()
    expect(view.badge).toBeUndefined()
  })

  it('shows the conversation name as the view description, none for Untitled', () => {
    const { registry, view } = resolve()
    registry.active?.setTitle('Parser fix')
    expect(view.description).toBe('Parser fix')
    registry.active?.setTitle('Untitled')
    expect(view.description).toBe('')
  })
})

describe('ChatViewProvider: reload (M11)', () => {
  it('rebuilds the document with a fresh nonce', () => {
    const { registry, view } = resolve()
    const before = view.webview.html
    registry.active?.reload()
    expect(view.webview.html).not.toBe(before)
    expect(view.webview.html).toContain('<script nonce=')
    expect(view.webview.html.length).toBe(before.length)
  })
})
