import { beforeEach, describe, expect, it } from 'vitest'
import { openChatPanel, restoreChatPanel } from '../../src/host/views/chatPanel'
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

function restore(state: unknown, title = 'Untitled') {
  const registry = new SurfaceRegistry()
  const panel = new FakeWebviewPanel('museSpark.chatPanel', title)
  restoreChatPanel(panel, state, fakeHostContext(), registry)
  return { registry, panel }
}

describe('restoreChatPanel (M12)', () => {
  it('wires the rebuilt panel and keeps the stored session id until it is resumed (M12, M25)', () => {
    const { registry, panel } = restore({ sessionId: 'old' })
    expect(panel.webview.html).toContain('<script nonce=')
    expect(registry.active?.id).toMatch(/^panel:[0-9a-f-]{36}$/)
    expect(registry.active?.takeRestoredSessionId()).toBe('old')
    // A later ready (the crash screen's Reload) may try the resume again.
    expect(registry.active?.takeRestoredSessionId()).toBe('old')
    panel.webview.messages.fire({ type: 'ready' })
    expect(panel.webview.postMessage).toHaveBeenCalledOnce()
    registry.active?.post({ type: 'historyLoaded', sessionId: 'old', items: [], todos: [] })
    expect(registry.active?.takeRestoredSessionId()).toBeUndefined()
  })

  it('restores an empty panel for state that is not ours', () => {
    const cases: unknown[] = [undefined, null, 'old', { sessionId: 7 }, {}]
    for (const [index, state] of cases.entries()) {
      expect(
        restore(state).registry.active?.takeRestoredSessionId(),
        `case ${String(index)}`,
      ).toBeUndefined()
    }
  })

  it('keeps the saved title and does not double the unread mark', () => {
    const { registry, panel } = restore({}, '● Parser fix')
    expect(panel.title).toBe('● Parser fix')
    panel.active = false
    registry.active?.markUnread()
    expect(panel.title).toBe('● Parser fix')
    panel.active = true
    panel.viewStateChanges.fire({ webviewPanel: panel })
    expect(panel.title).toBe('Parser fix')
  })
})

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

  it('hands out no restored session id (M12)', () => {
    const { registry } = openFakePanel()
    expect(registry.active?.takeRestoredSessionId()).toBeUndefined()
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

  // M25: New Conversation (Ctrl+N) acted on the surface that last had the
  // composer focused, which could be a panel other than the one in front.
  it('becomes the active surface when it turns active or its document takes focus (M25)', () => {
    const registry = new SurfaceRegistry()
    const first = openFakePanel(registry)
    const firstSurface = registry.active
    const second = openFakePanel(registry)
    expect(registry.active).not.toBe(firstSurface)
    first.panel.active = true
    first.panel.viewStateChanges.fire({ webviewPanel: first.panel })
    expect(registry.active).toBe(firstSurface)
    second.panel.webview.messages.fire({ type: 'surfaceFocused' })
    expect(registry.active).not.toBe(firstSurface)
    first.panel.active = false
    first.panel.viewStateChanges.fire({ webviewPanel: first.panel })
    expect(registry.active).not.toBe(firstSurface)
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
