// One clock type for every stored time (M102 usage journal, ledgers,
// session files, reports): whole milliseconds since the epoch. A monotonic
// reading (performance.now) is a different scale and can never be handed
// where EpochMs is wanted: the compiler refuses a bare () => number.
declare const epochMsBrand: unique symbol

/** Whole milliseconds since the epoch, as the journal schema stores them. */
export type EpochMs = number & { readonly [epochMsBrand]: 'EpochMs' }

/**
 * The single constructor: a fractional input is rounded once, here, so a
 * timestamp the headless clock built can never fail the journal's integer
 * schema. Whole inputs pass through unchanged.
 */
export function toEpochMs(value: number): EpochMs {
  // Reason for the cast: this constructor is the one place the EpochMs brand
  // is created; Math.round already guarantees a whole number, which the
  // compiler cannot verify, so the brand is attached here and never elsewhere.
  return Math.round(value) as EpochMs
}

/** The epoch wall clock in the stored shape: Date.now, already whole. */
export function epochNow(): EpochMs {
  return toEpochMs(Date.now())
}
