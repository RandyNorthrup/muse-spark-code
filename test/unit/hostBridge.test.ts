// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { vsCodeHostBridge } from '../../src/webview/hostBridge'

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
