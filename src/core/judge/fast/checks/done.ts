// M125 lane K (D107 §7.4): is a claimed "done" backed by evidence. The
// §6.4 choice (done with evidence, done without evidence, not done)
// asked over the reply and the turn's tool results; the unbacked event
// is done-without-evidence or not-done. A note under the reply.
// Bar: precision ≥ 0.9.
import type { CommittedCalibrationProfile } from '../../calibration/profiles'
import type { CalibrationLimits } from '../../calibration/schema'
import { boundEvidence, joinEvidence } from './evidence'
import { runAccuracyCheck } from './gate'
import type { AccuracyEngine, AccuracyOutput } from './types'

/**
The choice's binary event: §6.4's option order is structural ([done
with evidence, done without evidence, not done]), so the unbacked
probability is the last two options. A malformed distribution yields
NaN, which the gate logs as an invalid probability, never a verdict.
*/
export function doneUnbackedProbability(probabilities: readonly [number, number, number]): number {
  return probabilities[1] + probabilities[2]
}

export interface DoneInputs {
  readonly reply: string
  readonly tools: readonly string[]
}

/** The reply excerpt with the turn's tool results it claims. */
export function doneState(inputs: DoneInputs): string {
  return [boundEvidence(inputs.reply), joinEvidence(inputs.tools)].join('\n')
}

export interface DoneSlots {
  readonly reply: string
  readonly tools: string
}

export interface DoneDecision {
  readonly inputs: DoneInputs
  /** The unbacked event's raw p(yes): doneUnbackedProbability of the choice answer. */
  readonly rawProbability: number
  readonly engine: AccuracyEngine
  readonly profiles: readonly CommittedCalibrationProfile[]
  readonly limits: CalibrationLimits
}

export function decideDone(decision: DoneDecision): AccuracyOutput<DoneSlots> {
  return runAccuracyCheck({
    check: 'done.unbacked',
    rawProbability: decision.rawProbability,
    engine: decision.engine,
    profiles: decision.profiles,
    limits: decision.limits,
    slots: {
      reply: boundEvidence(decision.inputs.reply),
      tools: joinEvidence(decision.inputs.tools),
    },
  })
}
