import type { MessageSource } from '../hostBridge'
import { loadFallbacks, panelMessages, type PanelBridge, type PanelCodec } from './types'

export function vscodeBridge(
  source: MessageSource,
  codec: PanelCodec,
  onError: (error: unknown) => void,
): PanelBridge {
  const api = acquireVsCodeApi()
  const bus = panelMessages(codec)
  const receive = (event: MessageEvent<unknown>) => {
    try {
      bus.receive(event.data)
    } catch (error) {
      onError(error)
    }
  }
  source.addEventListener('message', receive)
  return {
    post: (message) => {
      api.postMessage(codec.outgoing.parse(message))
    },
    savedState: () => api.getState(),
    saveState: (state) => {
      api.setState(state)
    },
    messages: bus.source,
    loadFallbacks,
    dispose: () => {
      source.removeEventListener('message', receive)
    },
  }
}
