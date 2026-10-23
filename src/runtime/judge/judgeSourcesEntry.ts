// C/E source assembly is loaded only when an explicit source is selected.
import { runEmbeddingJudge } from '../../core/judge/embedding/route'
import { embeddingAvailability } from '../../core/judge/embedding/availability'
import { createJudgeSourceRouter } from '../../core/judge/routing'
import {
  buildSeparateSource,
  hasSeparateSourceKey,
  separateRouteFacts,
  separateSourceKey,
} from '../../core/judge/sides'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'

export function createJudgeSourcesFeatures(language: {
  readonly uiText: UiText
  readonly uiLocale: string
}) {
  setUiText(language.uiText, language.uiLocale)
  return {
    createJudgeSourceRouter,
    buildSeparateSource,
    hasSeparateSourceKey,
    separateSourceKey,
    separateRouteFacts,
    embedding: { run: runEmbeddingJudge, availability: embeddingAvailability },
  }
}
