import { MHP_PANEL } from '../../shared/constants'
import {
  type MhpPanelBinding,
  panelErrorSchema,
  parseMhpPanelEnvelope,
  parseMhpSurfaceNotification,
} from '../../shared/hostApi/panel'
import type { MuseEmbeddedHost } from '../../shared/hostApi/panel'
import { browserState } from './state'
import { loadFallbacks, panelMessages, type PanelBridge, type PanelCodec } from './types'

/** fetch is the launch page's same-origin, memory-only bearer closure. */
export function companionBridge(
  binding: MhpPanelBinding,
  codec: PanelCodec,
  send: typeof fetch,
  onError: (error: unknown) => void,
  stateStore: Pick<MuseEmbeddedHost, 'getState' | 'setState'>,
): PanelBridge {
  const bus = panelMessages(codec)
  const controller = new AbortController()
  let outgoing = 1
  let incoming = 1
  let queuedBytes = 0
  let queuedMessages = 0
  let chain = Promise.resolve()
  const connected = Promise.withResolvers<boolean>()
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined

  function report(error: unknown): void {
    if (controller.signal.aborted) return
    controller.abort()
    connected.resolve(true)
    onError(error)
  }
  function enqueue(frame: unknown, endpoint = '/panel/message'): void {
    controller.signal.throwIfAborted()
    const body = JSON.stringify(frame)
    const bytes = new TextEncoder().encode(body).byteLength
    if (
      bytes > MHP_PANEL.maximumEnvelopeBytes ||
      queuedBytes + bytes > MHP_PANEL.maximumQueuedBytes ||
      queuedMessages + 1 > MHP_PANEL.maximumQueuedMessages
    ) {
      throw new Error('MHP_PANEL_BACKPRESSURE')
    }
    queuedBytes += bytes
    queuedMessages++
    const previous = chain
    chain = (async () => {
      try {
        await previous
        await connected.promise
        controller.signal.throwIfAborted()
        const response = await send(endpoint, {
          method: 'POST',
          credentials: 'omit',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'X-Muse-Panel': '1' },
          body,
        })
        if (!response.ok) throw new Error('EPANEL_POST')
      } catch (error) {
        report(error)
      } finally {
        queuedBytes -= bytes
        queuedMessages--
      }
    })()
  }
  function receive(value: unknown): void {
    const error = panelErrorSchema.safeParse(value)
    if (error.success) throw new Error(error.data.code)
    const isLifecycle =
      typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'surface'
    if (isLifecycle) {
      const frame = parseMhpSurfaceNotification(value, binding)
      if (frame.event === 'closed') throw new Error('EPANEL_CLOSED')
      return
    }
    const frame = parseMhpPanelEnvelope(value, {
      binding,
      direction: 'toPanel',
      expectedSeq: incoming,
      ready: true,
    })
    bus.receive(frame.payload)
    incoming++
  }
  async function stream(): Promise<void> {
    const response = await send('/panel/events', {
      method: 'POST',
      credentials: 'omit',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-Muse-Panel': '1' },
      body: '{}',
    })
    if (
      !response.ok ||
      response.body === null ||
      !response.headers.get('Content-Type')?.startsWith('text/event-stream')
    ) {
      throw new Error('EPANEL_STREAM')
    }
    const reader = response.body.getReader()
    activeReader = reader
    connected.resolve(true)
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let pending = ''
    try {
      while (!controller.signal.aborted) {
        const chunk = await reader.read()
        if (chunk.done) throw new Error('EPANEL_CLOSED')
        pending += decoder.decode(chunk.value, { stream: true })
        let end: number
        while ((end = pending.search(/\r?\n\r?\n/u)) !== -1) {
          const event = pending.slice(0, end)
          pending = pending.slice(end + (pending[end] === '\r' ? '\r\n\r\n'.length : '\n\n'.length))
          const data = event
            .split(/\r?\n/u)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice('data:'.length).trimStart())
            .join('\n')
          if (data === '') continue
          if (new TextEncoder().encode(data).byteLength > MHP_PANEL.maximumEnvelopeBytes) {
            throw new Error('MHP_PANEL_TOO_LARGE')
          }
          const value: unknown = JSON.parse(data)
          receive(value)
        }
        if (new TextEncoder().encode(pending).byteLength > MHP_PANEL.maximumEnvelopeBytes) {
          throw new Error('MHP_PANEL_TOO_LARGE')
        }
      }
    } finally {
      activeReader = undefined
      try {
        await reader.cancel()
      } catch (error: unknown) {
        // Abort also cancels the fetch body; anything else is the carrier's failure.
        if (!controller.signal.aborted) report(error)
      }
      reader.releaseLock()
    }
  }
  // Ready and application posts wait until the runtime has subscribed the stream.
  void stream().catch(report)
  enqueue(
    { mhp: MHP_PANEL.wireVersion, kind: 'surface', ...binding, event: 'opened' },
    '/panel/surface',
  )
  enqueue(
    { mhp: MHP_PANEL.wireVersion, kind: 'surface', ...binding, event: 'ready' },
    '/panel/surface',
  )
  return {
    post(message) {
      const payload = codec.outgoing.parse(message)
      const frame = {
        mhp: MHP_PANEL.wireVersion,
        kind: 'panel',
        surface: binding.surface,
        direction: 'toHost' as const,
        seq: outgoing,
        payload,
      }
      parseMhpPanelEnvelope(frame, {
        binding,
        direction: 'toHost',
        expectedSeq: outgoing,
        ready: true,
      })
      enqueue(frame)
      outgoing++
    },
    savedState: () => stateStore.getState(),
    saveState: (value) => {
      stateStore.setState(browserState(value))
    },
    messages: bus.source,
    loadFallbacks,
    dispose: () => {
      controller.abort()
      connected.resolve(false)
      void activeReader?.cancel().catch(report)
    },
  }
}
