// Where passkeys may enroll (M110e lane A3, D90.11): WebAuthn needs a
// secure context on a real name. Loopback and https/wss origins pass; a
// bare IP address is refused with its reason, and so is plain http to a
// name. The browser's own rule, said in our words before it bites.
import { isIP } from 'node:net'

export type PasskeyOriginVerdict =
  { readonly ok: true } | { readonly ok: false; readonly reason: string }

/* The origin a passkey enrollment runs under, judged by the secure-context rule. */
export function checkPasskeyOrigin(origin: {
  readonly protocol: string
  readonly host: string
}): PasskeyOriginVerdict {
  const protocol = origin.protocol.toLowerCase()
  const host = origin.host.toLowerCase()
  if (host === 'localhost' || host === '[::1]' || host.startsWith('127.')) return { ok: true }
  if (isIP(host.replaceAll(/^\[|\]$/g, '')) !== 0)
    return { ok: false, reason: 'passkeys need a domain name, not a bare IP address' }
  if (protocol === 'https:' || protocol === 'wss:') {
    return host === '' || host.includes(' ')
      ? { ok: false, reason: 'passkeys need a real host name' }
      : { ok: true }
  }
  return { ok: false, reason: 'passkeys need https, or the machine itself' }
}
