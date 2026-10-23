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
      readonly label: 'calibrated (logprob)' | 'calibrated (stated)'
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
    label: identity.technique === 'logprob' ? 'calibrated (logprob)' : 'calibrated (stated)',
    combinationWeight: profile.combinationWeight,
  }
}
