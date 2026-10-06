import * as z from 'zod/mini'
import { RUNTIME_MAKER_HOST, RUNTIME_MAKER_MAX_PORT } from './constants'

export const companionLaunchSchema = z.strictObject({
  launch: z.string().check(z.regex(/^[a-f0-9]{64}$/)),
})

export const companionBootstrapSchema = z.strictObject({
  provider: z.optional(
    z.strictObject({
      host: z.literal(RUNTIME_MAKER_HOST),
      port: z.int().check(z.positive(), z.maximum(RUNTIME_MAKER_MAX_PORT)),
      token: z.string().check(z.minLength(1)),
    }),
  ),
})
export const companionPresenceSchema = z.union([
  z.strictObject({ grant: z.string().check(z.regex(/^[a-f0-9]{64}$/)) }),
  z.strictObject({ error: z.string() }),
])
