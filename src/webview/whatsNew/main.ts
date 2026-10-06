// What's New's page bundle (M99, PLAN.md D79): dist/webview/whatsNew.js and
// its stylesheet, dist/webview/whatsNew.css, loaded by the page alone.

import '../tokens.css'
import './whatsNew.css'
import { wireWhatsNewPage } from './whatsNewPage'

async function mount(): Promise<void> {
  const { selectWhatsNewBridge } = await import('../bridges/select')
  const host = await selectWhatsNewBridge((error) => {
    window.dispatchEvent(new ErrorEvent('error', { error }))
  })
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
void mount().catch((error: unknown) => {
  window.dispatchEvent(new ErrorEvent('error', { error }))
})
