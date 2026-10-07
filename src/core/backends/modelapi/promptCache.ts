// The Model API's prompt-cache key (M56, PLAN.md D43). Meta caches the
// longest recent prefix a request shares with an earlier one, whatever the
// key; the key only routes requests that share a prefix to the same backend.
// Its guide asks for "one stable key per shared prefix" and warns that a key
// per session lowers the hit rate (dev.meta.ai/docs/prompt-caching, read
// 2026-09-25). The prefix every request of this extension starts with is the
// model, the instructions and the tools, the same for every conversation in
// a workspace on a day until a rule, skill or paid feature changes; the key
// is a digest of exactly that, so it changes when the prefix does and says
// nothing the request does not.

import { createHash } from 'node:crypto'
import {
  PROMPT_CACHE_KEY_DIGEST_CHARS,
  PROMPT_CACHE_KEY_HASH,
  PROMPT_CACHE_KEY_PREFIX,
  PROMPT_CACHE_MISS_TOKENS,
} from '../../../shared/constants'
import type { CreateResponseBody } from './schemas'

/** The part of a request its cache key names. */
export type CachedPrefix = Pick<CreateResponseBody, 'model' | 'instructions' | 'tools'>

export function promptCacheKey(prefix: CachedPrefix): string {
  const digest = createHash(PROMPT_CACHE_KEY_HASH)
    .update(JSON.stringify([prefix.model, prefix.instructions, prefix.tools]))
    .digest('hex')
    .slice(0, PROMPT_CACHE_KEY_DIGEST_CHARS)
  return `${PROMPT_CACHE_KEY_PREFIX}${digest}`
}

/** Report a cache miss only for a format that exposes cache usage (M101; log only). */
export function cacheMissTokens(
  previous: number | undefined,
  current: number,
  cached: number,
  cachedUsageFields: readonly string[],
): number | undefined {
  if (previous === undefined || cachedUsageFields.length === 0) {
    return undefined
  }
  const missed = Math.min(previous, current) - cached
  return missed > PROMPT_CACHE_MISS_TOKENS ? missed : undefined
}
