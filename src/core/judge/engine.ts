// The setting predicate stays separate from the judge's zod contract so
// reading an engine setting never loads or constructs the judge schemas.
import type { JudgeEngine } from '../../shared/constants'
import {
  JUDGE_TIMEOUT_DEFAULT_SECONDS,
  JUDGE_TIMEOUT_MAX_SECONDS,
  JUDGE_TIMEOUT_MIN_SECONDS,
  MILLISECONDS_PER_SECOND,
} from '../../shared/constants'

/** Whether the judge is enabled; paid first-charge consent is separate (D77/D78). */
export function isJudgeEngineOn(engine: JudgeEngine): boolean {
  return engine !== 'off'
}

/**
 * Milliseconds before a judge call is dropped at its fence (B17, D115): no
 * peer harness has this fence, so it is the person's setting. Garbage falls
 * back to the default; the runner clamps the same way when unset.
 */
export function judgeTimeoutMs(value: unknown = JUDGE_TIMEOUT_DEFAULT_SECONDS): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    return JUDGE_TIMEOUT_DEFAULT_SECONDS * MILLISECONDS_PER_SECOND
  const seconds = Math.min(JUDGE_TIMEOUT_MAX_SECONDS, Math.max(JUDGE_TIMEOUT_MIN_SECONDS, value))
  return seconds * MILLISECONDS_PER_SECOND
}
