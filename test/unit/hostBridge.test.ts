// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hostBridgeFactory, vsCodeHostBridge } from '../../src/webview/hostBridge'

// M61 (PLAN.md D60): the webview reaches VS Code only through this bridge.

function fakeApi() {
  return { postMessage: vi.fn(), getState: vi.fn(() => ({ sessionId: 's-1' })), setState: vi.fn() }
}

describe('vsCodeHostBridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('acquires the VS Code API once and posts, reads and saves through it', () => {
    const api = fakeApi()
    const acquire = vi.fn(() => api)
    vi.stubGlobal('acquireVsCodeApi', acquire)

    const host = vsCodeHostBridge(window)
    host.post({ type: 'ready' })
    host.saveState({ sessionId: 's-2' })

    expect(acquire).toHaveBeenCalledTimes(1)
    expect(api.postMessage).toHaveBeenCalledWith({ type: 'ready' })
    expect(host.savedState()).toEqual({ sessionId: 's-1' })
    expect(api.setState).toHaveBeenCalledWith({ sessionId: 's-2' })
  })

  it("takes the host's messages from the window it is given", () => {
    vi.stubGlobal('acquireVsCodeApi', () => fakeApi())
    const host = vsCodeHostBridge(window)
    const received: unknown[] = []
    const onMessage = (event: MessageEvent<unknown>) => {
      received.push(event.data)
    }

    host.messages.addEventListener('message', onMessage)
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'conversationCleared' } }))
    host.messages.removeEventListener('message', onMessage)
    window.dispatchEvent(new MessageEvent('message', { data: 'after' }))

    expect(received).toEqual([{ type: 'conversationCleared' }])
  })
})

describe('hostBridgeFactory', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('selects all five hosts and caches each real bridge, including the VS Code API', () => {
    const api = fakeApi()
    const acquire = vi.fn(() => api)
    vi.stubGlobal('acquireVsCodeApi', acquire)
    const native = () => ({
      post: vi.fn(),
      savedState: () => undefined,
      saveState: vi.fn(),
      messages: window,
    })
    const factories = {
      http: vi.fn(native),
      jcef: vi.fn(native),
      webView2: vi.fn(native),
      swt: vi.fn(native),
    }
    const create = hostBridgeFactory(window, factories)
    for (const kind of ['http', 'jcef', 'webView2', 'swt'] as const) {
      const bridge = create(kind)
      bridge.post({ type: 'usage/ready' })
      expect(create(kind)).toBe(bridge)
      expect(factories[kind]).toHaveBeenCalledTimes(1)
      expect(bridge.post).toHaveBeenCalledWith({ type: 'usage/ready' })
    }
    const vscode = create('vscode')
    vscode.post({ type: 'usage/refresh' })
    expect(create('vscode')).toBe(vscode)
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(api.postMessage).toHaveBeenCalledWith({ type: 'usage/refresh' })
  })

  it('fails explicitly when a native host has not supplied its transport', () => {
    const create = hostBridgeFactory(window, {})
    expect(() => create('http')).toThrow('http')
  })
})
