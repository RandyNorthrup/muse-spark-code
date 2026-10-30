// M108 D: the per-account capacity bucket a receiver advertises per provider.
// Coarse on purpose: routing prefers ample over some, and never sends where
// there is none. Precise readings stay on this machine; the offer carries
// only the bucket. Live rate-limit state refines this at the production
// binding (RLF-DEVICES); the drill binds journal limits and headroom.
import {
  ACCOUNT_HEADROOM_AMPLE_DIVISOR,
  ACCOUNT_HEADROOM_SCALE,
  ACCOUNT_HEADROOM_ZERO,
} from '../../shared/constants'
import type { accountHeadroomSchema } from '../../shared/devices'
import type * as z from 'zod/mini'

type Bucket = z.infer<typeof accountHeadroomSchema>

// Map journal capacity to an offer bucket. Blocked or empty reads none; at
// least half the room left reads ample and is preferred in routing; anything
// between reads some. The cut is a routing preference only, never a threshold
// the person sets: the person's own caps live in the account thresholds.
export function accountHeadroomBucket(headroom: bigint, isBlocked: boolean): Bucket {
  if (isBlocked || headroom <= ACCOUNT_HEADROOM_ZERO) return 'none'
  return headroom * ACCOUNT_HEADROOM_AMPLE_DIVISOR >= BigInt(ACCOUNT_HEADROOM_SCALE)
    ? 'ample'
    : 'some'
}
