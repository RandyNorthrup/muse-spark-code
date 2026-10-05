// The provider file and team import share this non-secret routing shape
// (M95, PLAN.md D74). Keep it outside provider core so panel imports stay lazy.
import * as z from 'zod/mini'

export const openRouterRoutingSchema = z.object({
  privacy: z.enum(['zdr', 'no-training', 'any']),
  order: z.optional(z.array(z.string())),
  allowFallbacks: z.optional(z.boolean()),
})
