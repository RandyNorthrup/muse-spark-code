// Shared first-use inspector: VS Code and ACP install their checked language.
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { checkMediaLimits, sniffMedia } from './limits'

export function createMediaInspector(table: UiText, locale: string) {
  setUiText(table, locale)
  return { sniffMedia, checkMediaLimits }
}
