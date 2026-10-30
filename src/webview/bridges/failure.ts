import { UI_TEXT } from '../../shared/l10n/text'
import { installEmbeddedTable } from '../installTable'

/** An unavailable carrier cannot receive its own error report. Show reopen guidance. */
export function showBridgeFailure(page: Document): void {
  if (page.querySelector('#muse-bridge-error') !== null) return
  installEmbeddedTable(page)
  for (const child of page.body.children) if (child instanceof HTMLElement) child.inert = true
  const backdrop = page.createElement('div')
  backdrop.className = 'modal-backdrop'
  const alert = page.createElement('main')
  alert.id = 'muse-bridge-error'
  alert.className = 'modal'
  alert.setAttribute('role', 'alert')
  alert.setAttribute('aria-labelledby', 'muse-bridge-error-title')
  alert.tabIndex = -1
  const title = page.createElement('h1')
  title.id = 'muse-bridge-error-title'
  title.className = 'modal-title'
  title.textContent = UI_TEXT.crashTitle
  const detail = page.createElement('p')
  detail.textContent = UI_TEXT.companionLaunchFailed
  alert.append(title, detail)
  backdrop.append(alert)
  page.body.append(backdrop)
  alert.focus()
}
