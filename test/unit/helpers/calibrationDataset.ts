// The calibration suites' limits and the committed grouped-risk
// dataset (test/fixtures/judge/calibration/grouped-risk.json, M125
// lane L), shared by the calibration and accuracy-check suites.
import { readFileSync } from 'node:fs'
import {
  parseCalibrationDataset,
  type CalibrationDataset,
  type CalibrationLimits,
} from '../../../src/core/judge/calibration/schema'

export const limits: CalibrationLimits = {
  maxSamples: 2000,
  maxIdentifierLength: 256,
  maxBins: 20,
  isotonicMinimumLabels: 200,
  probabilityEpsilon: 1e-6,
  maxIterations: 100,
  convergenceTolerance: 1e-8,
  regularization: 1e-6,
  weightFloor: 1e-6,
}

/** The grouped-risk dataset under `limits`, parsed fresh on every call. */
export function groupedRiskDataset(): CalibrationDataset {
  const raw: unknown = JSON.parse(
    readFileSync(
      new URL('../../fixtures/judge/calibration/grouped-risk.json', import.meta.url),
      'utf8',
    ),
  )
  const parsed = parseCalibrationDataset(raw, limits)
  if (parsed.status !== 'valid') throw new Error(parsed.reason)
  return parsed.dataset
}
