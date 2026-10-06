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
