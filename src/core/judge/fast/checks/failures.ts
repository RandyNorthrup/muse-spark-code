// M125 lane K (D107 §7.3): do the test or build results show a failure
// the reply does not mention. The deterministic part (lane R) runs first;
// this check judges the model question over the outputs' head and tail
// and the reply. A note under the reply and a hint at the next turn's
// input tail. Bar: precision ≥ 0.9, recall ≥ 0.9.
import type { CommittedCalibrationProfile } from '../../calibration/profiles'
import type { CalibrationLimits } from '../../calibration/schema'
import { boundEvidence, headTailEvidence } from './evidence'
import { runAccuracyCheck } from './gate'
import type { AccuracyEngine, AccuracyOutput } from './types'

/**
Tool outputs' color codes. Count lines carry SGR sequences between
their own words ("Tests <red>17 failed"), so the parser reads
through them; anything else stays byte for byte.
*/
const ESCAPE = '\u{1B}'
const SGR_PATTERN = new RegExp(`${ESCAPE}[[][0-9;]*m`, 'gu')

/**
Failure-count lines, in the order they win. Vitest's failing-test
header names the count first; a summary line ("Tests 17 failed")
confirms it. A bare number elsewhere — an error code like TS2322 —
is never a count.
*/
const FAILURE_COUNT_PATTERNS: readonly RegExp[] = [/Failed Tests (\d+)/, /Tests?\s+(\d+) failed\b/]

/** The reported failure count, or undefined when no count line names one. */
export function parseFailureCount(output: string): number | undefined {
  const plain = output.replaceAll(SGR_PATTERN, '')
  for (const pattern of FAILURE_COUNT_PATTERNS) {
    const match = pattern.exec(plain)
    const count = match?.[1] === undefined ? undefined : Number(match[1])
    if (count !== undefined && Number.isSafeInteger(count)) return count
  }
  return undefined
}

export interface FailuresInputs {
  readonly output: string
  readonly reply: string
  /** Lane R's marker for the recognised failure the reply leaves out. */
  readonly marker: string
}

/** The outputs' head and tail with the reply they are judged against. */
export function failuresState(inputs: FailuresInputs): string {
  return [headTailEvidence(inputs.output), boundEvidence(inputs.reply)].join('\n')
}

export interface FailuresSlots {
  readonly count?: number | undefined
  readonly marker: string
}

export interface FailuresDecision {
  readonly inputs: FailuresInputs
  readonly rawProbability: number
  readonly engine: AccuracyEngine
  readonly profiles: readonly CommittedCalibrationProfile[]
  readonly limits: CalibrationLimits
}

export function decideFailures(decision: FailuresDecision): AccuracyOutput<FailuresSlots> {
  return runAccuracyCheck({
    check: 'failure.unmentioned',
    rawProbability: decision.rawProbability,
    engine: decision.engine,
    profiles: decision.profiles,
    limits: decision.limits,
    slots: {
      count: parseFailureCount(decision.inputs.output),
      marker: boundEvidence(decision.inputs.marker),
    },
  })
}
