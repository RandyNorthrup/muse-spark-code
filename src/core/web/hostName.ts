// A URL's host as web fetch names it (M69, PLAN.md D49): the spelling a
// lookup takes and the key a per-host approval is held under. Its own module
// so that Muse Code's `webFetch` tool can name the host at activation while
// the checks themselves (pageUrl.ts) load with the fetch's bundle,
// dist/webFetch.js (PLAN.md D6). Pure.

const IPV6_OPEN = '['
const IPV6_CLOSE = ']'
export const LABEL_SEPARATOR = '.'

/**
 * The host as a lookup takes it: `[::1]` → `::1`, and every trailing dot
 * dropped (`example.com.` and `localhost..` → `example.com`, `localhost`),
 * so no spelling slips past the reserved-name check.
 */
export function bareHost(hostname: string): string {
  if (hostname.startsWith(IPV6_OPEN) && hostname.endsWith(IPV6_CLOSE)) {
    return hostname.slice(1, -1)
  }
  let end = hostname.length
  while (end > 0 && hostname[end - 1] === LABEL_SEPARATOR) {
    end -= 1
  }
  return hostname.slice(0, end)
}

/**
 * What a per-host approval is keyed on (M69): the host, its trailing dots
 * dropped, and a port other than 443.
 */
export function approvalHost(url: URL): string {
  const host = url.hostname.toLowerCase()
  const name = host.startsWith(IPV6_OPEN) ? host : bareHost(host)
  return url.port === '' ? name : `${name}:${url.port}`
}
