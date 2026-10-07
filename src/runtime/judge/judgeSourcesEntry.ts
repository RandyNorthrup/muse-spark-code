// C/E source assembly is loaded only when an explicit source is selected.
import { createJudgeSourceRouter } from '../../core/judge/routing'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'

export function createJudgeSourcesFeatures(language: {
  readonly uiText: UiText
  readonly uiLocale: string
}) {
  setUiText(language.uiText, language.uiLocale)
  return { createJudgeSourceRouter }
}
