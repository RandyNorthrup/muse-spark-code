// Sign-in behind the person's reverse proxy (M110e lane A2, D90.11): the
// proxy authenticates and names the user in a header, and the node trusts
// that header only from the proxy's own socket. Any other peer, or a
// missing user, is refused by name. Header and socket are the person's
// own settings.
import * as z from 'zod/mini'

export const proxySigninSchema = z.strictObject({
  socketPath: z.string().check(z.minLength(1)),
  userHeader: z.string().check(z.minLength(1)),
})
export type ProxySignin = z.infer<typeof proxySigninSchema>

export type ProxySigninVerdict =
  | { readonly accepted: true; readonly user: string }
  | { readonly accepted: false; readonly reason: string }

/* Accept only the configured socket's word for the configured header. */
export function acceptProxySignin(
  settings: ProxySignin,
  peer: { readonly socketPath: string | undefined; readonly headers: ReadonlyMap<string, string> },
): ProxySigninVerdict {
  const parsed = proxySigninSchema.parse(settings)
  if (peer.socketPath !== parsed.socketPath)
    return { accepted: false, reason: 'proxy sign-in arrives only over its own socket' }
  const user = peer.headers.get(parsed.userHeader.toLowerCase())
  return user === undefined || user.trim() === ''
    ? { accepted: false, reason: 'the proxy named no user' }
    : { accepted: true, user: user.trim() }
}
