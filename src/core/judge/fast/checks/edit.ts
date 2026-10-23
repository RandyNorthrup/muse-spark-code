// M125 lane K (D107 §7.2): does this edit address the request. Below
// the threshold the verdict is a tail hint naming what the edit changes
// against what the request names. Bar: precision ≥ 0.9.
import type { CommittedCalibrationProfile } from '../../calibration/profiles'
import type { CalibrationLimits } from '../../calibration/schema'
import { boundEvidence, joinEvidence } from './evidence'
import { runAccuracyCheck } from './gate'
import type { AccuracyEngine, AccuracyOutput } from './types'

export interface EditInputs {
  readonly request: string
  readonly paths: readonly string[]
  readonly diff: string
}

/** The request, the edit's paths and a bounded diff excerpt. */
export function editState(inputs: EditInputs): string {
  return [
    boundEvidence(inputs.request),
    joinEvidence(inputs.paths),
    boundEvidence(inputs.diff),
  ].join('\n')
}

export interface EditSlots {
  readonly paths: string
  readonly request: string
}

export interface EditDecision {
  readonly inputs: EditInputs
  readonly rawProbability: number
  readonly engine: AccuracyEngine
  readonly profiles: readonly CommittedCalibrationProfile[]
  readonly limits: CalibrationLimits
}

export function decideEdit(decision: EditDecision): AccuracyOutput<EditSlots> {
  return runAccuracyCheck({
    check: 'edit.misfit',
    rawProbability: decision.rawProbability,
    engine: decision.engine,
    profiles: decision.profiles,
    limits: decision.limits,
    slots: {
      paths: joinEvidence(decision.inputs.paths),
      request: boundEvidence(decision.inputs.request),
    },
  })
}
