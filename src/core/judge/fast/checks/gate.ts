// M125 lane K (D107): the accuracy gate. One rule for all six checks:
// the engine's raw p(yes) is calibrated through lane L's fitted profile
// for the engine's identity, and the verdict shows only at or above the
// family's precision bar. The bar is a design constant; the per-engine
// threshold is the fitted mapping itself, never a hardcoded table: the
// same 0.9 bar admits different raw scores per engine. Anything else —
// no profile, an uncalibrated answer, below the bar — is a log record
// without content, never a shown verdict. Pure and synchronous.
import { applyCalibration } from '../../calibration/apply'
import {
  selectCalibrationProfile,
  type CalibrationQuery,
  type CommittedCalibrationProfile,
} from '../../calibration/profiles'
import type { CalibrationLimits } from '../../calibration/schema'
import {
  JUDGE_FAST_DESTRUCTIVE_MIN_PRECISION,
  JUDGE_FAST_HINT_MIN_PRECISION,
} from '../../../../shared/constants'
import type { AccuracyChannels, AccuracyCheckId, AccuracyEngine, AccuracyOutput } from './types'

/** The precision bar per check (§7.1–§7.6). */
export const CHECK_PRECISION_BAR: Readonly<Record<AccuracyCheckId, number>> = {
  'risk.destructive': JUDGE_FAST_DESTRUCTIVE_MIN_PRECISION,
  'edit.misfit': JUDGE_FAST_HINT_MIN_PRECISION,
  'failure.unmentioned': JUDGE_FAST_HINT_MIN_PRECISION,
  'done.unbacked': JUDGE_FAST_HINT_MIN_PRECISION,
  'scope.outside': JUDGE_FAST_HINT_MIN_PRECISION,
  'claim.inconsistent': JUDGE_FAST_HINT_MIN_PRECISION,
}

/**
Where each check's shown verdict goes (§7.1–§7.6). The 7.3 hint lands
at the next turn's input tail like every other hint; the destructive
caution is a latch bit only.
*/
export const ACCURACY_CHANNELS: Readonly<Record<AccuracyCheckId, AccuracyChannels>> = {
  'risk.destructive': { hint: false, note: true, caution: true },
  'edit.misfit': { hint: true, note: false, caution: false },
  'failure.unmentioned': { hint: true, note: true, caution: false },
  'done.unbacked': { hint: false, note: true, caution: false },
  'scope.outside': { hint: true, note: true, caution: false },
  'claim.inconsistent': { hint: false, note: true, caution: false },
}

export interface AccuracyCheckInput<Slots> {
  readonly check: AccuracyCheckId
  readonly rawProbability: number
  readonly engine: AccuracyEngine
  readonly profiles: readonly CommittedCalibrationProfile[]
  readonly limits: CalibrationLimits
  readonly slots: Slots
}

/**
Calibrate the engine's raw p(yes) through its fitted profile and show
the verdict at or above the check's bar. A family with no profile for
the query stays off with its own profile-missing; a profile that
cannot apply (synthetic evidence, a mismatch, a bad probability)
reports 2b's reason; below the bar the verdict is log-only.
*/
export function runAccuracyCheck<Slots>(input: AccuracyCheckInput<Slots>): AccuracyOutput<Slots> {
  const bar = CHECK_PRECISION_BAR[input.check]
  const query: CalibrationQuery = {
    technique: input.engine.technique,
    family: input.check,
    providerId: input.engine.providerId,
    model: input.engine.model,
    endpoint: input.engine.endpoint,
  }
  const selection = selectCalibrationProfile(input.profiles, query)
  if (selection === undefined) {
    return {
      kind: 'log-only',
      record: { check: input.check, engine: input.engine, bar, reason: 'profile-missing' },
    }
  }
  const applied = applyCalibration(
    selection.committed.profile,
    selection.committed.profile.identity,
    input.rawProbability,
    false,
    input.limits,
  )
  if (applied.status !== 'calibrated') {
    return {
      kind: 'log-only',
      record: {
        check: input.check,
        engine: input.engine,
        tier: selection.tier,
        bar,
        reason: applied.reason,
      },
    }
  }
  if (applied.probability < bar) {
    return {
      kind: 'log-only',
      record: {
        check: input.check,
        engine: input.engine,
        tier: selection.tier,
        probability: applied.probability,
        bar,
        reason: 'below-bar',
      },
    }
  }
  return {
    kind: 'shown',
    check: input.check,
    engine: input.engine,
    probability: applied.probability,
    tier: selection.tier,
    channels: ACCURACY_CHANNELS[input.check],
    slots: input.slots,
  }
}
