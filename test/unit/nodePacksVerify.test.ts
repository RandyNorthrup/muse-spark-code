// The pack-index verifier's policy (M110t TP2). `@sigstore/verify` matches
// the signer identity as a regular expression and verifies a DSSE envelope
// over the envelope's own payload, not the artifact bytes. These tests
// drive that library and our refusal, and they never refresh the trust root.
import { Buffer } from 'node:buffer'
import { bundleFromJSON, isBundleWithMessageSignature } from '@sigstore/bundle'
import { PolicyError } from '@sigstore/verify'
import { verifyExtensions, verifySubjectAlternativeName } from '@sigstore/verify/dist/policy.js'
import { describe, expect, it } from 'vitest'
import {
  packVerificationPolicy,
  readPackBundle,
  verifyIndexBundle,
} from '../../src/runtime/node/packs/verify'
import { PACKS_SIGN_IDENTITY, PACKS_SIGN_ISSUER } from '../../src/shared/constants'

const BUNDLE_MEDIA_TYPE = 'application/vnd.dev.sigstore.bundle.v0.3+json'

function certificateMaterial(): {
  certificate: { rawBytes: string }
  tlogEntries: []
} {
  return {
    certificate: { rawBytes: Buffer.from('leaf').toString('base64') },
    tlogEntries: [],
  }
}

/** A message signature the real bundle parser accepts. Not a captured signature. */
function messageSignatureBundle(): unknown {
  return {
    mediaType: BUNDLE_MEDIA_TYPE,
    verificationMaterial: certificateMaterial(),
    messageSignature: {
      messageDigest: {
        algorithm: 'SHA2_256',
        digest: Buffer.from('digest').toString('base64'),
      },
      signature: Buffer.from('signature').toString('base64'),
    },
  }
}

/** A DSSE envelope the real bundle parser accepts. Not a captured attestation. */
function dsseBundle(): unknown {
  return {
    mediaType: BUNDLE_MEDIA_TYPE,
    verificationMaterial: certificateMaterial(),
    dsseEnvelope: {
      payload: Buffer.from('not-the-index').toString('base64'),
      payloadType: 'application/vnd.in-toto+json',
      signatures: [{ sig: Buffer.from('signature').toString('base64') }],
    },
  }
}

function requireStringIdentity(identity: string | RegExp | undefined): string {
  if (typeof identity !== 'string') throw new TypeError('pack identity policy must be one string')
  return identity
}

describe('pack verification policy', () => {
  it('accepts only the pack workflow identity, exactly', () => {
    const identity = requireStringIdentity(packVerificationPolicy().subjectAlternativeName)
    verifySubjectAlternativeName(identity, PACKS_SIGN_IDENTITY)
    const refused = [
      PACKS_SIGN_IDENTITY.replace(/@refs\/heads\/main$/, '@refs/heads/maintenance'),
      PACKS_SIGN_IDENTITY.replace(/@refs\/heads\/main$/, '@refs/heads/main2'),
      PACKS_SIGN_IDENTITY.replace('node-packs.yml', 'node-packs-yml'),
      PACKS_SIGN_IDENTITY.replace('github.com', 'githubXcom'),
      `https://evil.example/${PACKS_SIGN_IDENTITY}`,
    ]
    for (const signer of refused) {
      expect(signer).not.toBe(PACKS_SIGN_IDENTITY)
      expect(() => {
        verifySubjectAlternativeName(identity, signer)
      }).toThrow(PolicyError)
    }
  })

  it('accepts only the GitHub Actions issuer, exactly', () => {
    const extensions = packVerificationPolicy().extensions
    if (extensions === undefined) throw new Error('pack policy names no issuer')
    verifyExtensions(extensions, { issuer: PACKS_SIGN_ISSUER })
    expect(() => {
      verifyExtensions(extensions, { issuer: `${PACKS_SIGN_ISSUER}.evil` })
    }).toThrow(PolicyError)
  })
})

describe('pack bundle content', () => {
  it('refuses a bundle that is not a signature over the index bytes, before any trust root', async () => {
    const index = new Uint8Array(Buffer.from('index'))
    const dsse = dsseBundle()
    const parsed = bundleFromJSON(dsse)
    expect(isBundleWithMessageSignature(parsed)).toBe(false)
    const refusal = { verified: false, failure: 'unsupported-bundle' }
    expect(readPackBundle(dsse)).toEqual({ ok: false, verdict: refusal })
    expect(await verifyIndexBundle(dsse, index)).toEqual(refusal)
    expect(readPackBundle({})).toEqual({
      ok: false,
      verdict: { verified: false, failure: 'malformed-bundle' },
    })
    expect(await verifyIndexBundle({ mediaType: 'not-a-sigstore-bundle' }, index)).toEqual({
      verified: false,
      failure: 'malformed-bundle',
    })
    const message = messageSignatureBundle()
    const accepted = readPackBundle(message)
    expect(accepted.ok).toBe(true)
    if (accepted.ok) expect(isBundleWithMessageSignature(accepted.bundle)).toBe(true)
  })
})
