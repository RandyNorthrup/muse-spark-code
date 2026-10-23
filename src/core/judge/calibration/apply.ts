import { calibrationProbability } from './fit'
import {
  calibrationFailure,
  identityReason,
  parseCalibrationProfile,
  isSameCalibrationIdentity,
  type CalibrationFailure,
  type CalibrationIdentity,
  type CalibrationLimits,
} from './schema'

/** The runtime label per technique; identity validation runs before any label is read. */
const CALIBRATED_LABELS: Readonly<
  Record<string, 'calibrated (logprob)' | 'calibrated (stated)' | 'calibrated (systemone)'>
> = {
  logprob: 'calibrated (logprob)',
  stated: 'calibrated (stated)',
  systemone: 'calibrated (systemone)',
}

/** Runtime output stays uncalibrated until independent evaluation is present. */
export function applyCalibration(
  profileInput: unknown,
  identity: CalibrationIdentity,
  probability: number,
  isPartial: boolean,
  limits: CalibrationLimits,
):
  | CalibrationFailure
  | {
      readonly status: 'calibrated'
      readonly probability: number
      readonly label: 'calibrated (logprob)' | 'calibrated (stated)' | 'calibrated (systemone)'
      readonly combinationWeight: number
    } {
  const reason = identityReason(identity)
  if (reason !== undefined) return calibrationFailure(reason)
  if (isPartial) return calibrationFailure('partial-result')
  if (!Number.isFinite(probability) || probability < 0 || probability > 1)
    return calibrationFailure('invalid-probability')
  const profile = parseCalibrationProfile(profileInput, limits)
  if (profile === undefined) return calibrationFailure('invalid-profile')
  if (!isSameCalibrationIdentity(profile.identity, identity))
    return calibrationFailure('profile-mismatch')
  if (profile.evaluation?.evidence !== 'independent')
    return calibrationFailure('independent-evaluation-required')
  return {
    status: 'calibrated',
    probability: calibrationProbability(profile, probability),
    label: CALIBRATED_LABELS[identity.technique] ?? 'calibrated (stated)',
    combinationWeight: profile.combinationWeight,
  }
}
