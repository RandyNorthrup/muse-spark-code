// Clock checks (M110f lane O, D90.19): the node's clock against a
// reference the person trusts. Past their warning skew the node says so,
// and past their refusal skew time codes stop verifying. The reference
// reading arrives from the person's own check; without one, this core has
// nothing to judge and says so.
import * as z from 'zod/mini'

export const clockReadingSchema = z.strictObject({
  systemMs: z.int(),
  referenceMs: z.optional(z.int()),
  warnAfterMs: z.int().check(z.gte(0)),
  refuseAfterMs: z.optional(z.int().check(z.gte(0))),
})
export type ClockReading = z.infer<typeof clockReadingSchema>

export interface ClockVerdict {
  readonly skewMs: number | undefined
  readonly isSkewed: boolean
  readonly isTotpRefused: boolean
  readonly reason: string | undefined
}

/* Judge the skew, or say there is no reference to judge it by. */
export function checkNodeClock(reading: ClockReading): ClockVerdict {
  const parsed = clockReadingSchema.parse(reading)
  if (parsed.referenceMs === undefined)
    return {
      skewMs: undefined,
      isSkewed: false,
      isTotpRefused: false,
      reason: 'no reference clock',
    }
  const skewMs = Math.abs(parsed.systemMs - parsed.referenceMs)
  const isSkewed = skewMs >= parsed.warnAfterMs
  const isTotpRefused = parsed.refuseAfterMs !== undefined && skewMs >= parsed.refuseAfterMs
  if (!isSkewed) return { skewMs, isSkewed, isTotpRefused, reason: undefined }
  return {
    skewMs,
    isSkewed,
    isTotpRefused,
    reason: isTotpRefused
      ? 'the clock is skewed past refusal, time codes stop'
      : 'the clock is skewed, time codes are suspect',
  }
}
