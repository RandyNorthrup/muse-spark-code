// The phase-1 judge mode resolver (M98, D77). `auto` is `same`; `separate`
// and `both` arrive with phase 2a (`resolveJudgeMode2a` below). Pure and
// synchronous: it resolves at the first decision point, never at
// activation, and the host caches per window and re-resolves on the
// triggers below. No `vscode` import.

import * as z from 'zod/mini'
import type { JudgeAdoptionContext } from './adoption'

const phase2EngineSchema = z.enum(['auto', 'same', 'separate', 'both', 'off'])

/** `museSpark.judge.engine` (the setting itself is lane 0). */
export type JudgeEngineSetting = z.infer<typeof phase2EngineSchema>

type Phase2Engine = JudgeEngineSetting

/** Phase-1 modes. `auto` resolves to `same`; there is no other source yet. */
export type JudgeMode = 'same' | 'off'

/**
Why the resolver decided as it did. Reason codes, not user text: lane U
says them through lane 0's strings.
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

/**
What a separate judge source offers at resolve time (phase 2a). Every
field must be an explicit boolean: a missing or malformed readiness fails
closed to `source-unavailable`, never to an assumed source.
*/
export interface JudgeSeparateReadiness {
  /** The separate source exists and may judge now. */
  readonly available: boolean
  /** The source passed its verification gates (a C, E or J source). */
  readonly verified: boolean
  /** Suitable B profiles exist for this source and family. */
  readonly profilesReady: boolean
  readonly adoption?:
    | {
        readonly record: unknown
        readonly context: JudgeAdoptionContext
        readonly check?: ((record: unknown, context: JudgeAdoptionContext) => boolean) | undefined
      }
    | undefined
}

export interface JudgeModeContext {
  /** Raw `museSpark.judge.engine` value; parsed here, unknown fails closed. */
  readonly engine: unknown
  readonly paidConsent: JudgePaidConsent
  /**
  Measured ready rate for this backend (lane U, from M75 replays), or
  undefined while unmeasured. Enhancements are on by default, so an
  unmeasured backend stays on.
  */
  readonly readyRate: number | undefined
  /** `JUDGE_MIN_READY_RATE` (lane 0). */
  readonly minReadyRate: number
  /**
  The backend source may judge now (on Muse Code, false while standing
  user-level always-allow rules exist; lane S checks before each batch).
  */
  readonly sourceAvailable: boolean
  /**
  Separate-source readiness (phase 2a). Absent while no separate source
  is configured; the phase-1 entry below never reads it. Optional so
  existing callers keep compiling unchanged.
  */
  readonly separate?: JudgeSeparateReadiness | undefined
  // --- re-resolve triggers (compared by shouldReResolve, D77) ---
  readonly providerId: string
  readonly modelId: string
  readonly confidential: boolean
  readonly endpoint?: string | undefined
  readonly profileId?: string | undefined
  readonly ownerId?: string | undefined
  readonly turn?: string | number | undefined
}

/**
The shared fail-closed prefix: an unknown setting, `off`, and a
declined or not-yet-asked paid consent decide before any mode does.
Every early reason below is a phase-1 reason, so both entries share it.
*/
function failClosedPrefix(
  context: JudgeModeContext,
): { readonly resolution: JudgeModeResolution } | { readonly engine: Phase2Engine } {
  const parsed = phase2EngineSchema.safeParse(context.engine)
  if (!parsed.success) {
    return { resolution: { mode: 'off', reason: 'unknown-setting' } }
  }
  if (parsed.data === 'off') {
    return { resolution: { mode: 'off', reason: 'explicit-off' } }
  }
  if (context.paidConsent === 'declined') {
    return { resolution: { mode: 'off', reason: 'consent-declined' } }
  }
  return context.paidConsent === 'unasked'
    ? { resolution: { mode: 'off', reason: 'consent-needed' } }
    : { engine: parsed.data }
}

/**
Resolve the phase-1 mode. Fail-closed order: an unknown setting, a
declined or not-yet-asked paid consent, an unavailable source, and a
measured ready rate under the floor forces `auto` off with its reason.
Explicit `same` bypasses only that automatic default.
*/
export function resolveJudgeMode(context: JudgeModeContext): JudgeModeResolution {
  const prefix = failClosedPrefix(context)
  if ('resolution' in prefix) {
    return prefix.resolution
  }
  if (prefix.engine === 'separate' || prefix.engine === 'both') {
    return { mode: 'off', reason: 'unknown-setting' }
  }
  if (!context.sourceAvailable) {
    return { mode: 'off', reason: 'source-unavailable' }
  }
  if (
    prefix.engine === 'auto' &&
    context.readyRate !== undefined &&
    Number.isFinite(context.readyRate) &&
    context.readyRate < context.minReadyRate
  ) {
    return { mode: 'off', reason: 'ready-rate-low' }
  }
  return { mode: 'same', reason: prefix.engine === 'auto' ? 'auto-same' : 'explicit-same' }
}

export interface JudgeModeTriggers {
  readonly engine: unknown
  readonly providerId: string
  readonly modelId: string
  readonly paidConsent: JudgePaidConsent
  readonly confidential: boolean
  /**
  Selection and result invalidation (phase 2a): a change of source,
  model, endpoint, profile, consent, owner, mode, turn or confidential
  state discards the cached selection. A cached selection is no trust
  proof. Fields the caller does not track stay undefined on both sides
  and never trigger alone; the host binds them as its wiring learns
  each identity (Z's wiring).
  */
  readonly endpoint?: string | undefined
  readonly profileId?: string | undefined
  readonly ownerId?: string | undefined
  readonly turn?: string | number | undefined
}

