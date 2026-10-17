// M95b: local, non-secret plan tallies. A dispatched attempt is one request,
// including a refused/failed stream; no price or dollar reservation is invented.
import * as z from 'zod/mini'
import { isProviderId } from '../modelRef'

const count = z.int().check(z.gte(0))
const providerId = z.string().check(z.refine(isProviderId))
const totalsSchema = z.object({ requests: count, inputTokens: count, outputTokens: count })
const rowSchema = z
  .object({
    providerId,
    requests: count,
    reported: totalsSchema,
    estimated: totalsSchema,
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
})
export type PlanUsageAttempt = z.infer<typeof attemptSchema>

/** Return new tallies after one dispatch; missing usage remains unknown. */
export function recordPlanUsage(
  rows: readonly PlanUsageRow[],
  attempt: PlanUsageAttempt,
): PlanUsageRow[] {
  const checked = planUsageSchema.safeParse(rows)
  const parsedAttempt = attemptSchema.safeParse(attempt)
  if (!checked.success || !parsedAttempt.success) throw new Error('plan-usage.invalid-tally')
  const { providerId: id, tokens } = parsedAttempt.data
  const existing = checked.data.find((row) => row.providerId === id)
  const updated = existing ?? {
    providerId: id,
    requests: 0,
    reported: { requests: 0, inputTokens: 0, outputTokens: 0 },
    estimated: { requests: 0, inputTokens: 0, outputTokens: 0 },
  }
  updated.requests += 1
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
