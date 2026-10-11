// Both the panel publisher and chat parser validate this authored setup message.
import * as z from 'zod/mini'

export const providerSetupSchema = z.object({
  type: z.literal('setupComplete'),
  provider: z.string(),
  model: z.string(),
})
