import { lazyBundleLoader } from '../../host/lazyBundle'
import type { CoreLogger } from '../../core/logging'
import { UI_TEXT } from '../../shared/constants'
import type * as QuestionRegistryBundle from './questionRegistryEntry'

type Bundle = typeof QuestionRegistryBundle
/** Same-build signatures are trusted after checking both exported functions (PLAN §8). */
function isBundle(value: unknown): value is Bundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createRuntimeQuestionRegistry' in value &&
    typeof value.createRuntimeQuestionRegistry === 'function' &&
    'removeRuntimeQuestions' in value &&
    typeof value.removeRuntimeQuestions === 'function'
  )
}

export function runtimeQuestionsLoader(bundlePath: string, log: CoreLogger) {
  return lazyBundleLoader({
    bundlePath,
    log,
    isBundle,
    label: 'Question registry',
    unavailable: () => UI_TEXT.questionAnswerFailed,
  })
}
