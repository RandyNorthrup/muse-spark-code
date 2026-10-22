import type { MuseEmbeddedHost } from '../../shared/hostApi/panel'
import { bootImport, type PanelBridge, type PanelCodec } from './types'
import { vscodeBridge } from './vscode'
import { companionStateStore } from './state'

declare global {
  interface Window {
    museHost?: MuseEmbeddedHost
  }
}

export async function selectBridge(
  codec: PanelCodec,
  onError: (error: unknown) => void,
): Promise<PanelBridge> {
  if (window.museHost !== undefined) {
    const { nativeBridge } = await bootImport(() => import('./native'), 'native')
    return nativeBridge(window.museHost, codec)
  }
  if (document.body.dataset['bridge'] === 'companion') {
    const [{ companionBridge }, { panelBindingSchema }] = await Promise.all([
      bootImport(() => import('./companion'), 'companion'),
      bootImport(() => import('../../shared/hostApi/panel'), 'companion'),
    ])
    const value: unknown = JSON.parse(document.querySelector('#muse-panel')?.textContent ?? 'null')
    const binding = panelBindingSchema.parse(value)
    return companionBridge(
      binding,
      codec,
      window.fetch.bind(window),
      onError,
      companionStateStore(binding.surface, window.sessionStorage),
    )
  }
  return vscodeBridge(window, codec, onError)
}

/** What's New keeps schemas and transports out of its small click-handler bundle. */
export async function selectWhatsNewBridge(
  onError: (error: unknown) => void,
): Promise<PanelBridge> {
  const { whatsNewMessageSchema } = await import('../../shared/whatsNewMessages')
  return await selectBridge(
    {
      outgoing: whatsNewMessageSchema,
      incoming: {
        parse() {
          throw new Error('MHP_PANEL_INVALID_PAYLOAD')
        },
      },
    },
    onError,
  )
}
