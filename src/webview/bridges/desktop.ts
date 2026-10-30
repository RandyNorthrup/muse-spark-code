// Muse Desktop (M111, D91.12) lane WB: the renderer's side of the desktop
// bridge. The preload installs `window.museDesktop`; anywhere else (a
// browser, the harness) the refusal is said with the stored sentence.

import { UI_TEXT } from '../../shared/constants'
import type { MuseDesktopBridge } from '../../shared/desktop/bridge'

declare global {
  interface Window {
    museDesktop?: MuseDesktopBridge
  }
}

export function desktopBridge(): MuseDesktopBridge {
  const bridge = window.museDesktop
  if (bridge === undefined) {
    throw new Error(UI_TEXT.desktop.workbenchBridgeUnavailable)
  }
  return bridge
}

export function hasDesktopBridge(): boolean {
  return window.museDesktop !== undefined
}
