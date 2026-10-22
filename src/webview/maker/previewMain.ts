// Separate <=25 KiB page: localized labels belong to the host-rendered HTML,
// so neither React nor the English table travels with the WebGL renderer.
import type { MakerSurfaceMessage } from '../../shared/makerProtocol'
import { vsCodeHostBridge } from '../hostBridge'
import { wireMakerPreview } from './previewPage'
import './preview.css'

// Companion/native pages import this entry and provide their own HostBridge.
export { wireMakerPreview } from './previewPage'
if (typeof acquireVsCodeApi === 'function') {
  const dispose = wireMakerPreview(document, vsCodeHostBridge<MakerSurfaceMessage>(window))
  window.addEventListener('pagehide', dispose, { once: true })
}
