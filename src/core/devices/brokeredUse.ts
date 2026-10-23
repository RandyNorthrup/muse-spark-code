// Brokered secret uses over the pair (M110d lane F3, D90.10): a node asks
// its pair to *use* a secret (sign, decrypt, fetch with a token) without
// the secret ever travelling. The envelope carries the use, never the
// value; admission checks the job epoch, the pair's trust and the item's
// D89 mode. The use itself runs through M109's broker, whose remote
// requester is the leg that waits.
import * as z from 'zod/mini'

export const brokeredUseModeSchema = z.enum([
  'askEveryTime',
  'askOncePerSession',
  'alwaysAllow',
  'never',
])

export const brokeredUseRequestSchema = z.strictObject({
  keyId: z.string().check(z.minLength(1)),
  mode: brokeredUseModeSchema,
  purpose: z.string().check(z.minLength(1)),
  epoch: z.int().check(z.gte(0)),
  nonce: z.string().check(z.minLength(1)),
})
export type BrokeredUseRequest = z.infer<typeof brokeredUseRequestSchema>

export type BrokeredUseVerdict =
  { readonly admitted: true } | { readonly admitted: false; readonly reason: string }

/* Admit a brokered use: the epoch must be the lease's live one (a late
 * node's old epoch is refused at this gate, D80.7), the mode must allow a
 * remote use, and only a "my node" pair may ask at all. */
export function admitBrokeredUse(
  request: BrokeredUseRequest,
  options: {
    readonly leaseEpoch: number
    readonly pairTrust: 'my-node' | 'other'
    readonly keyRevoked: boolean
  },
): BrokeredUseVerdict {
  if (options.keyRevoked) return { admitted: false, reason: 'this key is revoked' }
  const parsed = brokeredUseRequestSchema.parse(request)
  if (parsed.epoch !== options.leaseEpoch)
    return { admitted: false, reason: 'this use carries a stale epoch' }
  if (options.pairTrust !== 'my-node')
    return { admitted: false, reason: 'only a paired node may use this secret' }
  return parsed.mode === 'never'
    ? { admitted: false, reason: 'this secret is never usable remotely' }
    : { admitted: true }
}
