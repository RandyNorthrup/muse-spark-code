// Native/companion What's New page: its global page styles stay in this
// entry's stylesheet, separate from portable chat and Tasks.
import './whatsNew.css'
import { wireWhatsNewPage } from './whatsNewPage'
import { showBridgeFailure } from '../bridges/failure'

async function mount(): Promise<void> {
  const { selectWhatsNewBridge } = await import('../bridges/select')
  const host = await selectWhatsNewBridge(reportBridgeFailure)
  wireWhatsNewPage(document, (message) => {
    host.post(message)
  })
  window.addEventListener(
    'pagehide',
    () => {
      host.dispose()
    },
    { once: true },
  )
}
function reportBridgeFailure(_error: unknown): void {
  showBridgeFailure(document)
}
void mount().catch(reportBridgeFailure)
