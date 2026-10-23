// M125 lane K (D107 §7.1): is this command destructive or irreversible.
// A note on the approval card, and the caution latch input that keeps a
// held action held; never an allow. Bar: recall ≥ 0.95 at precision ≥ 0.8.
import type { CommittedCalibrationProfile } from '../../calibration/profiles'
import type { CalibrationLimits } from '../../calibration/schema'
import { boundEvidence } from './evidence'
import { runAccuracyCheck } from './gate'
import type { AccuracyEngine, AccuracyOutput } from './types'

export interface DestructiveInputs {
  readonly command: string
}

/** The command excerpt the question judges over. */
export function destructiveState(inputs: DestructiveInputs): string {
  return boundEvidence(inputs.command)
}

export interface DestructiveSlots {
  readonly command: string
}

export interface DestructiveDecision {
  readonly inputs: DestructiveInputs
  readonly rawProbability: number
  readonly engine: AccuracyEngine
  readonly profiles: readonly CommittedCalibrationProfile[]
  readonly limits: CalibrationLimits
}

export function decideDestructive(decision: DestructiveDecision): AccuracyOutput<DestructiveSlots> {
  return runAccuracyCheck({
    check: 'risk.destructive',
    rawProbability: decision.rawProbability,
    engine: decision.engine,
    profiles: decision.profiles,
    limits: decision.limits,
    slots: { command: boundEvidence(decision.inputs.command) },
  })
}
