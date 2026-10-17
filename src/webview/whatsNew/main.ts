// What's New's page bundle (M99, PLAN.md D79): dist/webview/whatsNew.js and
// its stylesheet, dist/webview/whatsNew.css, loaded by the page alone.

import './whatsNew.css'
import { wireWhatsNewPage } from './whatsNewPage'

const api = acquireVsCodeApi()
wireWhatsNewPage(document, (message) => {
  api.postMessage(message)
})
