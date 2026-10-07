// H's injected offline/runtime library, loaded only on an explicit lint action.
import { LintCache } from '../../core/judge/lint/cache'
import {
  decodeLintConfig,
  decodeLintPackRules,
  normalizeLintRules,
} from '../../core/judge/lint/config'
import { resolveLintCallees } from '../../core/judge/lint/context'
import { runLintEvals } from '../../core/judge/lint/evals'
import {
  decodeLintPackManifest,
  mergeLintPacks,
  decodeLintEvals,
} from '../../core/judge/lint/formats'
import { createLintWording } from '../../core/judge/lint/rules'
import { readLintSyntax } from '../../core/judge/lint/syntax'
import { createHostLintExtractors } from '../../host/judge/lint'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { runJudgeLint } from './lint'

const features = {
  LintCache,
  decodeLintConfig,
  decodeLintPackRules,
  normalizeLintRules,
  resolveLintCallees,
  runLintEvals,
  decodeLintPackManifest,
  mergeLintPacks,
  decodeLintEvals,
  createLintWording,
  readLintSyntax,
  createHostLintExtractors,
  runJudgeLint,
}

export function createJudgeLintFeatures(language: {
  readonly uiText: UiText
  readonly uiLocale: string
}) {
  setUiText(language.uiText, language.uiLocale)
  return features
}
