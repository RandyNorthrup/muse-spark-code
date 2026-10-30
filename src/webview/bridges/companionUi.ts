import { MHP_PANEL } from '../../shared/constants'
import { createUiResponder } from './uiResponder'
import type { PanelBridge } from './types'
import { webviewToHostMessageSchema } from '../../shared/protocol'

/** A distinct bearer-bound MHP channel keeps RPC outside the frozen panel payloads. */
export async function connectCompanionUi(
  host: PanelBridge,
  onError: (error: unknown) => void,
): Promise<() => void> {
  const signal = new AbortController()
  let responder: ReturnType<typeof createUiResponder> | undefined
  let creating: Promise<ReturnType<typeof createUiResponder>> | undefined
  let pending = 0
  async function initialize() {
    const fallbacks = await host.loadFallbacks()
    signal.signal.throwIfAborted()
    const root = document.createElement('div')
    document.body.append(root)
    responder = createUiResponder(
      fallbacks.createFallbackUi(root, (id) => {
        host.post(webviewToHostMessageSchema.parse({ type: 'hostAction', action: id }))
      }),
      onError,
    )
    return responder
  }
  async function receive(value: unknown): Promise<void> {
    if (++pending > MHP_PANEL.maximumQueuedMessages) throw new Error('MHP_UI_BACKPRESSURE')
    try {
      const active = await (creating ??= initialize())
      const result = await active.receive(value)
      if (result === undefined || signal.signal.aborted) return
      const response = await window.fetch('/host/message', {
        method: 'POST',
        credentials: 'omit',
        signal: signal.signal,
        headers: { 'Content-Type': 'application/json', 'X-Muse-Panel': '1' },
        body: JSON.stringify(result),
      })
      if (!response.ok) throw new Error('MHP_UI_REPLY_FAILED')
    } finally {
      pending--
    }
  }
  const response = await window.fetch('/host/events', {
    method: 'POST',
    credentials: 'omit',
    signal: signal.signal,
    headers: { 'Content-Type': 'application/json', 'X-Muse-Panel': '1' },
    body: '{}',
  })
  if (
    !response.ok ||
    response.body === null ||
    !response.headers.get('Content-Type')?.startsWith('text/event-stream')
  )
    throw new Error('MHP_UI_CONNECT_FAILED')
  const body = response.body
  const stop = () => {
    signal.abort()
    responder?.dispose()
  }
  window.addEventListener('pagehide', stop, { once: true })
  void (async () => {
    const reader = body.getReader()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let buffer = ''
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) {
          if (!signal.signal.aborted) throw new Error('MHP_UI_DISCONNECTED')
          return
        }
        buffer += decoder.decode(chunk.value, { stream: true })
        if (new TextEncoder().encode(buffer).byteLength > MHP_PANEL.maximumEnvelopeBytes)
          throw new Error('MHP_UI_TOO_LARGE')
        let boundary
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const data = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice('data:'.length).trimStart())
            .join('\n')
          if (data !== '')
            void receive(JSON.parse(data)).catch((error: unknown) => {
              stop()
              onError(error)
            })
        }
      }
    } catch (error: unknown) {
      if (!signal.signal.aborted) {
        stop()
        onError(error)
      }
    } finally {
      reader.releaseLock()
    }
  })()
  return stop
}
