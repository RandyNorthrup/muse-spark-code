// Deadline normalization is shared by interactive ACP and its CLI parser;
// parsing arguments must not retain the question state machine.
import {
  QUESTION_DEFER_DEFAULT_SECONDS,
  QUESTION_DEFER_MAX_SECONDS,
  QUESTION_DEFER_MIN_SECONDS,
} from './constants'

export function questionDeferSeconds(seconds = QUESTION_DEFER_DEFAULT_SECONDS): number | undefined {
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > QUESTION_DEFER_MAX_SECONDS)
    return undefined
  return seconds === 0 ? 0 : Math.max(QUESTION_DEFER_MIN_SECONDS, seconds)
}
