// The committed short authentication string (M110d lane X2, D90.9): each
// side commits to its nonce before either nonce is shown, so neither side
// can pick a nonce that forces a friendly SAS. The order is enforced by
// construction: finishing needs a begun session and the remote commitment.
import { createHash, hkdfSync, randomBytes } from 'node:crypto'
import * as z from 'zod/mini'

const SAS_NONCE_BYTES = 32
const SAS_DIGIT_GROUPS = 4
const SAS_GROUP_WIDTH = 4
const SAS_GROUP_BASE = 10_000
const SHA256_HEX_CHARS = 64

export const sasCommitmentSchema = z
  .string()
  .check(z.minLength(SHA256_HEX_CHARS), z.maxLength(SHA256_HEX_CHARS))
export type SasCommitment = z.infer<typeof sasCommitmentSchema>

export interface SasSession {
  readonly localNonce: string
  readonly localCommitment: SasCommitment
}

function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/* Begin: a fresh nonce and its commitment, the commitment goes first. */
export function beginSas(): SasSession {
  const localNonce = randomBytes(SAS_NONCE_BYTES).toString('base64')
  return { localNonce, localCommitment: sha256Hex(localNonce) }
}

/* Finish: checks the remote nonce against its commitment, then derives the
 * digits both sides read aloud from the pair secret and both nonces. The
 * secret is the pair's shared key; it never travels. */
export function finishSas(
  session: SasSession,
  remoteCommitment: string,
  remoteNonce: string,
  pairSecret: Uint8Array,
): readonly [string, string, string, string] {
  const commitment = sasCommitmentSchema.parse(remoteCommitment)
  if (sha256Hex(remoteNonce) !== commitment)
    throw new Error('SAS nonce does not match its commitment')
  const [first, second] =
    session.localNonce < remoteNonce
      ? [session.localNonce, remoteNonce]
      : [remoteNonce, session.localNonce]
  const stretched = Buffer.from(
    hkdfSync('sha256', pairSecret, `${first}.${second}`, 'muse-node-sas-v1', SAS_DIGIT_GROUPS * 2),
  )
  const digits = (group: number): string =>
    String(stretched.readUInt16BE(group * 2) % SAS_GROUP_BASE).padStart(SAS_GROUP_WIDTH, '0')
  return [digits(0), digits(1), digits(2), digits(SAS_DIGIT_GROUPS - 1)]
}
