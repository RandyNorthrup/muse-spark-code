import { generateKeyPairSync } from 'node:crypto'
import { isoCBOR, cose } from '@simplewebauthn/server/helpers'
import * as z from 'zod/mini'

/** Inject a Playwright CDPSession; no browser launches or trust bypasses here. */
interface AuthenticatorCdpPort {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
}
const authenticatorReply = z.strictObject({ authenticatorId: z.string().check(z.minLength(1)) })
const emptyReply = z.strictObject({})

/** Chrome's virtual CTAP2 authenticator creates real browser WebAuthn proofs. */
export class VirtualNodeAuthenticator {
  static async create(cdp: AuthenticatorCdpPort): Promise<VirtualNodeAuthenticator> {
    emptyReply.parse(await cdp.send('WebAuthn.enable', { enableUI: false }))
    const response = authenticatorReply.parse(
      await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      }),
    )
    return new VirtualNodeAuthenticator(cdp, response.authenticatorId)
  }
  private constructor(
    private readonly cdp: AuthenticatorCdpPort,
    readonly id: string,
  ) {}
  async setVerified(isVerified: boolean): Promise<void> {
    emptyReply.parse(
      await this.cdp.send('WebAuthn.setUserVerified', {
        authenticatorId: this.id,
        isUserVerified: isVerified,
      }),
    )
  }
  async close(): Promise<void> {
    emptyReply.parse(
      await this.cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: this.id }),
    )
  }
}

/** Ephemeral test key; the private half is never persisted or captured. */
export function nodeSigningKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = z.object({ x: z.string(), y: z.string() }).parse(publicKey.export({ format: 'jwk' }))
  const publicCose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [cose.COSEKEYS.kty, cose.COSEKTY.EC2],
      [cose.COSEKEYS.alg, cose.COSEALG.ES256],
      [cose.COSEKEYS.crv, 1],
      [cose.COSEKEYS.x, Buffer.from(jwk.x, 'base64url')],
      [cose.COSEKEYS.y, Buffer.from(jwk.y, 'base64url')],
    ]),
  )
  return { privateKey, publicCose }
}
