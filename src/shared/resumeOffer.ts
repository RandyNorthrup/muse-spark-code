// M88 lane C (PLAN.md D67, item 16): fitting a limit's resume offer to
// the timed-send picker. Every default time is rounded up to the next
// whole minute and is never less than a minute ahead, so a Retry-After
// of a few seconds opens at one minute. A limit lifting more than six
// days out gets no timer: the row says when it lifts instead. Pure, so
// the panel, the host and the tests share the one fitting.
import {
  MILLISECONDS_PER_MINUTE,
  RESUME_OFFER_MAX_LIFT_MS,
  TIMED_SEND_MIN_LEAD_MS,
} from './constants'

/** Whole minutes up: the picker's granularity for timed sends. */
export function ceilToMinuteMs(atMs: number): number {
  if (!Number.isFinite(atMs)) throw new RangeError('resumeOffer.invalidInstant')
  return Math.ceil(atMs / MILLISECONDS_PER_MINUTE) * MILLISECONDS_PER_MINUTE
}

export type ResumeOffer =
  | { readonly kind: 'timer'; readonly defaultAtMs: number }
  | { readonly kind: 'liftsAt'; readonly liftsAtMs: number }

/**
The offer for a limit that lifts at `liftsAtMs` after a failure at
`failedAtMs`: a timer at the fitted default, or no timer with the lift
instant for the row when it lifts more than six days out.
*/
export function resumeOfferFor(failedAtMs: number, liftsAtMs: number): ResumeOffer {
  if (!Number.isFinite(failedAtMs) || !Number.isFinite(liftsAtMs) || liftsAtMs < 0) {
    throw new RangeError('resumeOffer.invalidInstant')
  }
  if (liftsAtMs - failedAtMs > RESUME_OFFER_MAX_LIFT_MS) return { kind: 'liftsAt', liftsAtMs }
  return {
    kind: 'timer',
    defaultAtMs: ceilToMinuteMs(Math.max(liftsAtMs, failedAtMs + TIMED_SEND_MIN_LEAD_MS)),
  }
}
