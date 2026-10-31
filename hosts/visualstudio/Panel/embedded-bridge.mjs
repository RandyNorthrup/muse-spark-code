import * as z from 'zod/mini'
import { MHP_PANEL } from '../../../src/shared/constants.ts'
import {
  embeddedBridgeStateSchema,
  panelBindingSchema,
  panelErrorSchema,
  parseMhpPanelEnvelope,
} from '../../../src/shared/hostApi/panel.ts'

// These controls stay inside WebView2. They are never written to MHP stdio.
const browserControlSchema = z.discriminatedUnion('bridge', [
  z.strictObject({ bridge: z.literal('subscribed') }),
  z.strictObject({ bridge: z.literal('state'), state: embeddedBridgeStateSchema }),
])
const drainSchema = z.strictObject({
  bridge: z.literal('drained'),
  surface: z.string(),
  seq: z.int().check(z.gte(1)),
})
const copy = (value) => globalThis.structuredClone(value)
const refuse = (code) => {
  throw new Error(code)
}

export function install(page, configuration) {
  const binding = panelBindingSchema.parse(configuration.binding)
  let state = configuration.state
  if (state !== undefined) state = embeddedBridgeStateSchema.parse(state)
  let outgoing = configuration.outgoing
  let incoming = configuration.incoming
  let isSubscribed = false
  let isStopped = false
  let replayPending = configuration.reloaded
  const listeners = new Set()
  const pending = new Map()
  let pendingBytes = 0
  const bytes = (value) => new page.TextEncoder().encode(JSON.stringify(value)).byteLength
  const readyTypes = { tasks: 'tasksReady', usage: 'readUsage' }
  const readyType = readyTypes[binding.surfaceKind] ?? 'ready'
  const api = Object.freeze({
    postMessage(payload) {
      if (isStopped) return refuse('MHP_PANEL_UNKNOWN_SURFACE')
      const raw = {
        mhp: MHP_PANEL.wireVersion,
        kind: 'panel',
        surface: binding.surface,
        direction: 'toHost',
        seq: outgoing,
        payload,
      }
      const count = bytes(raw)
      const frame = parseMhpPanelEnvelope(raw, {
        binding,
        expectedSeq: outgoing,
        direction: 'toHost',
        ready: isSubscribed,
      })
      if (replayPending && frame.payload.type === readyType) {
        replayPending = false
        return
      }
      if (
        pending.size + 1 > MHP_PANEL.maximumQueuedMessages ||
        pendingBytes + count > MHP_PANEL.maximumQueuedBytes
      )
        return refuse('MHP_PANEL_BACKPRESSURE')
      page.chrome.webview.postMessage(frame)
      pending.set(outgoing, count)
      pendingBytes += count
      outgoing++
    },
    onMessage(listener) {
      if (typeof listener !== 'function') throw new TypeError('MHP_PANEL_INVALID_PAYLOAD')
      if (isStopped) return refuse('MHP_PANEL_UNKNOWN_SURFACE')
      listeners.add(listener)
      if (!isSubscribed) {
        page.chrome.webview.postMessage(browserControlSchema.parse({ bridge: 'subscribed' }))
        isSubscribed = true
      }
      return () => {
        listeners.delete(listener)
      }
    },
    getState() {
      return state === undefined ? undefined : copy(state)
    },
    setState(value) {
      if (isStopped) return refuse('MHP_PANEL_UNKNOWN_SURFACE')
      const parsed = embeddedBridgeStateSchema.parse(value)
      const control = browserControlSchema.parse({ bridge: 'state', state: parsed })
      if (bytes(control) > MHP_PANEL.maximumEnvelopeBytes) return refuse('MHP_PANEL_TOO_LARGE')
      page.chrome.webview.postMessage(control)
      state = copy(parsed)
    },
  })
  page.chrome.webview.addEventListener('message', (event) => {
    try {
      const drained = drainSchema.safeParse(event.data)
      if (drained.success) {
        if (drained.data.surface !== binding.surface || !pending.has(drained.data.seq))
          return refuse('MHP_PANEL_OUT_OF_ORDER')
        pendingBytes -= pending.get(drained.data.seq)
        pending.delete(drained.data.seq)
        return
      }
      const error = panelErrorSchema.safeParse(event.data)
      if (error.success) {
        isStopped = true
        page.console.error(error.data.code)
        return
      }
      const frame = parseMhpPanelEnvelope(event.data, {
        binding,
        expectedSeq: incoming,
        direction: 'toPanel',
        ready: isSubscribed,
      })
      incoming++
      for (const listener of listeners) listener(copy(frame.payload))
    } catch {
      page.console.error('MHP_PANEL_INVALID_ENVELOPE')
    }
  })
  Object.defineProperty(page, 'museHost', { value: api, configurable: false, writable: false })
  // Compatibility for the frozen React entry until lane D selects its embedded bridge.
  // This adapter routes through the real API above; it defines no new wire vocabulary.
  if (typeof page.acquireVsCodeApi !== 'function') {
    Object.defineProperty(page, 'acquireVsCodeApi', {
      value: () => {
        api.onMessage((payload) =>
          page.dispatchEvent(new page.MessageEvent('message', { data: payload })),
        )
        return api
      },
    })
  }
  return api
}
