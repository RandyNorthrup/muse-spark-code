import { MAKER_RELOAD_STATE_KEY, PANEL_RELOAD_EVENT } from '../shared/constants'

/** Storage denial in a webview is a SecurityError DOMException. */
function isStorageDenial(error: unknown): boolean {
  return error instanceof DOMException
}

/** A new document has a new module map, including failed static dependencies. */
export function reloadPanelSurface(): void {
  try {
    // UI position only. The ready handshake re-fetches payloads and admission from the host.
    sessionStorage.setItem(MAKER_RELOAD_STATE_KEY, '1')
  } catch (error: unknown) {
    if (!isStorageDenial(error)) throw error
    // Reload must still recover the module graph when this host denies browser storage.
  }
  window.dispatchEvent(new Event(PANEL_RELOAD_EVENT))
  window.location.reload()
}

/** No payload, admission, review completion or grant lives in browser storage. */
export function isMakerReloadPending(): boolean {
  try {
    const state = sessionStorage.getItem(MAKER_RELOAD_STATE_KEY)
    sessionStorage.removeItem(MAKER_RELOAD_STATE_KEY)
    return state === '1'
  } catch (error: unknown) {
    if (!isStorageDenial(error)) throw error
    return false
  }
}
