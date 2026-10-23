import { lazyBundleLoader } from '../../host/lazyBundle'
import type { Logger } from '../../host/logger'
import { fill, UI_TEXT, uiLocale } from '../../shared/l10n/text'
import type * as JudgeEntry from './judgeEntry'
import type * as SetupEntry from './judgeSetupEntry'

interface JudgeBundle {
  readonly createJudgeFeatures: typeof JudgeEntry.createJudgeFeatures
}

/** Same-build factory signature is trusted after its callable export is checked (PLAN §8). */
export function isJudgeBundle(value: unknown): value is JudgeBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createJudgeFeatures' in value &&
    typeof value.createJudgeFeatures === 'function'
  )
}

/** CLI and later host surfaces call this loader only at their explicit decision point. */
export function judgeFeaturesLoader(deps: {
  readonly bundlePath: string
  readonly log: Logger
  readonly loadBundle?: ((file: string) => unknown) | undefined
}): () => ReturnType<typeof JudgeEntry.createJudgeFeatures> {
  const load = lazyBundleLoader({
    ...deps,
    isBundle: isJudgeBundle,
    label: 'judge bundle',
    unavailable: () => fill(UI_TEXT.judgeNoAnswer, { reason: 'source-unavailable' }),
  })
  return () => load().createJudgeFeatures({ uiText: UI_TEXT, uiLocale: uiLocale() })
}

interface JudgeSetupBundle {
  readonly createJudgeSetupFeatures: typeof SetupEntry.createJudgeSetupFeatures
}

/** Same-build factory signature is trusted after its callable export is checked (PLAN §8). */
export function isJudgeSetupBundle(value: unknown): value is JudgeSetupBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createJudgeSetupFeatures' in value &&
    typeof value.createJudgeSetupFeatures === 'function'
  )
}

/** The scan/setup/remove child loads only on one of its explicit actions. */
export function setupFeaturesLoader(deps: {
  readonly bundlePath: string
  readonly log: Logger
  readonly loadBundle?: ((file: string) => unknown) | undefined
}): () => ReturnType<typeof SetupEntry.createJudgeSetupFeatures> {
  const load = lazyBundleLoader({
    ...deps,
    isBundle: isJudgeSetupBundle,
    label: 'judge setup bundle',
    unavailable: () => fill(UI_TEXT.judgeNoAnswer, { reason: 'source-unavailable' }),
  })
  return () => load().createJudgeSetupFeatures({ uiText: UI_TEXT, uiLocale: uiLocale() })
}
