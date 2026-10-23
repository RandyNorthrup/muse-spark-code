import { paidUseQuestion } from '../../core/paid/paidConsent'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { runtimeSettings, runtimeConversationDeps } from './runtimeFeatures'

export function createRuntimePanelPorts(table: UiText, locale: string) {
  setUiText(table, locale)
  return { runtimeSettings, runtimeConversationDeps, paidUseQuestion }
}
