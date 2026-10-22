import { EN } from '../../shared/l10n/en'
import { MAKER_EN } from '../../shared/l10n/makerEnglish'
import { setUiText } from '../../shared/l10n/text'
import { installEmbeddedTable } from '../installTable'
import { WEBVIEW_L10N_ELEMENT_ID } from '../../shared/constants'

/** Complete fallback and validation before any deferred maker label is read. */
export function installMakerTable(): void {
  Object.defineProperties(EN, Object.getOwnPropertyDescriptors(MAKER_EN))
  const failure = installEmbeddedTable(document)
  if (failure !== undefined || document.querySelector(`#${WEBVIEW_L10N_ELEMENT_ID}`) === null)
    setUiText(EN, 'en')
  if (failure !== undefined) window.dispatchEvent(new ErrorEvent('error', { error: failure }))
}
