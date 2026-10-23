// A node's identity key (M110d lane X2, PLAN.md D90.8-9): an Ed25519 pair
// whose public half names the node. The lengths below are the algorithm's
// (RFC 8032: 32-byte keys; 44-byte SPKI and 48-byte PKCS#8 DER), not ours.
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto'
import * as z from 'zod/mini'

const ED25519_SPKI_DER_BYTES = 44
const ED25519_PKCS8_DER_BYTES = 48
const ED25519_SIGNATURE_BYTES = 64
const BASE64_QUANTUM = 4

function base64Bytes(value: string): Buffer | undefined {
  return /^[A-Za-z0-9+/]*={0,2}$/.test(value) && value.length % BASE64_QUANTUM === 0
    ? Buffer.from(value, 'base64')
    : undefined
}

function base64BytesOrThrow(value: string, problem: string): Buffer {
  const raw = base64Bytes(value)
  if (raw === undefined) throw new Error(problem)
  return raw
}

export const identityPublicKeySchema = z
  .string()
  .check(
    z.refine(
      (value) => base64Bytes(value)?.length === ED25519_SPKI_DER_BYTES,
      'not an Ed25519 SPKI public key',
    ),
  )
export type IdentityPublicKey = z.infer<typeof identityPublicKeySchema>

const identityPrivateKeySchema = z
  .string()
  .check(
    z.refine(
      (value) => base64Bytes(value)?.length === ED25519_PKCS8_DER_BYTES,
      'not an Ed25519 PKCS#8 private key',
    ),
  )

export interface IdentityKeyPair {
  readonly publicKey: IdentityPublicKey
  readonly privateKey: string
}

/** A fresh identity. The private half never leaves the node that made it. */
export function generateIdentityKeyPair(): IdentityKeyPair {
  const pair = generateKeyPairSync('ed25519')
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')
  return {
    publicKey: identityPublicKeySchema.parse(publicKey),
    privateKey: identityPrivateKeySchema.parse(privateKey),
  }
}

/** The fingerprint two people compare: SHA-256 over the SPKI bytes, as hex. */
export function fingerprintIdentity(publicKey: string): string {
  const parsed = identityPublicKeySchema.parse(publicKey)
  const raw = base64BytesOrThrow(parsed, 'not an Ed25519 SPKI public key')
  return createHash('sha256').update(raw).digest('hex').toUpperCase()
}

export function signIdentityChallenge(privateKey: string, challenge: Uint8Array): string {
  const parsed = identityPrivateKeySchema.parse(privateKey)
  return sign(null, challenge, {
    key: base64BytesOrThrow(parsed, 'not an Ed25519 PKCS#8 private key'),
    format: 'der',
    type: 'pkcs8',
  }).toString('base64')
}

export function isIdentityChallengeValid(
  publicKey: string,
  challenge: Uint8Array,
  signature: string,
): boolean {
  const parsed = identityPublicKeySchema.parse(publicKey)
  const raw = base64Bytes(signature)
  if (raw?.length !== ED25519_SIGNATURE_BYTES) return false
  return verify(
    null,
    challenge,
    {
      key: base64BytesOrThrow(parsed, 'not an Ed25519 SPKI public key'),
      format: 'der',
      type: 'spki',
    },
    raw,
  )
}
