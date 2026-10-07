import {
  LOCAL_JUDGE_RECOMMENDATIONS,
  pullLocalJudgeModel,
} from '../../core/judge/local/recommendations'
import {
  createHostLocalJudge,
  hostLocalModelPullAction,
  localJudgeStatus,
  type LocalJudgeHostDependencies,
} from '../../host/judge/local'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { prepareLocalJudgeHelper, type LocalJudgeHelperPaths } from './localHelper'

const features = {
  createLocalJudge(
    deps: Omit<LocalJudgeHostDependencies, 'peerHelper'>,
    paths: LocalJudgeHelperPaths,
  ) {
    return createHostLocalJudge({
      ...deps,
      peerHelper: (platform) => prepareLocalJudgeHelper(paths, platform),
    })
  },
  hostLocalModelPullAction,
  pullLocalJudgeModel,
  localJudgeStatus,
  recommendations: LOCAL_JUDGE_RECOMMENDATIONS,
  prepareLocalJudgeHelper,
}

/** A library load prepares no helper, socket, download or inference. */
export function createJudgeLocalFeatures(language: {
  readonly uiText: UiText
  readonly uiLocale: string
}) {
  setUiText(language.uiText, language.uiLocale)
  return features
}
