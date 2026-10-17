// The same-build ACP question factory, shipped beside acp.js in its npm package.
import type { UiText } from '../shared/l10n/en'
import { setUiText } from '../shared/l10n/text'
import { AcpQuestionDeferral, type AcpQuestionDeferralDeps } from './questionDeferral'
import { elicitationSchema, elicitationText, parseElicitationResult } from './questions'

export function acpElicitation(table: UiText, locale: string) {
  setUiText(table, locale)
  return { elicitationSchema, elicitationText, parseElicitationResult }
}

export function createAcpQuestions(
  deps: AcpQuestionDeferralDeps,
  table: UiText,
  locale: string,
): AcpQuestionDeferral {
  setUiText(table, locale)
  return new AcpQuestionDeferral(deps)
}
