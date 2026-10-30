// Muse Desktop (M111, D91.12) lane WB: the desktop renderer's entry. The
// build also ships this bundle to the harness; without the preload's
// bridge the setup screen says so instead of rendering a dead workbench.

import { createRoot } from 'react-dom/client'
import { UI_TEXT, WEBVIEW_ROOT_ELEMENT_ID } from '../../shared/constants'
import { hasDesktopBridge } from '../bridges/desktop'
import { DesktopApp } from './DesktopApp'
import './desktop.css'

const rootElement = document.querySelector(`#${WEBVIEW_ROOT_ELEMENT_ID}`)
if (rootElement === null) {
  throw new Error(`Desktop root element #${WEBVIEW_ROOT_ELEMENT_ID} is missing`)
}

if (hasDesktopBridge()) {
  createRoot(rootElement).render(<DesktopApp />)
} else {
  rootElement.textContent = UI_TEXT.desktop.workbenchBridgeUnavailable
}
