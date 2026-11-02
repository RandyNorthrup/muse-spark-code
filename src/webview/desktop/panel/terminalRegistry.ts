// Muse Desktop (M111, D91.13) lane BP: the persistent terminals'
// registry. The emulator outlives its React shell (a dragged tab moves
// its shell without losing its transcript), so the engine registers each
// created emulator here and DesktopApp releases closed tabs through the
// same registry. This module is the startup chunk's only handle on the
// terminal engines: it must never import xterm (or anything that does),
// so the engine stays in the lazy chunk the panel loads on first use.

export interface ReleasableTerminal {
  release(): void
}

const persistentTerminals = new Map<string, ReleasableTerminal>()

/** Registers a tab's emulator; the same tab never registers twice. */
export function registerPersistentTerminal(tabId: string, terminal: ReleasableTerminal): void {
  persistentTerminals.set(tabId, terminal)
}

/** Forgets a tab's emulator without disposing it; unknown ids are already gone. */
export function unregisterPersistentTerminal(tabId: string): void {
  persistentTerminals.delete(tabId)
}

/** Disposes a closed tab's emulator; unknown ids are already gone. */
export function releasePersistentTerminal(tabId: string): void {
  persistentTerminals.get(tabId)?.release()
}
