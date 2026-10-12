// M117: normalized owner facts, never provider wire shapes or display text.
import * as z from 'zod/mini'
import { accountIdSchema } from './accountId'
import { USAGE_ID_MAX_CHARS } from './constants'
const usageIdSchema = z
  .string()
  .check(z.minLength(1), z.maxLength(USAGE_ID_MAX_CHARS), z.regex(/^[\w.-]+$/))

const amount = z.nullable(z.number().check(z.nonnegative()))
const instant = z.iso.datetime().check(z.refine((value) => Number.isFinite(Date.parse(value))))
const maybeInstant = z.nullable(instant)
export const estimateAccountOwnerSchema = z.strictObject({
  kind: z.literal('account'),
  id: accountIdSchema,
  providerId: accountIdSchema,
  generation: z.string().check(z.minLength(1)),
})
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
    z.refine(
      (fact) =>
        (fact.limit === null || fact.remaining === null || fact.remaining <= fact.limit) &&
        (fact.unit !== 'percent' || fact.limit === null || fact.limit <= 100),
    ),
  )
export type EstimateLimitFact = z.infer<typeof estimateLimitFactSchema>
export type EstimateAccountOwner = z.infer<typeof estimateAccountOwnerSchema>
