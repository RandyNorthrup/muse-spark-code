// M117: normalized owner facts, never provider wire shapes or display text.
import * as z from 'zod/mini'
import { accountIdSchema } from './accountId'

const amount = z.nullable(z.number().check(z.nonnegative()))
const instant = z.iso.datetime().check(z.refine((value) => Number.isFinite(Date.parse(value))))
const maybeInstant = z.nullable(instant)
export const estimateLimitFactSchema = z
  .strictObject({
    owner: z
      .strictObject({
        kind: z.enum(['account', 'machine']),
        id: accountIdSchema,
        providerId: z.nullable(accountIdSchema),
        generation: z.nullable(z.string().check(z.minLength(1))),
      })
      .check(
        z.refine((owner) =>
          owner.kind === 'machine'
            ? owner.providerId === null && owner.generation === null
            : owner.providerId !== null && owner.generation !== null,
        ),
      ),
    metric: accountIdSchema,
    unit: z.enum(['requests', 'tokens', 'percent', 'usd']),
    used: amount,
    limit: amount,
    remaining: amount,
    window: z.strictObject({
      startsAt: maybeInstant,
      resetsAt: maybeInstant,
      periodSeconds: z.nullable(z.int().check(z.positive())),
    }),
    observedAt: instant,
    observedBy: z.enum(['usage-read', 'usage-changed', 'account-limits', 'configuration']),
  })
  .check(
    z.refine(
      (fact) =>
        (fact.limit === null || fact.remaining === null || fact.remaining <= fact.limit) &&
        (fact.unit !== 'percent' || fact.limit === null || fact.limit <= 100),
    ),
  )
export type EstimateLimitFact = z.infer<typeof estimateLimitFactSchema>
export type EstimateAccountOwner = EstimateLimitFact['owner'] & { kind: 'account' }
