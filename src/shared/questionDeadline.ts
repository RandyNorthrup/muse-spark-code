// Deadline normalization is shared by interactive ACP and its CLI parser;
// parsing arguments must not retain the question state machine.
import { QUESTION_DEFER_DEFAULT_SECONDS } from './constants'

// D121: no threshold of ours. Any whole number of seconds at or above zero
// is taken as the person set it (0 never defers); anything else is not a
// count and is refused, never silently replaced.
export function questionDeferSeconds(seconds = QUESTION_DEFER_DEFAULT_SECONDS): number | undefined {
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : undefined
}