/**
Whether to re-resolve: on a change of setting, provider, model,
endpoint, profile, consent, owner, turn or confidential flag (D77, 2a).
Anything else — including a fresh ready-rate measurement — keeps the
cached resolution.
*/
export function shouldReResolve(previous: JudgeModeTriggers, current: JudgeModeTriggers): boolean {
  return (
    previous.engine !== current.engine ||
    previous.providerId !== current.providerId ||
    previous.modelId !== current.modelId ||
    previous.paidConsent !== current.paidConsent ||
    previous.confidential !== current.confidential ||
    previous.endpoint !== current.endpoint ||
    previous.profileId !== current.profileId ||
    previous.ownerId !== current.ownerId ||
    previous.turn !== current.turn
  )
}

// --- Phase 2a: `separate`, `both`, and `auto` becoming `both` ---
//
// `auto` becomes `both` only with a verified, available separate source and
// suitable profiles; otherwise it retains phase-1 `same` and its readiness
// default. An explicit mode bypasses an automatic readiness default only:
// never consent, confidentiality, provenance or admission. The resolution
// never names a conversation model: the same model remains the
// conversation's model whatever the judge mode resolves to. The separate
// codes reuse P0's `JUDGE_NO_ANSWER_REASONS` vocabulary
// (`source-unavailable`, `source-untested`, `profile-missing`) so dispatch,
// CLI and panel agree once the shared status widens (lead/Z decision; the
// phase-1 entry and `JudgeStatus` above are untouched, so the current host
// keeps compiling and behaving exactly as before).

/** Phase-2a resolved judge modes. `auto` never survives resolution. */
export type JudgeMode2a = 'same' | 'separate' | 'both' | 'off'

export type JudgeModeReason2a =
  | JudgeModeReason
  | 'source-untested'
  | 'profile-missing'
  | 'auto-both'
  | 'explicit-separate'
  | 'explicit-both'

export interface JudgeModeResolution2a {
  readonly mode: JudgeMode2a
  readonly reason: JudgeModeReason2a
  readonly autoSameReason?:
    'source-unavailable' | 'source-untested' | 'profile-missing' | 'evidence-missing'
}

type SeparateGate =
  { readonly blocked: true; readonly reason: JudgeModeReason2a } | { readonly blocked: false }

function separateGate(
  separate: JudgeSeparateReadiness | undefined,
  isProfileGated = true,
): SeparateGate {
  // Readiness arrives over a trust boundary, so each field is read as
  // `unknown` and compared against literal `true`: a truthy malformed
  // value ("false") must fail closed. Comparing the typed `boolean`
  // fields directly would assert the very assumption malformed input
  // violates (and the type-aware lint forbids it as unnecessary).
  const available: unknown = separate?.available
  if (available !== true) {
    return { blocked: true, reason: 'source-unavailable' }
  }
  const verified: unknown = separate?.verified
  if (verified !== true) {
    return { blocked: true, reason: 'source-untested' }
  }
  const profilesReady: unknown = separate?.profilesReady
  return profilesReady === true || !isProfileGated
    ? { blocked: false }
    : { blocked: true, reason: 'profile-missing' }
}

/**
Resolve the phase-2a mode. Without a separate readiness the phase-1
subset answers exactly as `resolveJudgeMode` (which owns it, and which
this delegates to), so `auto` retains phase-1 `same` until a verified,
available separate source with suitable profiles appears.
*/
export function resolveJudgeMode2a(context: JudgeModeContext): JudgeModeResolution2a {
  const prefix = failClosedPrefix(context)
  if ('resolution' in prefix) {
    return prefix.resolution
  }
  const engine = prefix.engine
  if (engine === 'separate') {
    // The setting's contract: `separate` runs the configured source alone
    // once it is verified and permitted. Fitted profiles qualify the
    // cascade (`both`, `auto` → `both`), which combines two sides; an
    // uncalibrated separate answer keeps its own honest label.
    const gate = separateGate(context.separate, false)
    return gate.blocked
      ? { mode: 'off', reason: gate.reason }
      : { mode: 'separate', reason: 'explicit-separate' }
  }
  if (engine === 'both') {
    if (!context.sourceAvailable) {
      return { mode: 'off', reason: 'source-unavailable' }
    }
    const gate = separateGate(context.separate)
    return gate.blocked
      ? { mode: 'off', reason: gate.reason }
      : { mode: 'both', reason: 'explicit-both' }
  }
  if (engine === 'same' || context.separate === undefined) {
    return resolveJudgeMode(context)
  }
  if (!context.sourceAvailable) {
    return { mode: 'off', reason: 'source-unavailable' }
  }
  if (
    context.readyRate !== undefined &&
    Number.isFinite(context.readyRate) &&
    context.readyRate < context.minReadyRate
  ) {
    return { mode: 'off', reason: 'ready-rate-low' }
  }
  const gate = separateGate(context.separate)
  if (gate.blocked) {
    return {
      mode: 'same',
      reason: 'auto-same',
      autoSameReason:
        gate.reason === 'source-untested' || gate.reason === 'profile-missing'
          ? gate.reason
          : 'source-unavailable',
    }
  }
  const adoption = context.separate.adoption
  return adoption?.context.providerId === context.providerId &&
    adoption.context.modelId === context.modelId &&
    adoption.check?.(adoption.record, adoption.context) === true
    ? { mode: 'both', reason: 'auto-both' }
    : { mode: 'same', reason: 'auto-same', autoSameReason: 'evidence-missing' }
}
