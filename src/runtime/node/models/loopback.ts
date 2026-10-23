// The loopback guard (M110g lane L, D90.7): a model sidecar answers on
// loopback and nowhere else. Plain HTTP to a non-loopback sidecar is
// refused by name, and so is anything that is not loopback at all: model
// traffic never crosses the network unsealed.
import { isIPv4, isIPv6 } from 'node:net'

export type SidecarVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string }

function isLoopbackName(host: string): boolean {
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  return isIPv4(bare)
    ? bare.split('.', 1)[0] === '127'
    : bare === 'localhost' || (isIPv6(bare) && bare === '::1')
}

/* The sidecar URL the node dials, allowed only on loopback. */
export function checkSidecarUrl(urlText: string): SidecarVerdict {
  let url: URL
  try {
    url = new URL(urlText)
  } catch (error) {
    if (error instanceof TypeError) return { ok: false, reason: 'a sidecar URL parses first' }
    throw error
  }
  if (url.username !== '' || url.password !== '')
    return { ok: false, reason: 'a sidecar URL carries no credentials' }
  if (!isLoopbackName(url.hostname)) {
    const reason =
      url.protocol === 'http:'
        ? 'plain HTTP reaches a sidecar only on loopback'
        : 'a sidecar answers on loopback, nowhere else'
    return { ok: false, reason }
  }
  return { ok: true }
}
