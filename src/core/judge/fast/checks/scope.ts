// M125 lane K (D107 §7.5): is this change outside the requested scope.
// One path (or hunk) per check, over the request; the caller runs one
// check per changed path. A hint while the turn runs, a note under the
// reply listing out-of-scope paths. Bar: precision ≥ 0.9.
import type { CommittedCalibrationProfile } from '../../calibration/profiles'
import type { CalibrationLimits } from '../../calibration/schema'
import { boundEvidence } from './evidence'
import { runAccuracyCheck } from './gate'
import type { AccuracyEngine, AccuracyOutput } from './types'

export interface ScopeInputs {
  readonly request: string
  readonly path: string
  readonly hunk?: string | undefined
}

/** The request with the one path (and hunk) judged against it. */
export function scopeState(inputs: ScopeInputs): string {
  const parts = [boundEvidence(inputs.request), boundEvidence(inputs.path)]
  if (inputs.hunk !== undefined) parts.push(boundEvidence(inputs.hunk))
  return parts.join('\n')
}

export interface ScopeSlots {
  readonly path: string
}

export interface ScopeDecision {
  readonly inputs: ScopeInputs
  readonly rawProbability: number
  readonly engine: AccuracyEngine
  readonly profiles: readonly CommittedCalibrationProfile[]
  readonly limits: CalibrationLimits
}

export function decideScope(decision: ScopeDecision): AccuracyOutput<ScopeSlots> {
  return runAccuracyCheck({
    check: 'scope.outside',
    rawProbability: decision.rawProbability,
    engine: decision.engine,
    profiles: decision.profiles,
    limits: decision.limits,
    slots: { path: boundEvidence(decision.inputs.path) },
  })
}
