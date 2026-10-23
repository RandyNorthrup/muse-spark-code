// Setup's injected factory, loaded only on an explicit scan, setup or
// remove action.
import { productionSetupCliPorts, runJudgeRemove, runJudgeScan, runJudgeSetup } from './setupCli'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'

const features = {
  productionSetupCliPorts,
  runJudgeRemove,
  runJudgeScan,
  runJudgeSetup,
}

export function createJudgeSetupFeatures(language: {
  readonly uiText: UiText
  readonly uiLocale: string
}) {
  setUiText(language.uiText, language.uiLocale)
  return features
}
