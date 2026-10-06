// The setting predicate stays separate from the judge's zod contract so
// reading an engine setting never loads or constructs the judge schemas.
import type { JudgeEngine } from '../../shared/constants'

/** Whether the judge is enabled; paid first-charge consent is separate (D77/D78). */
export function isJudgeEngineOn(engine: JudgeEngine): boolean {
  return engine !== 'off'
}
