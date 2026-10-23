// The setting predicate stays separate from the judge's zod contract so
// reading an engine setting never loads or constructs the judge schemas.
import type { JudgeEngine } from '../../shared/constants'
import type { JudgeOutcome, JudgeRequest } from './schema'

/** Whether the judge is enabled; paid first-charge consent is separate (D77/D78). */
export function isJudgeEngineOn(engine: JudgeEngine): boolean {
  return engine !== 'off'
}

/**
Request-only engine injected by the assembly lane into CLI/MCP/serve.
The implementation owns source resolution, redaction, current consent and
durable per-attempt admission. No backend, transport or fallback is created
by importing this interface; callers validate the request and outcome.
*/
export interface JudgeRuntime {
  judge(request: JudgeRequest, signal: AbortSignal): Promise<JudgeOutcome>
}
