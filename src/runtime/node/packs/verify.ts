// Verify a pack index's cosign keyless bundle (M110t TP2, PLAN.md
// D90.27): the pack CI signs each index with `cosign sign-blob`, and the
// node verifies the bundle against the exact bytes before anything else,
// pinning the workflow's Fulcio identity. Sigstore's own verification
// packages (the same infrastructure npm provenance uses) do the
// cryptography; nothing here is hand-rolled. They are composed exactly as
// the `sigstore` package's `verify` composes them (its `createVerifier`):
// the trusted root from Sigstore's TUF repository, the bundle parsed and
// checked, then the signature, certificate, transparency-log and identity
// checks. The node only verifies, so the signer's half of `sigstore` (its
// HTTP stack) is never bundled (cc-sigstore). Loaded lazily: it stays out
// of the ACP agent's first bundle. Verification needs the network (TUF);
// offline, the node keeps its cached verified index and refuses new
// fetches, saying so.
import { bundleFromJSON } from '@sigstore/bundle'
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

/** The bundle's discriminator: the bundle parser validates the rest. */
function hasMediaType(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'mediaType' in value &&
    typeof value.mediaType === 'string'
  )
}

/** What bundle verification answers: verified, or the failure's kind. */
export type BundleVerdict =
  { readonly verified: true } | { readonly verified: false; readonly failure: string }

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
  if (!hasMediaType(bundle)) return { verified: false, failure: 'malformed-bundle' }
  try {
    // Sigstore's public-good TUF repository at its own defaults (mirror,
    // cache directory, retry and timeout), as `sigstore.verify` asks it.
    const trustedRoot = await getTrustedRoot()
    const verifier = new Verifier(toTrustMaterial(trustedRoot))
    const policy: VerificationPolicy = {
      subjectAlternativeName: PACKS_SIGN_IDENTITY,
      extensions: { issuer: PACKS_SIGN_ISSUER },
    }
    verifier.verify(toSignedEntity(bundleFromJSON(bundle), Buffer.from(bytes)), policy)
    return { verified: true }
  } catch (error: unknown) {
    if (error instanceof VerificationError) return { verified: false, failure: error.code }
    if (error instanceof PolicyError) return { verified: false, failure: error.code }
    if (error instanceof TypeError) return { verified: false, failure: 'network' }
    throw error
  }
}
