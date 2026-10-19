// Subscription usage (M8): the shape Muse Code reports through `usage/read`
// and `usage/changed` (the SDK's `SubscriptionUsage`), shared by the host,
// the webview protocol and the Account & usage dialog, plus the pure
// formatting the dialog needs. Percentages are the provider's verbatim
// integers and may exceed 100; times are epoch milliseconds. `observedAtMs`
// is when the CLI received the numbers, so the dialog says "as of", never
// implies live data.

import * as z from 'zod/mini'
import { legacyUsdSchema } from './usdSchema'
import {
  HOURS_PER_DAY,
  MILLISECONDS_PER_SECOND,
  MINUTES_PER_HOUR,
  MODEL_PRICINGS,
  SECONDS_PER_MINUTE,
  UI_TEXT,
} from './constants'
import {
  type DurationUnit,
  formatDateTime,
  formatDateTimeUtc,
  formatUnit,
  plural,
} from './l10n/text'

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

/** What drove the account's usage over a window (M14): model attempts by origin. */
export const usageInsightsSchema = z.object({
  attempts: z.number(),
  sessions: z.number(),
  reminderAttempts: z.number(),
  subagentAttempts: z.number(),
  longSessionAttempts: z.number(),
})
export type UsageInsights = z.infer<typeof usageInsightsSchema>

export const SIGN_IN_METHOD_FACTS = ['cli', 'apiKey', 'none'] as const

/** The Account section of the usage modal (M14). */
export const accountFactsSchema = z.object({
  signInMethod: z.enum(SIGN_IN_METHOD_FACTS),
  cliVersion: z.optional(z.string()),
  /** Muse Code's `run.subagent_delegation_mode`; absent on the Model API backend. */
  delegationMode: z.optional(z.string()),
  /** Muse Code's `run.workflow_trigger_mode` (M47); absent on the Model API backend. */
  workflowTriggerMode: z.optional(z.string()),
})
export type AccountFacts = z.infer<typeof accountFactsSchema>

/**
One BYO provider's row in Account & usage (M95, PLAN.md D74): this
window's tokens with their settled cost (absent while unpriced), and an
account-connected key's own usage, limit and remainder where the provider
reports them (OpenRouter's `/key`, in USD). The host fills it (lane I
tallies per reference); the dialog only renders it.
*/
export const providerUsageRowSchema = z.object({
  providerId: z.string(),
  providerLabel: z.string(),
  pricing: z.enum(MODEL_PRICINGS),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.optional(legacyUsdSchema),
  keyUsageError: z.optional(z.string()),
  keyUsage: z.optional(
    z.object({
      totalUsd: z.optional(legacyUsdSchema),
      unlimited: z.optional(z.boolean()),
      weekUsd: z.optional(legacyUsdSchema),
      todayUsd: legacyUsdSchema,
      monthUsd: legacyUsdSchema,
      limitUsd: z.optional(legacyUsdSchema),
      remainingUsd: z.optional(legacyUsdSchema),
    }),
  ),
})
export type ProviderUsageRow = z.infer<typeof providerUsageRowSchema>

// Lane S's non-secret tally contract, validated without loading the provider bundle.
const planCount = z.int().check(z.gte(0))
const planTokens = z.object({
  inputTokens: planCount,
  outputTokens: planCount,
  requests: planCount,
})
const planRow = z
  .object({
    requests: planCount,
    providerId: z.string().check(
      z.regex(/^[a-z][a-z0-9-]{0,31}$/),
      z.refine((id) => id !== 'meta'),
    ),
    estimated: planTokens,
    reported: planTokens,
  })
  .check(z.refine((row) => row.estimated.requests + row.reported.requests <= row.requests))
export const planUsageReportSchema = z
  .array(planRow)
  .check(z.refine((rows) => new Set(rows.map((row) => row.providerId)).size === rows.length))
export type PlanUsageRow = z.infer<typeof planRow>

export const FULL_PERCENT = 100
const MILLISECONDS_PER_MINUTE = MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE

/** The bar's fill: the percent clamped to the bar; the label keeps the real number. */
export function barValue(usedPercent: number): number {
  return Math.min(Math.max(usedPercent, 0), FULL_PERCENT)
}

/** A larger unit and, when it is not zero, the smaller one after it: "2h 5m", "3d". */
function unitPair(
  large: number,
  largeUnit: DurationUnit,
  small: number,
  smallUnit: DurationUnit,
): string {
  const head = formatUnit(large, largeUnit)
  return small > 0 ? `${head} ${formatUnit(small, smallUnit)}` : head
}

/**
"2h 5m", "3d 4h", "1m" in the display language's short units (PLAN.md
D33); its word for "now" once the moment has passed.
*/
export function formatDuration(untilMs: number, nowMs: number): string {
  if (untilMs <= nowMs) {
    return UI_TEXT.durationNow
  }
  const totalMinutes = Math.ceil((untilMs - nowMs) / MILLISECONDS_PER_MINUTE)
  const days = Math.floor(totalMinutes / (MINUTES_PER_HOUR * HOURS_PER_DAY))
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR) % HOURS_PER_DAY
  if (days > 0) {
    return unitPair(days, 'day', hours, 'hour')
  }
  const minutes = totalMinutes % MINUTES_PER_HOUR
  return hours > 0 ? unitPair(hours, 'hour', minutes, 'minute') : formatUnit(minutes, 'minute')
}

const OPAQUE_TIER = /^[\d-]+$/

/**
The plan line: the tier id verbatim when it reads as a name, or a generic
label when Meta sends an opaque numeric id (verified live 2026-09-22:
`tier: "27681393394859588"`).
*/
export function planLabel(tier: string): string {
  return tier === '' || OPAQUE_TIER.test(tier) ? UI_TEXT.usagePlanSubscription : tier
}

/**
 * Whose plan the spend rode on: the latest observed Muse Code meter's own
 * plan name. Undefined when no stored meter names one, and plan rows keep
 * their generic label then rather than guessing.
 */
export function planDisplayName(
  limits: readonly {
    readonly provider: string
    readonly observedAt: number
    readonly plan?: string | undefined
  }[],
): string | undefined {
  let latest: { readonly observedAt: number; readonly plan: string } | undefined
  for (const limit of limits) {
    if (limit.provider !== 'museCode' || limit.plan === undefined) continue
    if (latest === undefined || limit.observedAt >= latest.observedAt)
      latest = { observedAt: limit.observedAt, plan: limit.plan }
  }
  return latest === undefined ? undefined : planLabel(latest.plan)
}

/**
 * An hour bucket's label in the timezone its records were written in. The
 * bucket keeps its hour-start instant; shifting it back by the recorded
 * offset recovers the recorded-local wall clock, so a later timezone change
 * (or DST) cannot move the hour onto another day. Buckets without a
 * recorded offset (rollup months) keep the viewer's local rendering.
 */
export function bucketHourLabel(bucket: {
  readonly at: number
  readonly timezoneOffsetMins?: number | undefined
}): string {
  return bucket.timezoneOffsetMins === undefined
    ? formatDateTime(bucket.at)
    : formatDateTimeUtc(bucket.at - bucket.timezoneOffsetMins * MILLISECONDS_PER_MINUTE)
}

/** "5-hour window" / "90-minute window" from the provider's duration. */
export function formatWindowLength(windowDurationMins: number): string {
  return windowDurationMins % MINUTES_PER_HOUR === 0
    ? plural(UI_TEXT.usageWindowHours, windowDurationMins / MINUTES_PER_HOUR)
    : plural(UI_TEXT.usageWindowMinutes, windowDurationMins)
}
