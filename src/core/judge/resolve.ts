// The phase-1 judge mode resolver (M98, D77). `auto` is `same`; `separate`
// and `both` arrive with phase 2a. Pure and synchronous: it resolves at the
// first decision point, never at activation, and the host caches per window
// and re-resolves on the triggers below. No `vscode` import.

import * as z from 'zod/mini'

const engineSchema = z.enum(['auto', 'same', 'off'])

/** `museSpark.judge.engine` in phase 1 (the setting itself is lane 0). */
export type JudgeEngineSetting = z.infer<typeof engineSchema>

/** Phase-1 modes. `auto` resolves to `same`; there is no other source yet. */
export type JudgeMode = 'same' | 'off'

/**
 * Why the resolver decided as it did. Reason codes, not user text: lane U
 * says them through lane 0's strings.
 */
export type JudgeModeReason =
  | 'explicit-off'
  | 'unknown-setting'
  | 'consent-needed'
  | 'consent-declined'
  | 'source-unavailable'
  | 'ready-rate-low'
  | 'auto-same'
  | 'explicit-same'

export interface JudgeModeResolution {
  readonly mode: JudgeMode
  readonly reason: JudgeModeReason
}

/** Paid consent for the Model API `judge` feature (lane A/U own the modal). */
export type JudgePaidConsent = 'granted' | 'declined' | 'unasked' | 'not-required'

export interface JudgeModeContext {
  /** Raw `museSpark.judge.engine` value; parsed here, unknown fails closed. */
  readonly engine: unknown
  readonly paidConsent: JudgePaidConsent
  /**
   * Measured ready rate for this backend (lane U, from M75 replays), or
   * undefined while unmeasured. Enhancements are on by default, so an
   * unmeasured backend stays on.
   */
  readonly readyRate: number | undefined
  /** `JUDGE_MIN_READY_RATE` (lane 0). */
  readonly minReadyRate: number
  /**
   * The backend source may judge now (on Muse Code, false while standing
   * user-level always-allow rules exist; lane S checks before each batch).
   */
  readonly sourceAvailable: boolean
  // --- re-resolve triggers (compared by shouldReResolve, D77) ---
  readonly providerId: string
  readonly modelId: string
  readonly confidential: boolean
}

/**
 * Resolve the phase-1 mode. Fail-closed order: an unknown setting, a
 * declined or not-yet-asked paid consent, an unavailable source, and a
 * measured ready rate under the floor forces `auto` off with its reason.
 * Explicit `same` bypasses only that automatic default.
 */
export function resolveJudgeMode(context: JudgeModeContext): JudgeModeResolution {
  const parsed = engineSchema.safeParse(context.engine)
  if (!parsed.success) {
    return { mode: 'off', reason: 'unknown-setting' }
  }
  if (parsed.data === 'off') {
    return { mode: 'off', reason: 'explicit-off' }
  }
  if (context.paidConsent === 'declined') {
    return { mode: 'off', reason: 'consent-declined' }
  }
  if (context.paidConsent === 'unasked') {
    return { mode: 'off', reason: 'consent-needed' }
  }
  if (!context.sourceAvailable) {
    return { mode: 'off', reason: 'source-unavailable' }
  }
  if (
    parsed.data === 'auto' &&
    context.readyRate !== undefined &&
    Number.isFinite(context.readyRate) &&
    context.readyRate < context.minReadyRate
  ) {
    return { mode: 'off', reason: 'ready-rate-low' }
  }
  return { mode: 'same', reason: parsed.data === 'auto' ? 'auto-same' : 'explicit-same' }
}

export interface JudgeModeTriggers {
  readonly engine: unknown
  readonly providerId: string
  readonly modelId: string
  readonly paidConsent: JudgePaidConsent
  readonly confidential: boolean
}

/**
 * Whether to re-resolve: on a change of setting, provider, consent or
 * confidential flag (D77). Anything else — including a fresh ready-rate
 * measurement — keeps the cached resolution.
 */
export function shouldReResolve(previous: JudgeModeTriggers, current: JudgeModeTriggers): boolean {
  return (
    previous.engine !== current.engine ||
    previous.providerId !== current.providerId ||
    previous.modelId !== current.modelId ||
    previous.paidConsent !== current.paidConsent ||
    previous.confidential !== current.confidential
  )
}
