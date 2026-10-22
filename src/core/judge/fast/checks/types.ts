// M125 lane K (D107): the accuracy checks' shared shapes. A check judges
// one binary event (its family) for one engine: at or above its precision
// bar the verdict shows through its channels; below it, or with no
// profile, the verdict is a log record that carries no judged content.
import type { CalibrationTier } from '../../calibration/profiles'
import type { CalibrationReason } from '../../calibration/schema'
import type { FastDecisionId } from '../classes'

/**
The six accuracy checks (§7.1–§7.6). Each id is its calibration family:
the suite guards the mirror against the fast contract's decision ids,
so the two lists cannot drift apart.
*/
export const ACCURACY_CHECKS = [
  'risk.destructive',
  'edit.misfit',
  'failure.unmentioned',
  'done.unbacked',
  'scope.outside',
  'claim.inconsistent',
] as const satisfies readonly FastDecisionId[]
export type AccuracyCheckId = (typeof ACCURACY_CHECKS)[number]

/**
Where a shown verdict goes. Hints render at the tail only (lanes M/C);
caution is a latch bit that can only add a card or a hold, never an
allow.
*/
export interface AccuracyChannels {
  readonly hint: boolean
  readonly note: boolean
  readonly caution: boolean
}

/** The engine that answered, as the profile selector matches it. */
export interface AccuracyEngine {
  readonly providerId: string
  readonly model: string
  readonly endpoint: string
  readonly technique: string
}

export type AccuracyLogReason = 'profile-missing' | 'below-bar' | CalibrationReason

/**
What a below-bar or profileless verdict leaves behind: the check, the
engine, the bar and the reason — never the command, reply, excerpt or
paths that were judged.
*/
export interface AccuracyLogRecord {
  readonly check: AccuracyCheckId
  readonly engine: AccuracyEngine
  readonly tier?: CalibrationTier | undefined
  /** The calibrated p(yes), when a profile applied. */
  readonly probability?: number | undefined
  readonly bar: number
  readonly reason: AccuracyLogReason
}

export interface AccuracyShown<Slots> {
  readonly kind: 'shown'
  readonly check: AccuracyCheckId
  readonly engine: AccuracyEngine
  /** The calibrated p(yes) that met the bar. */
  readonly probability: number
  readonly tier: CalibrationTier
  readonly channels: AccuracyChannels
  readonly slots: Slots
}

export interface AccuracyLogOnly {
  readonly kind: 'log-only'
  readonly record: AccuracyLogRecord
}

export type AccuracyOutput<Slots> = AccuracyShown<Slots> | AccuracyLogOnly
