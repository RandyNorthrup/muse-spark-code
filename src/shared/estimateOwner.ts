// The estimator's ownership contract alone (R6): a bundle that binds limit
// observations to their owner needs no fact, window or translator schemas,
// so this module stays small enough for the capped headless bundle.
import * as z from 'zod/mini'
import { accountIdSchema } from './accountId'

export const estimateAccountOwnerSchema = z.strictObject({
  kind: z.literal('account'),
  id: accountIdSchema,
  providerId: accountIdSchema,
  generation: z.string().check(z.minLength(1)),
})
export type EstimateAccountOwner = z.infer<typeof estimateAccountOwnerSchema>
