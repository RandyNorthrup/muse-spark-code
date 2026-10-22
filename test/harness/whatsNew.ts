// Fixture-only carrier for the real CSP-protected release-note markup and page script.
import axe from 'axe-core'
import { wireWhatsNewPage } from '../../src/webview/whatsNew/whatsNewPage'

Reflect.set(window, 'axe', axe)
const events: unknown[] = []
const result = document.createElement('pre')
result.id = 'events'
result.hidden = true
document.body.append(result)
wireWhatsNewPage(document, (message) => {
  events.push(message)
  result.textContent = JSON.stringify(events)
})
