// The shared parse result and helper for validated wire messages. This leaf
// module imports only zod: it exists so the schedule channel
// (`scheduleProtocol.ts`) can parse without importing the main conversation
// protocol (`protocol.ts`), which would cycle back through this channel's
// schemas and leave the host union half-built (M115 lane W integration).
import * as z from 'zod/mini'

export type ParseResult<T> =
  { readonly ok: true; readonly message: T } | { readonly ok: false; readonly error: string }

export function parseWith<T>(schema: z.ZodMiniType<T>, input: unknown): ParseResult<T> {
  const result = schema.safeParse(input)
  return result.success
    ? { ok: true, message: result.data }
    : { ok: false, error: z.prettifyError(result.error) }
}
