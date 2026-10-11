// PKCE for OAuth account connections (M95: OpenRouter's **Connect
// OpenRouter account**; M95b reuses the shape for Sign in with ChatGPT).
// S256: a verifier of 43–128 unreserved characters, the challenge
// `base64url(sha256(verifier))`, and a `state` secret the callback must
// echo. The verifier and state come from the caller's random bytes
// (`node:crypto` in production, injected in tests), so this stays pure.

import { createHash, randomBytes } from 'node:crypto'
import { PKCE_STATE_BYTES, PKCE_VERIFIER_BYTES } from '../../shared/constants'

// The unreserved characters a verifier and `state` are drawn from.
const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/
const BASE64URL_PATTERN = /^[A-Za-z0-9\-_]+$/
// The shortest `state` the callback accepts (its secrets are longer).
const MIN_STATE_CHARS = 16

/** Base64url without padding, as OAuth's S256 challenge needs. */
export function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

/** The S256 challenge for a verifier. */
export function pkceChallenge(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier, 'utf8').digest())
}

/** A verifier or `state` of `byteCount` random bytes, base64url-encoded. */
export function pkceRandom(
  byteCount: number,
  random: (bytes: number) => Uint8Array = randomBytes,
): string {
  return base64Url(random(byteCount))
}

/** Whether the value is shaped like a verifier (length and charset). */
export function isPkceVerifier(value: string): boolean {
  return VERIFIER_PATTERN.test(value)
}

/** Whether the value is shaped like an opaque `state` secret. */
export function isPkceState(value: string): boolean {
  return BASE64URL_PATTERN.test(value) && value.length >= MIN_STATE_CHARS
}

/** A fresh verifier, its challenge and a `state` secret for one flow. */
export interface PkcePair {
  readonly verifier: string
  readonly challenge: string
  readonly state: string
}

/** One flow's secrets; the code is exchanged once and the server closes. */
export function createPkcePair(random: (bytes: number) => Uint8Array = randomBytes): PkcePair {
  const verifier = pkceRandom(PKCE_VERIFIER_BYTES, random)
  return {
    verifier,
    challenge: pkceChallenge(verifier),
    state: pkceRandom(PKCE_STATE_BYTES, random),
  }
}
