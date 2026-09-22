// Subscription usage (M8): the shape Muse Code reports through `usage/read`
// and `usage/changed` (the SDK's `SubscriptionUsage`), shared by the host,
// the webview protocol and the Account & usage dialog, plus the pure
// formatting the dialog needs. Percentages are the provider's verbatim
// integers and may exceed 100; times are epoch milliseconds. `observedAtMs`
// is when the CLI received the numbers, so the dialog says "as of", never
// implies live data.

import * as z from 'zod/mini'
import {
  HOURS_PER_DAY,
  MILLISECONDS_PER_SECOND,
  MINUTES_PER_HOUR,
  SECONDS_PER_MINUTE,
} from './constants'

export const subscriptionUsageSchema = z.object({
  observedAtMs: z.number(),
  tier: z.string(),
  window: z.object({
    usedPercent: z.number(),
    resetsAtMs: z.number(),
    windowDurationMins: z.number(),
  }),
  weekly: z.object({ usedPercent: z.number(), resetsAtMs: z.number() }),
})
export type SubscriptionUsage = z.infer<typeof subscriptionUsageSchema>

/** `usage/read` result: `{ usage? }`, the member absent when nothing was observed. */
export const usageReadResultSchema = z.object({ usage: z.optional(subscriptionUsageSchema) })

export const FULL_PERCENT = 100
const MILLISECONDS_PER_MINUTE = MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE

/** The bar's fill: the percent clamped to the bar; the label keeps the real number. */
export function barValue(usedPercent: number): number {
  return Math.min(Math.max(usedPercent, 0), FULL_PERCENT)
}

/** "2 h 5 min", "3 d 4 h", "1 min"; "now" once the moment has passed. */
export function formatDuration(untilMs: number, nowMs: number): string {
  if (untilMs <= nowMs) {
    return 'now'
  }
  const totalMinutes = Math.ceil((untilMs - nowMs) / MILLISECONDS_PER_MINUTE)
  const days = Math.floor(totalMinutes / (MINUTES_PER_HOUR * HOURS_PER_DAY))
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR) % HOURS_PER_DAY
  if (days > 0) {
    return hours > 0 ? `${String(days)} d ${String(hours)} h` : `${String(days)} d`
  }
  const minutes = totalMinutes % MINUTES_PER_HOUR
  if (hours > 0) {
    return minutes > 0 ? `${String(hours)} h ${String(minutes)} min` : `${String(hours)} h`
  }
  return `${String(minutes)} min`
}

const OPAQUE_TIER = /^[\d-]+$/
const SUBSCRIPTION_PLAN = 'Muse Code subscription'

/**
 * The plan line: the tier id verbatim when it reads as a name, or a generic
 * label when Meta sends an opaque numeric id (verified live 2026-09-22:
 * `tier: "27681393394859588"`).
 */
export function planLabel(tier: string): string {
  return tier === '' || OPAQUE_TIER.test(tier) ? SUBSCRIPTION_PLAN : tier
}

/** "5-hour window" / "90-minute window" from the provider's duration. */
export function formatWindowLength(windowDurationMins: number): string {
  return windowDurationMins % MINUTES_PER_HOUR === 0
    ? `${String(windowDurationMins / MINUTES_PER_HOUR)}-hour window`
    : `${String(windowDurationMins)}-minute window`
}
