import { calibrationProbability } from './fit'
import {
  calibrationFailure,
  calibrationPartitions,
  parseCalibrationDataset,
  parseCalibrationProfile,
  isSameCalibrationIdentity,
  type CalibrationFailure,
  type CalibrationLimits,
  type CalibrationProfile,
  type CalibrationSample,
} from './schema'

type Metrics = NonNullable<CalibrationProfile['evaluation']>['calibrated']

function metrics(
  rows: readonly CalibrationSample[],
  probabilities: readonly number[],
  binCount: number,
): Metrics {
  const bins = Array.from({ length: binCount }, () => ({ count: 0, sum: 0, labels: 0 }))
  let brier = 0
  for (const [index, row] of rows.entries()) {
    const p = probabilities[index]
    if (p === undefined || !Number.isFinite(p) || p < 0 || p > 1)
      throw new RangeError('invalid-probability')
    brier += (p - row.label) ** 2
    const bin = bins[Math.min(binCount - 1, Math.floor(p * binCount))]
    if (bin === undefined) throw new RangeError('invalid-limits')
    bin.count += 1
    bin.sum += p
    bin.labels += row.label
  }
  const ece = bins.reduce((sum, bin) => sum + Math.abs(bin.sum - bin.labels), 0) / rows.length
  return { sampleCount: rows.length, brier: brier / rows.length, ece }
}

export interface CalibrationReport {
  readonly identity: CalibrationProfile['identity']
  readonly method: CalibrationProfile['fit']['method']
  readonly sampleCounts: {
    readonly fit: number
    readonly tuning: number
    readonly evaluation: number
  }
  readonly evaluation: NonNullable<CalibrationProfile['evaluation']>
  readonly activationEligible: boolean
}

/** Machine-readable report; G/FP render reason codes and labels through P0's text. */
export function reportCalibration(
  profileInput: unknown,
  datasetInput: unknown,
  bins: number,
  limits: CalibrationLimits,
):
  | CalibrationFailure
  | {
      readonly status: 'reported'
      readonly report: CalibrationReport
      readonly profile: CalibrationProfile
    } {
  const parsed = parseCalibrationDataset(datasetInput, limits)
  if (parsed.status !== 'valid') return parsed
  if (!Number.isSafeInteger(bins) || bins < 1 || bins > limits.maxBins)
    return calibrationFailure('invalid-limits')
  const profile = parseCalibrationProfile(profileInput, limits)
  if (profile === undefined) return calibrationFailure('invalid-profile')
  const { dataset } = parsed
  if (
    !isSameCalibrationIdentity(profile.identity, dataset.identity) ||
    profile.evidence !== dataset.evidence
  ) {
    return calibrationFailure('profile-mismatch')
  }
  if (
    JSON.stringify(profile.partitions) !== JSON.stringify(calibrationPartitions(dataset.samples))
  ) {
    return calibrationFailure('partition-mismatch')
  }
  const rows = dataset.samples.filter((row) => row.split === 'evaluation')
  const evaluation: NonNullable<CalibrationProfile['evaluation']> = {
    evidence: dataset.evidence,
    bins,
    uncalibrated: metrics(
      rows,
      rows.map((row) => row.probability),
      bins,
    ),
    calibrated: metrics(
      rows,
      rows.map((row) => calibrationProbability(profile, row.probability)),
      bins,
    ),
  }
  return {
    status: 'reported',
    report: {
      identity: profile.identity,
      method: profile.fit.method,
      sampleCounts: {
        fit: profile.partitions.fit.ids.length,
        tuning: profile.partitions.tuning.ids.length,
        evaluation: rows.length,
      },
      evaluation,
      activationEligible: dataset.evidence === 'independent',
    },
    profile: { ...profile, evaluation },
  }
}
