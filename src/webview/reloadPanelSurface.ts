import { MAKER_RELOAD_STATE_KEY, PANEL_RELOAD_EVENT } from '../shared/constants'

/**
The marker is UI position only, so a storage failure of any shape (a
SecurityError DOMException in Chromium, whatever a host's shim throws) is
captured as data: the reload still recovers the module graph.
*/
function attemptStorage<T>(run: () => T): { readonly value: T } | { readonly cause: unknown } {
  try {
    return { value: run() }
  } catch (error: unknown) {
    return { cause: error }
  }
}

/** A new document has a new module map, including failed static dependencies. */
export function reloadPanelSurface(): void {
  attemptStorage(() => {
    // UI position only. The ready handshake re-fetches payloads and admission from the host.
    sessionStorage.setItem(MAKER_RELOAD_STATE_KEY, '1')
  })
  window.dispatchEvent(new Event(PANEL_RELOAD_EVENT))
  window.location.reload()
}

/** No payload, admission, review completion or grant lives in browser storage. */
export function isMakerReloadPending(): boolean {
  const attempt = attemptStorage(() => {
    const state = sessionStorage.getItem(MAKER_RELOAD_STATE_KEY)
    sessionStorage.removeItem(MAKER_RELOAD_STATE_KEY)
    return state
  })
  return 'value' in attempt && attempt.value === '1'
}
