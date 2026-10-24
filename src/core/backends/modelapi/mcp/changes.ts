// How a modern MCP server says its tools change or will go stale (PLAN.md
// D213; spec 2026-07-28): the tools capability its discovery names, the
// messages of a `subscriptions/listen`
// (`basic/patterns/subscriptions`: the acknowledgment's honoured filter,
// the subscription id every message carries in `_meta`, a server's own
// `notifications/cancelled` ending it), and a listing's freshness from
// its pages' `ttlMs` (`server/utilities/caching`). Kept apart from
// protocol.ts, which bundles beyond the pool import, so only the
// connection carries them. Pure.

import * as z from 'zod/mini'
import { MCP_META_SUBSCRIPTION_ID } from '../../../../shared/constants'
import { type DiscoverResult, type RequestId, requestIdSchema } from './protocol'

/** A modern server's tools capability: whether it has tools, and whether their list changes. */
export interface ModernTools {
  readonly hasTools: boolean
  readonly listChanged: boolean
}

/** The tools capability a discovery result names. */
export function modernTools(discover: DiscoverResult): ModernTools {
  const { tools } = discover.capabilities
  return { hasTools: tools !== undefined, listChanged: tools?.listChanged === true }
}

/** A cacheable result's freshness hint, read leniently: only a positive number counts. */
const cacheHintSchema = z.object({ ttlMs: z.optional(z.unknown()) })

/**
A listing's freshness after one more page ("Freshness Calculation" and
"Interaction with Pagination"): each page is fresh while
`now < receivedAt + ttlMs`, so the listing is fresh until its earliest
page lapses. A page whose `ttlMs` is absent, zero or negative is
immediately stale and leaves the listing with no clock (undefined), as
does a listing that already had none.
*/
export function pageFreshUntil(
  page: unknown,
  receivedAt: number,
  freshUntil: number | undefined,
): number | undefined {
  if (freshUntil === undefined) {
    return undefined
  }
  const hint = cacheHintSchema.safeParse(page)
  const ttlMs = hint.success ? hint.data.ttlMs : undefined
  return typeof ttlMs === 'number' && Number.isFinite(ttlMs) && ttlMs > 0
    ? Math.min(freshUntil, receivedAt + ttlMs)
    : undefined
}

const metaSchema = z.object({ _meta: z.optional(z.record(z.string(), z.unknown())) })

/**
The subscription a notification belongs to: the id of the
`subscriptions/listen` that opened it, in `_meta` ("Receiving
Notifications").
*/
export function subscriptionIdOf(params: unknown): unknown {
  const parsed = metaSchema.safeParse(params)
  return parsed.success ? parsed.data._meta?.[MCP_META_SUBSCRIPTION_ID] : undefined
}

/** `notifications/subscriptions/acknowledged`: the filter the server honours. */
export const subscriptionAckSchema = z.object({
  notifications: z.optional(z.object({ toolsListChanged: z.optional(z.boolean()) })),
})

const cancelledSchema = z.object({ requestId: requestIdSchema })

/** The request a `notifications/cancelled` names, or undefined. */
export function cancelledRequestOf(params: unknown): RequestId | undefined {
  const parsed = cancelledSchema.safeParse(params)
  return parsed.success ? parsed.data.requestId : undefined
}
