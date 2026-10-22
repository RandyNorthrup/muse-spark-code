// M117: normalized owner facts, never provider wire shapes or display text.
import * as z from 'zod/mini'
import { compareUsdAmounts, nonnegativeUsdSchema } from './usdSchema'
import { USAGE_ID_MAX_CHARS } from './constants'
// The ownership contract lives alone for the capped headless bundle; every
// existing importer keeps reading it from here.
export { estimateAccountOwnerSchema, type EstimateAccountOwner } from './estimateOwner'
import { estimateAccountOwnerSchema } from './estimateOwner'
const usageIdSchema = z
  .string()
  .check(z.minLength(1), z.maxLength(USAGE_ID_MAX_CHARS), z.regex(/^[\w.-]+$/))

// Counts and percentages stay binary numbers; money is exact decimal
// strings end to end, so a boundary value floating point gets wrong still
// admits exactly.
const amount = z.nullable(z.union([z.number().check(z.nonnegative()), nonnegativeUsdSchema]))
const instant = z.iso.datetime().check(z.refine((value) => Number.isFinite(Date.parse(value))))
const maybeInstant = z.nullable(instant)
export const estimateLimitFactSchema = z
  .strictObject({
    owner: z.discriminatedUnion('kind', [
      estimateAccountOwnerSchema,
      z.strictObject({
        kind: z.literal('machine'),
        id: usageIdSchema,
        providerId: z.null(),
        generation: z.null(),
      }),
    ]),
    metric: usageIdSchema,
    unit: z.nullable(z.enum(['requests', 'tokens', 'percent', 'usd'])),
    used: amount,
    limit: amount,
    remaining: amount,
    window: z.strictObject({
      startsAt: maybeInstant,
      resetsAt: maybeInstant,
      periodSeconds: z.nullable(z.int().check(z.positive())),
      calendarPeriod: z.nullable(z.enum(['day', 'week', 'month'])),
    }),
    observedAt: instant,
    observedBy: z.enum([
      'usage-read',
      'usage-changed',
      'account-limits',
      'configuration',
      'museCode',
      'openRouter',
      'headers',
      'chatgpt',
    ]),
  })
  .check(
    z.refine((fact) => {
      if (fact.unit === 'usd') {
        // Money travels only as exact decimal strings, with no renewal the
        // estimator could schedule against: a usd balance never resets.
        const amounts = [fact.used, fact.limit, fact.remaining]
        if (
          amounts.some((value) => value !== null && typeof value !== 'string') ||
          fact.window.resetsAt !== null
        )
          return false
        const { limit, remaining } = fact
        return (
          limit === null ||
          remaining === null ||
          (typeof limit === 'string' &&
            typeof remaining === 'string' &&
            compareUsdAmounts(remaining, limit) <= 0)
        )
      }
      // Counts (requests, tokens, percent) are numbers only: a string
      // amount for a non-money unit is refused at the schema.
      if (
        (fact.used !== null && typeof fact.used !== 'number') ||
        (fact.limit !== null && typeof fact.limit !== 'number') ||
        (fact.remaining !== null && typeof fact.remaining !== 'number')
      )
        return false
      const { limit, remaining } = fact
      return (
        (limit === null || remaining === null || remaining <= limit) &&
        (fact.unit !== 'percent' || limit === null || limit <= 100)
      )
    }),
  )
export type EstimateLimitFact = z.infer<typeof estimateLimitFactSchema>
