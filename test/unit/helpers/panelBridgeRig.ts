import { vi } from 'vitest'
import { MHP_PANEL } from '../../../src/shared/constants'
import {
  hostToWebviewMessageSchema,
  webviewToHostMessageSchema,
} from '../../../src/shared/protocol'
import {
  panelToPanelPayloadSchema,
  type MhpPanelBinding,
  type MuseEmbeddedHost,
} from '../../../src/shared/hostApi/panel'
import { companionBridge } from '../../../src/webview/bridges/companion'
import { companionStateStore } from '../../../src/webview/bridges/state'
import { nativeBridge } from '../../../src/webview/bridges/native'
import { vscodeBridge } from '../../../src/webview/bridges/vscode'
import type { PanelBridge, PanelCodec } from '../../../src/webview/bridges/types'

const binding: MhpPanelBinding = {
  surface: 'surface-1',
  sessionId: 'session-1',
  surfaceKind: 'chat',
}
const chatCodec: PanelCodec = {
  outgoing: webviewToHostMessageSchema,
  incoming: hostToWebviewMessageSchema,
}
const cleanup: (() => void)[] = []
function ignoreMessage(_data: unknown): void {
  /* A disposed fake has no listener. */
}
function companionOnly(_text: string): never {
  throw new Error('COMPANION_ONLY')
}
export function disposePanelRigs(): void {
  for (const stop of cleanup.splice(0)) stop()
  vi.unstubAllGlobals()
}
export function panelBridgeRig(
  kind: 'vscode' | 'native' | 'companion',
  codec = chatCodec,
  surface = binding,
) {
  const posts: unknown[] = []
  const errors: unknown[] = []
  let saved: unknown
  let receive: (data: unknown) => void = ignoreMessage
  let bridge: PanelBridge
  let receiveRaw: (text: string) => void = companionOnly
  if (kind === 'vscode') {
    vi.stubGlobal('acquireVsCodeApi', () => ({
      postMessage: (data: unknown) => {
        posts.push(data)
      },
      getState: () => saved,
      setState: (state: unknown) => {
        saved = state
      },
    }))
    bridge = vscodeBridge(window, codec, (error) => {
      errors.push(error)
    })
    receive = (data) => {
      window.dispatchEvent(new MessageEvent('message', { data }))
    }
  } else if (kind === 'native') {
    const host: MuseEmbeddedHost = {
      postMessage: (data) => {
        posts.push(data)
      },
      getState: () => undefined,
      setState: (state) => {
        saved = state
      },
      onMessage: (listener) => {
        receive = (data) => {
          listener(panelToPanelPayloadSchema.parse(data))
        }
        return () => {
          receive = () => undefined
        }
      },
    }
    const original = host.setState
    host.setState = (state) => {
      original(state)
      host.getState = () => state
    }
    bridge = nativeBridge(host, codec)
  } else {
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller
      },
    })
    const send: typeof fetch = (_input, init) => {
      if (_input === '/panel/events')
        return Promise.resolve(
          new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
        )
      const value: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : 'null')
      posts.push(value)
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    const storage = new Map<string, string>()
    receiveRaw = (text) => {
      if (stream === undefined) throw new Error('NO_STREAM')
      stream.enqueue(new TextEncoder().encode(text))
    }
    bridge = companionBridge(
      surface,
      codec,
      send,
      (error) => {
        errors.push(error)
      },
      companionStateStore(surface.surface, {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => {
          storage.set(key, value)
        },
      }),
    )
    let seq = 1
    receive = (payload) => {
      const frame = {
        mhp: MHP_PANEL.wireVersion,
        kind: 'panel',
        direction: 'toPanel',
        surface: surface.surface,
        seq: seq++,
        payload,
      }
      receiveRaw(`data: ${JSON.stringify(frame)}\r\n\r\n`)
    }
  }
  cleanup.push(() => {
    bridge.dispose()
  })
  return { bridge, posts, errors, receive, receiveRaw }
}
