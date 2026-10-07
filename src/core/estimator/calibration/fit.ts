import * as z from 'zod/mini'
import { ESTIMATE_CALIBRATION_MIN_SAMPLES } from '../../../shared/constants'
import {
  historyRecordSchema,
  type EstimateLane,
  type EstimateSection,
  type HistoryRecord,
} from '../../../shared/estimate'
import { UI_TEXT } from '../../../shared/l10n/text'
import { calibrationFailure, canonicalHistory } from './records'
import { calibrationPrior } from './prior'

type Quantity = EstimateLane['resources']['ciMinutes']
type KnownQuantity = Extract<Quantity, { status: 'known' }>
type ParameterEvidence = Pick<KnownQuantity, 'basis' | 'samples' | 'uncertainty'>

export interface CalibrationFit {
  readonly calibration: EstimateSection['calibration'][number]
  readonly durationBasis: HistoryRecord['durationBasis']
  /** Counts of independent lanes available for each fit, not findings or module sums. */
  readonly reviewSamples: number
  readonly redesignSamples: number
  readonly evidence: {
    readonly durationParameters: ParameterEvidence
    readonly reviewRoundRate: KnownQuantity
    readonly redesignRisk: KnownQuantity
    readonly ciHours: Quantity
  }
}

function known(value: number, basis: KnownQuantity['basis'], samples: number): KnownQuantity {
  return { status: 'known', value, basis, samples, uncertainty: { kind: 'unknown' } }
}

/** One metadata observation per lane even when board and git both measured it. */
function metadataOf(records: readonly HistoryRecord[]): HistoryRecord[] {
  const lanes = new Map<string, HistoryRecord>()
  for (const record of records) {
    const previous = lanes.get(record.laneId)
    if (!previous) {
      lanes.set(record.laneId, record)
      continue
    }
    if (
      previous.review.status === 'known' &&
      record.review.status === 'known' &&
      JSON.stringify(previous.review) !== JSON.stringify(record.review)
    )
      throw calibrationFailure('conflictingReviewHistory')
    if (
      previous.ciHours !== undefined &&
      record.ciHours !== undefined &&
      previous.ciHours !== record.ciHours
    )
      throw calibrationFailure('conflictingCiHistory')
    lanes.set(record.laneId, {
      ...previous,
      review: previous.review.status === 'unknown' ? record.review : previous.review,
      ...(previous.ciHours === undefined &&
        record.ciHours !== undefined && { ciHours: record.ciHours }),
    })
  }
  return Array.from(lanes, ([, record]) => record)
}

