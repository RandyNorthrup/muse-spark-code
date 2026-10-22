import { lazyBundleLoader } from '../../host/lazyBundle'
import type { Logger } from '../../host/logger'
import { fill, UI_TEXT, uiLocale } from '../../shared/l10n/text'
import type * as JudgeEntry from './judgeEntry'

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
