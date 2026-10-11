// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { jcefHostBridge } from '../../src/webview/hostBridges/jcefHostBridge'
import { swtHostBridge } from '../../src/webview/hostBridges/swtHostBridge'
import { webView2HostBridge } from '../../src/webview/hostBridges/webView2HostBridge'
import { httpHostBridge } from '../../src/webview/hostBridges/httpHostBridge'
import { deliverUsageReply } from '../../src/webview/hostBridges/usageBridge'
import type { HostBridge } from '../../src/webview/hostBridge'

function listen(host: HostBridge) {
  const received: unknown[] = []
  const listener = (event: MessageEvent<unknown>) => {
    received.push(event.data)
  }
  host.messages.addEventListener('message', listener)
  return received
}

describe('usage host bridges', () => {
  it.each([jcefHostBridge, swtHostBridge])(
    'serializes native requests and uses injected persistence',
    (create) => {
      const port = {
        send: vi.fn(),
        messages: window,
        savedState: () => ({ sessionId: 's' }),
        saveState: vi.fn(),
      }
      const host = create(port)
      host.post({ type: 'usage/ready' })
      expect(port.send).toHaveBeenCalledWith('{"type":"usage/ready"}')
      expect(host.savedState()).toEqual({ sessionId: 's' })
      host.saveState({ sessionId: 'next' })
      expect(port.saveState).toHaveBeenCalledWith({ sessionId: 'next' })
      const received = listen(host)
      window.dispatchEvent(
        new MessageEvent('message', { data: '{"type":"usage/error","code":"unsupported"}' }),
      )
      expect(received).toEqual([{ type: 'usage/error', code: 'unsupported' }])
      expect(() => {
        host.post({ type: 'ready' })
      }).toThrow('Invalid usage request')
    },
  )

  it('uses structured WebView2 messages without stringifying or acquiring VS Code', () => {
    const port = {
      postMessage: vi.fn(),
      messages: window,
      savedState: () => undefined,
      saveState: vi.fn(),
    }
    const host = webView2HostBridge(port)
    host.post({ type: 'usage/openModels', provider: 'anthropic', model: 'claude' })
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'usage/openModels',
      provider: 'anthropic',
      model: 'claude',
    })
    expect(() => {
      host.post({ type: 'ready' })
    }).toThrow('Invalid usage request')
    expect(host.savedState()).toBeUndefined()
    host.saveState({})
    expect(port.saveState).toHaveBeenCalledWith({})
    const received = listen(host)
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'usage/error', code: 'unsupported' } }),
    )
    expect(received).toEqual([{ type: 'usage/error', code: 'unsupported' }])
  })

  it('checks JSON and structured replies and makes malformed replies explicit', () => {
    const messages = new EventTarget()
    const received: unknown[] = []
    messages.addEventListener('message', (event) => {
      if (event instanceof MessageEvent) received.push(event.data)
    })
    deliverUsageReply(messages, '{"type":"usage/error","code":"unsupported"}')
    deliverUsageReply(messages, {
      type: 'usage/result',
      requestId: 'r',
      action: 'export',
      outcome: 'completed',
    })
    for (const invalid of [
      'bad JSON',
      { type: 'usage/state', state: {} },
      { type: 'usage/error', code: 'invented' },
    ]) {
      deliverUsageReply(messages, invalid)
    }
    expect(received).toEqual([
      { type: 'usage/error', code: 'unsupported' },
      { type: 'usage/result', requestId: 'r', action: 'export', outcome: 'completed' },
      ...Array.from({ length: 3 }, () => ({ type: 'usage/error', code: 'invalidMessage' })),
    ])
  })

  it('serializes HTTP actions, validates replies and reports transport failure without content', async () => {
    const deferred = Promise.withResolvers<unknown>()
    const request = vi
      .fn()
      .mockImplementationOnce(() => deferred.promise)
      .mockRejectedValueOnce(new Error('private content'))
    const port = { request, savedState: () => undefined, saveState: vi.fn() }
    const host = httpHostBridge(port)
    const received = listen(host)
    host.post({ type: 'usage/ready' })
    host.post({ type: 'usage/refresh' })
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1)
    })
    deferred.resolve({ type: 'usage/error', code: 'unsupported' })
    await vi.waitFor(() => {
      expect(received).toHaveLength(2)
    })
    expect(received).toEqual([
      { type: 'usage/error', code: 'unsupported' },
      { type: 'usage/error', code: 'readFailed' },
    ])
    expect(request.mock.calls).toEqual([[{ type: 'usage/ready' }], [{ type: 'usage/refresh' }]])
    expect(() => {
      host.post({ type: 'ready' })
    }).toThrow('Invalid usage request')
    host.saveState({})
    expect(port.saveState).toHaveBeenCalledWith({})
    expect(host.savedState()).toBeUndefined()
  })
})
