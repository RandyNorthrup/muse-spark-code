// The page bootstrap routes only these envelopes. The lazy account consumer
// validates the complete reply value before using it.
import * as z from 'zod/mini'
export const modelAccountsAvailableSchema = z.strictObject({
  type: z.literal('modelAccounts/available'),
})
export const modelAccountsRouteSchema = z.discriminatedUnion('type', [
  modelAccountsAvailableSchema,
  z.strictObject({
    type: z.literal('modelAccounts/reply'),
    requestId: z.int().check(z.positive()),
    value: z.unknown(),
  }),
])
