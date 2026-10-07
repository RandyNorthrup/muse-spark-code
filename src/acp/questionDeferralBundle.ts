// ACP questions load only for a question, saved queued answer or local command.
import type { CoreLogger } from '../core/logging'
import { lazyBundleLoader } from '../host/lazyBundle'
import { UI_TEXT } from '../shared/constants'
import type { QuestionClock } from '../shared/questions'
import type { createAcpQuestions, acpElicitation } from './questionDeferralEntry'

export interface AcpQuestionBundle {
  readonly createAcpQuestions: typeof createAcpQuestions
  readonly acpElicitation: typeof acpElicitation
}

/** Same-build factory signatures are trusted after checking the export (PLAN §8). */
export function isAcpQuestionBundle(value: unknown): value is AcpQuestionBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createAcpQuestions' in value &&
    typeof value.createAcpQuestions === 'function' &&
    'acpElicitation' in value &&
    typeof value.acpElicitation === 'function'
  )
}

export function questionDeferralLoader(deps: {
  readonly bundlePath: string
  readonly log: CoreLogger
  readonly loadBundle?: ((file: string) => unknown) | undefined
}): () => AcpQuestionBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: isAcpQuestionBundle,
    label: 'ACP questions',
    unavailable: () => UI_TEXT.questionAnswerFailed,
  })
}

/** Real runtime clock; registry loading needs it before any question implementation. */
export const acpQuestionClock: QuestionClock = {
  now: () => Date.now(),
  setTimer: (delayMs, callback) => {
    const timer = setTimeout(callback, delayMs)
    return () => {
      clearTimeout(timer)
    }
  },
}
