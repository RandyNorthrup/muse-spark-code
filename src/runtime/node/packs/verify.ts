// Verify a pack index's cosign keyless bundle (M110t TP2, PLAN.md
// D90.27): the pack CI signs each index with `cosign sign-blob`, and the
// node verifies the bundle against the exact bytes before anything else,
// pinning the workflow's Fulcio identity. sigstore (the same
// infrastructure npm provenance uses) does the cryptography; nothing
// here is hand-rolled. Loaded lazily: sigstore stays out of the ACP
// agent's first bundle. Verification needs the network (Fulcio, Rekor);
// offline, the node keeps its cached verified index and refuses new
// fetches, saying so.
import { PolicyError, VerificationError, verify, type Bundle } from 'sigstore'
import { PACKS_SIGN_IDENTITY, PACKS_SIGN_ISSUER } from '../../../shared/constants'

/** The bundle's discriminator: sigstore validates the rest on verify. */
function isBundle(value: unknown): value is Bundle {
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
  if (!isBundle(bundle)) return { verified: false, failure: 'malformed-bundle' }
  try {
    await verify(bundle, Buffer.from(bytes), {
      certificateIssuer: PACKS_SIGN_ISSUER,
      certificateIdentityURI: PACKS_SIGN_IDENTITY,
    })
    return { verified: true }
  } catch (error: unknown) {
    if (error instanceof VerificationError) return { verified: false, failure: error.code }
    if (error instanceof PolicyError) return { verified: false, failure: error.code }
    if (error instanceof TypeError) return { verified: false, failure: 'network' }
    throw error
  }
}
