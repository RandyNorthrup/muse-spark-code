// M95b: local, non-secret plan tallies. A dispatched attempt is one request,
// including a refused/failed stream; no price or dollar reservation is invented.
import * as z from 'zod/mini'
import { isProviderId } from '../modelRef'
import { planLimitWindowSchema, type PlanLimitWindow } from '../../../shared/usage'

const count = z.int().check(z.gte(0))
// OPENAI-G28: the plan's reported limit windows live in the shared row so
// the tally and the protocol carry the same shape. Percentages are stored
// as reported, unclamped.
const planLimitsSchema = z.object({
  observedAt: count,
  primary: z.optional(planLimitWindowSchema),
  secondary: z.optional(planLimitWindowSchema),
})
export type PlanLimits = z.infer<typeof planLimitsSchema>
const providerId = z.string().check(z.refine(isProviderId))
const totalsSchema = z.object({ requests: count, inputTokens: count, outputTokens: count })
const rowSchema = z
  .object({
    providerId,
    requests: count,
    reported: totalsSchema,
    estimated: totalsSchema,
    limits: z.optional(planLimitsSchema),
  })
  .check(z.refine((row) => row.reported.requests + row.estimated.requests <= row.requests))

/** The host persists this non-secret payload in its existing usage store. */
export const planUsageSchema = z
  .array(rowSchema)
  .check(z.refine((rows) => new Set(rows.map((row) => row.providerId)).size === rows.length))
export type PlanUsageRow = z.infer<typeof rowSchema>

const attemptSchema = z.object({
  providerId,
  tokens: z.optional(
    z.object({
      inputTokens: count,
      outputTokens: count,
      source: z.enum(['reported', 'estimated']),
    }),
  ),
  limits: z.optional(planLimitsSchema),
})
export type PlanUsageAttempt = z.infer<typeof attemptSchema>

/**
Read one plan limit window out of allow-listed response headers. Header
names are matched case-insensitively; a missing or non-numeric header
leaves its field absent, never zero.
*/
export function parsePlanLimitHeaders(
  headers: Readonly<Record<string, string>>,
  observedAt: number,
): PlanLimits | undefined {
  const lowered: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) lowered[name.toLowerCase()] = value
  const number = (name: string): number | undefined => {
    const value = Number(lowered[name])
    return Number.isFinite(value) && value >= 0 ? value : undefined
  }
  const integer = (name: string): number | undefined => {
    const value = number(name)
    return value === undefined ? undefined : Math.floor(value)
  }
  const window = (prefix: string): PlanLimitWindow | undefined => {
    const usedPercent = number(`${prefix}-used-percent`)
    if (usedPercent === undefined) return undefined
    return {
      usedPercent,
      ...(number(`${prefix}-window-minutes`) !== undefined && {
        windowMins: number(`${prefix}-window-minutes`),
      }),
      ...(integer(`${prefix}-reset-after-seconds`) !== undefined && {
        resetAfterSecs: integer(`${prefix}-reset-after-seconds`),
      }),
    }
  }
  const primary = window('x-codex-primary')
  const secondary = window('x-codex-secondary')
  if (primary === undefined && secondary === undefined) return undefined
  return {
    observedAt,
    ...(primary !== undefined && { primary }),
    ...(secondary !== undefined && { secondary }),
  }
}

/** Return new tallies after one dispatch; missing usage remains unknown. */
export function recordPlanUsage(
  rows: readonly PlanUsageRow[],
  attempt: PlanUsageAttempt,
): PlanUsageRow[] {
  const checked = planUsageSchema.safeParse(rows)
  const parsedAttempt = attemptSchema.safeParse(attempt)
  if (!checked.success || !parsedAttempt.success) throw new Error('plan-usage.invalid-tally')
  const { providerId: id, tokens, limits } = parsedAttempt.data
  const existing = checked.data.find((row) => row.providerId === id)
  const updated: PlanUsageRow = existing ?? {
    providerId: id,
    requests: 0,
    reported: { requests: 0, inputTokens: 0, outputTokens: 0 },
    estimated: { requests: 0, inputTokens: 0, outputTokens: 0 },
  }
  updated.requests += 1
  // The latest successful response's windows replace the stored ones; an
  // attempt with no headers (a refusal, a failed stream) keeps them.
  if (limits !== undefined) updated.limits = limits
  if (tokens !== undefined) {
    const tally = updated[tokens.source]
    tally.requests += 1
    tally.inputTokens += tokens.inputTokens
    tally.outputTokens += tokens.outputTokens
  }
  const result = [...checked.data.filter((row) => row.providerId !== id), updated].toSorted(
    (a, b) => a.providerId.localeCompare(b.providerId, 'en'),
  )
  const valid = planUsageSchema.safeParse(result)
  if (!valid.success) throw new Error('plan-usage.invalid-tally')
  return valid.data
}