/** Lognormal ratios by exact kind/class and duration basis. No clock or random sampling. */
export function fitCalibration(
  values: readonly HistoryRecord[],
  kind: string,
  machineClassId: string,
  asOf: string,
  durationBasis: HistoryRecord['durationBasis'] = 'agentTime',
): CalibrationFit {
  if (
    !z.iso.datetime().safeParse(asOf).success ||
    !historyRecordSchema.shape.kind.safeParse(kind).success ||
    !historyRecordSchema.shape.machineClassId.safeParse(machineClassId).success ||
    !historyRecordSchema.shape.durationBasis.safeParse(durationBasis).success
  )
    throw calibrationFailure('invalidCalibrationQuery')
  const records = canonicalHistory(values).filter(
    (record) =>
      record.kind === kind &&
      record.machineClassId === machineClassId &&
      Date.parse(record.finishedAt) <= Date.parse(asOf),
  )
  const durations = records.filter(
    (record) => record.durationBasis === durationBasis && record.actualHours > 0,
  )
  const prior = calibrationPrior()
  const isFitted = durations.length >= ESTIMATE_CALIBRATION_MIN_SAMPLES
  let mu = prior.mu
  let sigma = prior.sigma
  if (isFitted) {
    // Welford variance avoids cancellation; log differences avoid ratio overflow/underflow.
    let mean = 0
    let squaredDeviations = 0
    let count = 0
    for (const record of durations) {
      const logRatio = Math.log(record.actualHours) - Math.log(record.estimatedHours)
      const delta = logRatio - mean
      mean += delta / ++count
      squaredDeviations += delta * (logRatio - mean)
    }
    mu = mean
    // An exact constant sample still has a positive sigma under the frozen schema.
    sigma = Math.max(Number.EPSILON, Math.sqrt(squaredDeviations / durations.length))
  }
  const metadata = metadataOf(records)
  const reviews = metadata.flatMap((record) =>
    record.review.status === 'known' && record.review.rounds > 0 ? [record.review] : [],
  )
  const isReviewFitted = reviews.length >= ESTIMATE_CALIBRATION_MIN_SAMPLES
  const roundCount = reviews.reduce((total, review) => total + review.rounds, 0)
  const continuationCount = reviews.reduce((total, review) => total + review.rounds - 1, 0)
  const reviewRoundRate = isReviewFitted ? continuationCount / roundCount : prior.reviewRoundRate
  const risks = metadata.flatMap((record) => {
    if (record.review.status === 'unknown') return []
    const review = record.review
    const exposed = review.modules.filter(
      (module) =>
        module.strikes >= 2 ||
        review.redesigns.some((event) => event.moduleFamilyId === module.familyId),
    )
    return exposed.length === 0
      ? []
      : [
          {
            exposures: exposed.length,
            redesigns: exposed.filter((module) =>
              review.redesigns.some((event) => event.moduleFamilyId === module.familyId),
            ).length,
          },
        ]
  })
  const isRiskFitted = risks.length >= ESTIMATE_CALIBRATION_MIN_SAMPLES
  const redesignRisk = isRiskFitted
    ? risks.reduce((total, risk) => total + risk.redesigns, 0) /
      risks.reduce((total, risk) => total + risk.exposures, 0)
    : prior.redesignRisk
  const ci = metadata.flatMap((record) => (record.ciHours === undefined ? [] : [record.ciHours]))
  return {
    calibration: {
      kind,
      machineClassId,
      samples: durations.length,
      basis: isFitted ? 'fitted' : 'uncalibratedPrior',
      mu,
      sigma,
      reviewRoundRate,
      redesignRisk,
    },
    durationBasis,
    reviewSamples: reviews.length,
    redesignSamples: risks.length,
    evidence: {
      durationParameters: {
        basis: isFitted ? 'calibration' : 'assumption',
        samples: isFitted ? durations.length : 0,
        uncertainty: { kind: 'unknown' },
      },
      reviewRoundRate: known(
        reviewRoundRate,
        isReviewFitted ? 'calibration' : 'assumption',
        isReviewFitted ? reviews.length : 0,
      ),
      redesignRisk: known(
        redesignRisk,
        isRiskFitted ? 'calibration' : 'assumption',
        isRiskFitted ? risks.length : 0,
      ),
      ciHours:
        ci.length === 0
          ? {
              status: 'unknown',
              value: null,
              basis: 'unknown',
              samples: 0,
              uncertainty: { kind: 'unknown' },
            }
          : known(
              ci.reduce((mean, hours, index) => mean + (hours - mean) / (index + 1), 0),
              'history',
              ci.length,
            ),
    },
  }
}

/** Read at render time so changing the installed language changes the label. */
export function calibrationLabel(fit: CalibrationFit): string {
  return fit.calibration.basis === 'fitted' ? UI_TEXT.estimateFitted : UI_TEXT.estimatePrior
}

/** Risk applies only to currently unresolved families with two strikes; unknown is not zero. */
export function laneRedesignRisk(fit: CalibrationFit, value: EstimateLane['review']): Quantity {
  const parsed = historyRecordSchema.shape.review.safeParse(value)
  if (!parsed.success) throw calibrationFailure('invalidReviewState')
  if (parsed.data.status === 'unknown')
    return {
      status: 'unknown',
      value: null,
      basis: 'unknown',
      samples: 0,
      uncertainty: { kind: 'unknown' },
    }
  const families = parsed.data.modules.filter((module) => module.strikes >= 2).length
  return families === 0
    ? { ...known(0, 'assumption', 0), uncertainty: { kind: 'interval', lower: 0, upper: 0 } }
    : { ...fit.evidence.redesignRisk, value: 1 - (1 - fit.calibration.redesignRisk) ** families }
}
