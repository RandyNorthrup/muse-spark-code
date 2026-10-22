// M125 lane K (D107 §7.6): is the answer consistent with the files
// read. One claim the reply makes about a named file or symbol, over
// excerpts of the files the agent read this turn; the caller runs one
// check per claim. A note under the reply. Bar: precision ≥ 0.9; a
// check with lower precision stays log-only.
import type { CommittedCalibrationProfile } from '../../calibration/profiles'
import type { CalibrationLimits } from '../../calibration/schema'
import { boundEvidence, joinEvidence } from './evidence'
import { runAccuracyCheck } from './gate'
import type { AccuracyEngine, AccuracyOutput } from './types'

export interface ConsistencyInputs {
  readonly claim: string
  readonly excerpts: readonly string[]
}

/** The claim with the read excerpts it is judged against. */
export function consistencyState(inputs: ConsistencyInputs): string {
  return [boundEvidence(inputs.claim), joinEvidence(inputs.excerpts)].join('\n')
}

export interface ConsistencySlots {
  readonly claim: string
}

export interface ConsistencyDecision {
  readonly inputs: ConsistencyInputs
  readonly rawProbability: number
  readonly engine: AccuracyEngine
  readonly profiles: readonly CommittedCalibrationProfile[]
  readonly limits: CalibrationLimits
}

export function decideConsistency(decision: ConsistencyDecision): AccuracyOutput<ConsistencySlots> {
  return runAccuracyCheck({
    check: 'claim.inconsistent',
    rawProbability: decision.rawProbability,
    engine: decision.engine,
    profiles: decision.profiles,
    limits: decision.limits,
    slots: { claim: boundEvidence(decision.inputs.claim) },
  })
}
