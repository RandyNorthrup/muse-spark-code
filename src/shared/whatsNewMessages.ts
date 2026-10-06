// What the What's New page (M99, PLAN.md D79) says to the host. The page's
// script sends only indexes into the lists the host rendered it from (a
// link, a Try it) and the toggle's state, never an address or a command id,
// and the host parses every message with this schema before acting on it
// (AGENTS.md rule 7). The script imports the type only.

import * as z from 'zod/mini'

const index = z.number().check(z.int(), z.nonnegative())

const whatsNewMessageSchema = z.union([
  z.object({ type: z.literal('openLink'), index }),
  z.object({ type: z.literal('tryIt'), index }),
  z.object({ type: z.literal('hideOnUpdate'), isHidden: z.boolean() }),
])

export type WhatsNewMessage = z.infer<typeof whatsNewMessageSchema>

/** A message from the page, checked; undefined when it is not one. */
export function parseWhatsNewMessage(raw: unknown): WhatsNewMessage | undefined {
  const result = whatsNewMessageSchema.safeParse(raw)
  return result.success ? result.data : undefined
}
