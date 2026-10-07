import {
  museCodeReviewerPort,
  type MuseCodeReviewerPortDeps,
} from '../../host/review/museCodeReviewerBundle'
import { UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { runtimeFeatureLifetime } from './lifetime'

export interface RuntimeAutoReviewerDeps extends MuseCodeReviewerPortDeps {
  readonly isTrusted: () => boolean
  /** Verified selected-catalog support, including the reviewer's no-thinking mode. */
  readonly canReview: (modelId?: string) => boolean
  readonly assertCurrent: () => void
}

/** The existing captured Muse reviewer stays in its own lazy bundle. */
export function createRuntimeAutoReviewer(
  deps: RuntimeAutoReviewerDeps,
  table: UiText,
  locale: string,
) {
  setUiText(table, locale)
  const lifetime = runtimeFeatureLifetime(deps.assertCurrent)
  const isOn = () => {
    try {
      lifetime.check()
      return deps.isOn() && deps.isTrusted() && deps.canReview()
    } catch {
      return false
    }
  }
  const port = museCodeReviewerPort({
    ...deps,
    isOn,
    isCurrent: (modelId) => isOn() && deps.canReview(modelId),
  })
  let closing: Promise<void> | undefined
  return {
    reviewer: {
      ...port,
      reviewer: () => {
        if (!isOn()) throw new Error(UI_TEXT.autoReviewerFailed)
        return port.reviewer()
      },
    },
    dispose: () => {
      port.dispose()
      closing ??= (async () => {
        await lifetime.dispose()
        await port.settled()
      })()
      return closing
    },
  }
}
