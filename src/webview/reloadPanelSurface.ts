import {
  MAKER_PROTOCOL_MAX_TEXT_CHARS,
  MAKER_RELOAD_STATE_KEY,
  PANEL_RELOAD_EVENT,
} from '../shared/constants'

/** A new document has a new module map, including failed static dependencies. */
export function reloadPanelSurface(messages: readonly unknown[] = []): void {
  try {
    sessionStorage.removeItem(MAKER_RELOAD_STATE_KEY)
    const state = JSON.stringify(messages)
    if (state.length <= MAKER_PROTOCOL_MAX_TEXT_CHARS * 2)
      sessionStorage.setItem(MAKER_RELOAD_STATE_KEY, state)
  } catch {
    // Reload must still recover the module graph when this host denies browser storage.
  }
  window.dispatchEvent(new Event(PANEL_RELOAD_EVENT))
  window.location.reload()
}

/** Restored frames remain untrusted until the lazy maker store validates each one. */
export function makerReloadMessages(): readonly unknown[] {
  try {
    const state = sessionStorage.getItem(MAKER_RELOAD_STATE_KEY)
    sessionStorage.removeItem(MAKER_RELOAD_STATE_KEY)
    if (state === null || state.length > MAKER_PROTOCOL_MAX_TEXT_CHARS * 2) return []
    const messages: unknown = JSON.parse(state)
    return Array.isArray(messages) ? messages : []
  } catch {
    return []
  }
}
