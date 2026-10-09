import { beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { nodeWebAuthnCapture as capture } from './helpers/node/webAuthnCapture'
import { SimpleNodePasskeys, type NodePasskey } from '../../src/runtime/node/auth/passkeys'
import {
  nodeRegistrationSchema,
  nodeAssertionSchema,
  nodeTokenSchema,
  type NodeAuthChallenge,
} from '../../src/shared/nodeAuth'

// Public browser proofs captured on this rig; no private authenticator key.
// Localhost HTTP is the secure-context capture fixture, never a node origin.
const fixture = z
  .object({
    capture: z.object({ origin: z.url(), modelAttempts: z.literal(0), browser: z.string() }),
    challenge: nodeTokenSchema,
    registration: nodeRegistrationSchema,
    assertions: z.array(nodeAssertionSchema).check(z.minLength(2)),
    noUv: nodeAssertionSchema,
    registrationNoUv: nodeRegistrationSchema,
    registrationNoPresence: nodeRegistrationSchema,
    registrationUnrequestedAlgorithm: nodeRegistrationSchema,
  })
  .parse(capture)
const context: { key: NodePasskey | undefined } = { key: undefined }
const verifier = new SimpleNodePasskeys()
function challenge(purpose: 'enroll' | 'signin' = 'signin'): NodeAuthChallenge {
  return {
    v: 1,
    id: 'captured-browser',
    purpose,
    rpId: 'localhost',
    origin: fixture.capture.origin,
    challenge: fixture.challenge,
    issuedAt: 0,
    expiresAt: 60_000,
  }
}
function key(): NodePasskey {
  if (context.key === undefined) throw new Error('registration not verified')
  return context.key
}
function assertion() {
  const proof = fixture.assertions[0]
  if (proof === undefined) throw new Error('missing captured assertion')
  return structuredClone(proof)
}
beforeAll(async () => {
  context.key = await verifier.enroll(challenge('enroll'), fixture.registration, 'owner')
})

describe('H05 real SimpleWebAuthn against captured CDP proofs', () => {
  it('refuses a registration algorithm that the browser was not offered', async () => {
    await expect(
      verifier.enroll(challenge('enroll'), fixture.registrationUnrequestedAlgorithm, 'owner'),
    ).rejects.toThrow('Sign in')
  })
  it('verifies browser enrollment and signed UV assertions with counter progression', async () => {
    expect(key().publicKey).not.toBe('')
    const counter = await verifier.assert(challenge(), assertion(), key())
    expect(counter).toBeGreaterThan(key().counter)
    const next = fixture.assertions[1]
    if (next === undefined) throw new Error('missing second assertion')
    expect(await verifier.assert(challenge(), next, { ...key(), counter })).toBeGreaterThan(counter)
  })
  it.each(['challenge', 'origin', 'rpId'] as const)(
    'rejects the wrong %s for enrollment and assertion',
    async (field) => {
      const alternatives = {
        challenge: 'b'.repeat(43),
        origin: 'https://other.local',
        rpId: 'other.local',
      }
      const changed = { ...challenge('enroll'), [field]: alternatives[field] }
      await expect(verifier.enroll(changed, fixture.registration, 'owner')).rejects.toThrow(
        'Sign in',
      )
      await expect(
        verifier.assert({ ...changed, purpose: 'signin' }, assertion(), key()),
      ).rejects.toThrow('Sign in')
    },
  )
  it('rejects signature forgery, raw ID mismatch and disabled authenticators', async () => {
    const proof = assertion()
    const signature = Buffer.from(proof.response.signature, 'base64url')
    signature[signature.length - 1] = (signature.at(-1) ?? 0) ^ 1
    await expect(
      verifier.assert(
        challenge(),
        { ...proof, response: { ...proof.response, signature: signature.toString('base64url') } },
        key(),
      ),
    ).rejects.toThrow('Sign in')
    await expect(
      verifier.assert(challenge(), { ...proof, rawId: 'YW5vdGhlcg' }, key()),
    ).rejects.toThrow('Sign in')
    await expect(verifier.assert(challenge(), proof, { ...key(), disabled: true })).rejects.toThrow(
      'Sign in',
    )
  })
  it('rejects a captured assertion replay after its counter advanced', async () => {
    const proof = assertion()
    const counter = await verifier.assert(challenge(), proof, key())
    await expect(verifier.assert(challenge(), proof, { ...key(), counter })).rejects.toThrow(
      'Sign in',
    )
  })
  it('rejects genuinely signed assertions and registrations without UV', async () => {
    await expect(verifier.assert(challenge(), fixture.noUv, key())).rejects.toThrow('Sign in')
    await expect(
      verifier.enroll(challenge('enroll'), fixture.registrationNoUv, 'owner'),
    ).rejects.toThrow('Sign in')
  })
  it('rejects absent presence and verification flags', async () => {
    await expect(
      verifier.enroll(challenge('enroll'), fixture.registrationNoPresence, 'owner'),
    ).rejects.toThrow('Sign in')
    const proof = assertion()
    for (const flag of [0x04, 0x01]) {
      const data = Buffer.from(proof.response.authenticatorData, 'base64url')
      data[32] = (data[32] ?? 0) & ~flag
      await expect(
        verifier.assert(
          challenge(),
          {
            ...proof,
            response: { ...proof.response, authenticatorData: data.toString('base64url') },
          },
          key(),
        ),
      ).rejects.toThrow('Sign in')
    }
  })
  it('refuses cross-origin client data even without topOrigin', async () => {
    const registrationClient = z
      .object({ type: z.string(), challenge: z.string(), origin: z.string() })
      .parse(
        JSON.parse(
          Buffer.from(fixture.registration.response.clientDataJSON, 'base64url').toString(),
        ),
      )
    await expect(
      verifier.enroll(
        challenge('enroll'),
        {
          ...fixture.registration,
          response: {
            ...fixture.registration.response,
            clientDataJSON: Buffer.from(
              JSON.stringify({ ...registrationClient, crossOrigin: true }),
            ).toString('base64url'),
          },
        },
        'owner',
      ),
    ).rejects.toThrow('Sign in')
    const proof = assertion()
    const data: unknown = JSON.parse(
      Buffer.from(proof.response.clientDataJSON, 'base64url').toString(),
    )
    const client = z
      .object({ type: z.string(), challenge: z.string(), origin: z.string() })
      .parse(data)
    await expect(
      verifier.assert(
        challenge(),
        {
          ...proof,
          response: {
            ...proof.response,
            clientDataJSON: Buffer.from(JSON.stringify({ ...client, crossOrigin: true })).toString(
              'base64url',
            ),
          },
        },
        key(),
      ),
    ).rejects.toThrow('Sign in')
  })
})
