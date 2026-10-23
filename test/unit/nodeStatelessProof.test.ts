import { createHash, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { NodePasskeyAuth } from '../../src/runtime/node/auth/service'
import { SimpleNodePasskeys } from '../../src/runtime/node/auth/passkeys'
import {
  nodeAssertionSchema,
  nodePasskeySchema,
  type NodeAuthChallenge,
} from '../../src/shared/nodeAuth'
import { NODE_SIGNIN_BACKOFF_MAX_MS } from '../../src/shared/constants'
import { nodeWebAuthnCapture } from './helpers/node/webAuthnCapture'
import { nodeSigningKey } from './helpers/node/authenticator'
import { authFixture } from './helpers/node/authService'

// Derived from the captured browser assertion shape, with a runtime-only key.
// A counterless authenticator isolates nonce replay protection from the SDK counter.
function authenticator() {
  const captured = nodeAssertionSchema.parse(nodeWebAuthnCapture.assertions[0])
  const { privateKey, publicCose } = nodeSigningKey()
  const key = nodePasskeySchema.parse({
    id: captured.id,
    ownerId: 'owner',
    publicKey: Buffer.from(publicCose).toString('base64url'),
    counter: 0,
    failures: 0,
    disabled: false,
  })
  return {
    key,
    proof: (challenge: NodeAuthChallenge) => {
      const client = Buffer.from(
        JSON.stringify({
          type: 'webauthn.get',
          challenge: challenge.challenge,
          origin: challenge.origin,
          crossOrigin: false,
        }),
      )
      const data = Buffer.from(captured.response.authenticatorData, 'base64url')
      // The capture's final four bytes are its WebAuthn signature counter.
      data.fill(0, data.length - 4)
      return nodeAssertionSchema.parse({
        ...captured,
        response: {
          ...captured.response,
          clientDataJSON: client.toString('base64url'),
          authenticatorData: data.toString('base64url'),
          signature: sign(
            'sha256',
            Buffer.concat([data, createHash('sha256').update(client).digest()]),
            privateKey,
          ).toString('base64url'),
        },
      })
    },
  }
}

describe('H05 real passkey proof over the stateless token', () => {
  it('verifies the complete token, refuses counterless replay and preserves a failed unconsumed challenge', async () => {
    const f = authFixture()
    const device = authenticator()
    const initial = f.store.read()
    await f.store.update(initial.generation, (state) => ({
      ...state,
      passkeys: [device.key],
      config: { ...state.config, browserNames: ['localhost'] },
    }))
    const auth = new NodePasskeyAuth({
      ...f.options,
      rpId: 'localhost',
      origin: 'https://localhost:7443',
      verifier: new SimpleNodePasskeys(),
    })
    try {
      const owner = auth.forSource('owner')
      const first = await owner.begin('signin')
      expect(first.challenge).toBe(first.id)
      expect(first.challenge.length).toBeGreaterThan(128)
      const proof = device.proof(first)
      await expect(owner.signIn(first.id, proof)).resolves.toHaveProperty('bearer')
      expect(f.store.read().passkeys[0]?.counter).toBe(0)
      await expect(auth.forSource('replay').signIn(first.id, proof)).rejects.toThrow()
      const next = await owner.begin('signin')
      await expect(owner.signIn(next.id, proof)).rejects.toThrow()
      f.advance(NODE_SIGNIN_BACKOFF_MAX_MS)
      await expect(owner.signIn(next.id, device.proof(next))).resolves.toHaveProperty('bearer')
    } finally {
      auth.endAll()
      f.auth.endAll()
    }
  })
})
