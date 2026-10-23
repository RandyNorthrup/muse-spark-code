// Serve's injected factory, loaded only on an explicit serve action.
import { startJudgeServer } from './serve'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'

const features = {
  startJudgeServer,
}

export function createJudgeServeFeatures(language: {
  readonly uiText: UiText
  readonly uiLocale: string
}) {
  setUiText(language.uiText, language.uiLocale)
  return features
}
