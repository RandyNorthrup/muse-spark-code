// Live peek's versioned event (M110b K, PLAN.md D90.22): one entry of an
// agent's stream as a viewer receives it — the stream, the sequence, and
// either the scrubbed agent event or a marker for events the viewer
// missed. Shared by the tap, the route and the readers, so all three
// agree on the wire and the JSONL.
import * as z from 'zod/mini'
import { agentEventSchema } from './agentEvents'

export const PEEK_EVENT_VERSION = 1

/** The tap never drops silently: a lagging viewer gets what it missed as a count. */
export const peekSkippedSchema = z.strictObject({
  skipped: z.number().check(z.int(), z.gte(1)),
})

export const peekEventSchema = z.strictObject({
  v: z.literal(PEEK_EVENT_VERSION),
  streamId: z.string().check(z.minLength(1)),
  seq: z.number().check(z.int(), z.gte(0)),
  body: z.union([agentEventSchema, peekSkippedSchema]),
})
export type PeekEvent = z.infer<typeof peekEventSchema>
