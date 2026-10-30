// Verify a pack index's cosign keyless bundle (M110t TP2, PLAN.md
// D90.27): the pack CI signs each index with `cosign sign-blob`, and the
// node verifies the bundle against the exact bytes before anything else,
// pinning the workflow's Fulcio identity. Sigstore's own verification
// packages (the same infrastructure npm provenance uses) do the
// cryptography; nothing here is hand-rolled. They are composed as the
// `sigstore` package's `verify` composes them (its `createVerifier`):
// the trusted root from Sigstore's TUF repository, the bundle parsed and
// checked, then the signature, certificate, transparency-log and identity
// checks. Two calls are stricter than that umbrella, because its own
// README says the identity string is a regular expression and a DSSE
// bundle does not cover the artifact bytes. The node only verifies, so
// the signer's half of `sigstore` (its HTTP stack) is never bundled
// (cc-sigstore). Loaded lazily: it stays out of the ACP agent's first
// bundle. Verification needs the network (TUF); offline, the node keeps
// its cached verified index and refuses new fetches, saying so.
import {
  ValidationError,
  bundleFromJSON,
  isBundleWithMessageSignature,
  type BundleWithMessageSignature,
} from '@sigstore/bundle'
import { getTrustedRoot } from '@sigstore/tuf'
import {
  PolicyError,
  VerificationError,
  Verifier,
  toSignedEntity,
  toTrustMaterial,
  type VerificationPolicy,
} from '@sigstore/verify'
import { PACKS_SIGN_IDENTITY, PACKS_SIGN_ISSUER } from '../../../shared/constants'

/**
`@sigstore/verify` matches `subjectAlternativeName` with
`String.prototype.match`, so an unanchored identity also matches a longer
ref (`refs/heads/maintenance`) and a dot matches any character. The pack
workflow's identity is one exact URI (sigstore README,
`certificateIdentityURI`).
*/
const IDENTITY_PATTERN_METACHARACTERS = /[.*+?^${}()|[\]\\]/g

/** What bundle verification answers: verified, or the failure's kind. */
export type BundleVerdict =
  { readonly verified: true } | { readonly verified: false; readonly failure: string }

/** The bundle's discriminator: the bundle parser validates the rest. */
function hasMediaType(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'mediaType' in value &&
    typeof value.mediaType === 'string'
  )
}

/** The identity and issuer the pack workflow's certificate must match, exactly. */
export function packVerificationPolicy(): VerificationPolicy {
  return {
    subjectAlternativeName: `^${PACKS_SIGN_IDENTITY.replaceAll(
      IDENTITY_PATTERN_METACHARACTERS,
      String.raw`\$&`,
    )}$`,
    extensions: { issuer: PACKS_SIGN_ISSUER },
  }
}

/**
Parse a bundle and refuse it before any trust-root refresh when it cannot
be a signature over the index bytes. `cosign sign-blob` writes a message
signature. A DSSE envelope (an attestation) is verified over its own
payload: `toSignedEntity` never compares the artifact bytes, so accepting
one would treat a signature over something else as a signature over the
index.
*/
export function readPackBundle(
  bundle: unknown,
):
  | { readonly ok: true; readonly bundle: BundleWithMessageSignature }
  | { readonly ok: false; readonly verdict: BundleVerdict } {
  if (!hasMediaType(bundle)) {
    return { ok: false, verdict: { verified: false, failure: 'malformed-bundle' } }
  }
  let parsed: ReturnType<typeof bundleFromJSON>
  try {
    parsed = bundleFromJSON(bundle)
  } catch (error: unknown) {
    if (error instanceof ValidationError) {
      return { ok: false, verdict: { verified: false, failure: 'malformed-bundle' } }
    }
    throw error
  }
  return isBundleWithMessageSignature(parsed)
    ? { ok: true, bundle: parsed }
    : { ok: false, verdict: { verified: false, failure: 'unsupported-bundle' } }
}

/**
Verify `bundle` (the cosign bundle JSON, parsed) against the exact index
`bytes`. The failure names the cause's fixed code (sigstore's error
code, or the fetch failure's), never its message, for the audit record.
Anything else is loud.
*/
export async function verifyIndexBundle(
  bundle: unknown,
  bytes: Uint8Array,
): Promise<BundleVerdict> {
  const read = readPackBundle(bundle)
  if (!read.ok) return read.verdict
  try {
    // Sigstore's public-good TUF repository at its own defaults (mirror,
    // cache directory, retry { retries: 2 } and timeout 5000), as
    // `sigstore.verify` asks it. One transparency-log entry, one
    // certificate-transparency entry and one timestamp are required: those
    // are the verifier's defaults, passed explicitly so a later default of
    // zero cannot accept a bundle that was never logged or time-stamped.
    const trustedRoot = await getTrustedRoot()
    const verifier = new Verifier(toTrustMaterial(trustedRoot), {
      ctlogThreshold: 1,
      tlogThreshold: 1,
      timestampThreshold: 1,
    })
    verifier.verify(toSignedEntity(read.bundle, Buffer.from(bytes)), packVerificationPolicy())
    return { verified: true }
  } catch (error: unknown) {
    if (error instanceof VerificationError) return { verified: false, failure: error.code }
    if (error instanceof PolicyError) return { verified: false, failure: error.code }
    if (error instanceof TypeError) return { verified: false, failure: 'network' }
    throw error
  }
}
