// Muse Desktop (M111, D91.16) lane ST1: the settings app's entry. The
// settings client arrives with lane SY's sysd transport over the desktop
// bridge; until then the shell reports the service unavailable instead of
// rendering dead pages.

import { createRoot } from 'react-dom/client'
import { UI_TEXT, WEBVIEW_ROOT_ELEMENT_ID } from '../../shared/constants'
import { followSystemScheme } from '../desktop/systemScheme'
import { SettingsApp } from './shell/SettingsApp'
import './shell/shell.css'
import './system/system.css'

function mount(): void {
  const rootElement = document.querySelector(`#${WEBVIEW_ROOT_ELEMENT_ID}`)
  if (rootElement === null) {
    throw new Error(`Settings root element #${WEBVIEW_ROOT_ELEMENT_ID} is missing`)
  }
  document.title = UI_TEXT.settingsSystem.title
  createRoot(rootElement).render(<SettingsApp client={undefined} />)
}

followSystemScheme()
mount()
