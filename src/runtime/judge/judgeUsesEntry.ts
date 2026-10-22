import { JudgeUses } from '../../host/judge/uses'
import { judgeUseAdvice, appendJudgeHint } from '../../core/judge/uses/advice'
import { admitJudgeUse, JUDGE_USE_DEFINITIONS } from '../../core/judge/uses/definitions'
import { canStartJudgeAtFence, readJudgeAtDeadline } from '../../core/judge/uses/fences'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'

const features = {
  JudgeUses,
  judgeUseAdvice,
  appendJudgeHint,
  admitJudgeUse,
  definitions: JUDGE_USE_DEFINITIONS,
  canStartJudgeAtFence,
  readJudgeAtDeadline,
}

/** No source or policy is installed until independently certified by the caller. */
export function createJudgeUsesFeatures(language: {
  readonly uiText: UiText
  readonly uiLocale: string
}) {
  setUiText(language.uiText, language.uiLocale)
  return features
}
