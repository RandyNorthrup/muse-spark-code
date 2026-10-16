// Deadline normalization is shared by interactive ACP and its CLI parser;
// parsing arguments must not retain the question state machine.
import {
  OPEN_QUESTIONS_LIMIT,
  OPEN_QUESTIONS_MAX,
  OPEN_QUESTIONS_MIN,
  QUESTION_DEFER_DEFAULT_SECONDS,
  QUESTION_DEFER_MAX_SECONDS,
  QUESTION_DEFER_MIN_SECONDS,
} from './constants'

export function questionDeferSeconds(seconds = QUESTION_DEFER_DEFAULT_SECONDS): number | undefined {
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > QUESTION_DEFER_MAX_SECONDS)
    return undefined
  return seconds === 0 ? 0 : Math.max(QUESTION_DEFER_MIN_SECONDS, seconds)
}

/**
 * How many questions stay open before the oldest expire (B22, D115): no peer
 * harness caps this, so it is the person's setting. Garbage falls back to
 * the default; the registry clamps the same way when no setting is wired.
 */
export function questionMaxOpen(value: unknown = OPEN_QUESTIONS_MAX): number {
  return typeof value !== 'number' || !Number.isSafeInteger(value)
    ? OPEN_QUESTIONS_MAX
    : Math.min(OPEN_QUESTIONS_LIMIT, Math.max(OPEN_QUESTIONS_MIN, value))
}
