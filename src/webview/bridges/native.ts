import type { MuseEmbeddedHost } from '../../shared/hostApi/panel'
import { jsonValueSchema } from '../../shared/hostApi/data'
import { browserState } from './state'
import { loadFallbacks, panelMessages, type PanelBridge, type PanelCodec } from './types'

export function nativeBridge(host: MuseEmbeddedHost, codec: PanelCodec): PanelBridge {
  const bus = panelMessages(codec)
  const stop = host.onMessage((payload) => {
    bus.receive(payload)
  })
  return {
    post: (message) => {
      host.postMessage(codec.outgoing.parse(message))
    },
    savedState: () => {
      const state = host.getState()
      return state === undefined ? undefined : jsonValueSchema.parse(state)
    },
    saveState: (state) => {
      host.setState(browserState(state))
    },
    messages: bus.source,
    loadFallbacks,
    dispose: stop,
  }
}
