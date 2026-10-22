// Browser scope admits public widened hosts and exact user-configured dev origins.
// The proxy enforces the resolved-address rule for names at every connection.

import { isIPv4, isIPv6 } from 'node:net'
import { isPublicAddress } from '../publicAddress'
import {
  MAKER_COMPANION_PORT_FIRST,
  MAKER_COMPANION_PORT_END,
  BROWSER_MACHINE_UI,
  BROWSER_MACHINE_API,
  BROWSER_MACHINE_PORTS,
  BROWSER_HTTP_PORT,
  BROWSER_HTTPS_PORT,
} from '../../shared/constants'
import {
  BROWSER_CHECK_HOST_MAX_CHARS,
  BROWSER_CHECK_URL_MAX_CHARS,
} from '../../shared/browserCheckConstants'

const LOCALHOST = 'localhost'
const IPV6_LOOPBACK = '[::1]'
const IPV4_LOOPBACK_OCTET = '127'
const IPV6_OPEN = '['
const IPV6_CLOSE = ']'
// A DNS name as the URL parser leaves it: lower-case letters, digits and
// hyphens, in labels joined by single dots.
const DNS_NAME = /^[\da-z-]+(?:\.[\da-z-]+)*$/
// The schemes a page's request may use to reach a host at all.
const NETWORK_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:', 'ws:', 'wss:'])
const PAGE_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:'])

/** A URL parser's hostname, if it is a plain name or address; undefined for anything else. */
function plainHost(hostname: string): string | undefined {
  if (hostname.length === 0 || hostname.length > BROWSER_CHECK_HOST_MAX_CHARS) {
    return undefined
  }
  if (hostname.startsWith(IPV6_OPEN) && hostname.endsWith(IPV6_CLOSE)) {
    return isIPv6(hostname.slice(1, -1)) ? hostname : undefined
  }
  return isIPv4(hostname) || DNS_NAME.test(hostname) ? hostname : undefined
}

/** Whether a host (as a URL names it) is loopback by itself: `localhost`, 127.0.0.0/8, `[::1]`. */
export function isLoopbackHost(host: string): boolean {
  return (
    host === LOCALHOST ||
    host === IPV6_LOOPBACK ||
    (isIPv4(host) && host.split('.', 1)[0] === IPV4_LOOPBACK_OCTET)
  )
}

/**
A host the user named in the setting, as a URL names it (`Example.COM` →
`example.com`, `::1` → `[::1]`), or undefined when it is not a plain name
or address: a port, a path, a wildcard or a list is refused.
*/
export function widenedHost(entry: string): string | undefined {
  const given = entry.trim()
  if (given === '' || given.length > BROWSER_CHECK_HOST_MAX_CHARS) {
    return undefined
  }
  if (/^https?:\/\//.test(given)) {
    try {
      const origin = new URL(given)
      return PAGE_SCHEMES.has(origin.protocol) &&
        plainHost(origin.hostname) !== undefined &&
        origin.username === '' &&
        origin.password === '' &&
        origin.pathname === '/' &&
        origin.search === '' &&
        origin.hash === '' &&
        !isMakerCompanionPort(Number(origin.port))
        ? origin.origin
        : undefined
    } catch {
      return undefined
    }
  }
  let url: URL
  try {
    url = new URL(`http://${isIPv6(given) ? `${IPV6_OPEN}${given}${IPV6_CLOSE}` : given}/`)
  } catch (error) {
    // The URL parser answers a malformed entry with a TypeError; anything
    // else is not the entry and reaches the caller.
    if (!(error instanceof TypeError)) throw error
    return undefined
  }
  // Only a host may have been given: no user, port, path or query slipped in.
  const isHostOnly =
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '' &&
    !given.includes('/')
  return isHostOnly ? plainHost(url.hostname) : undefined
}

/** Permanently reserved, independent of mutable discovery files. */
export function isMakerCompanionPort(port: number): boolean {
  return port >= MAKER_COMPANION_PORT_FIRST && port < MAKER_COMPANION_PORT_END
}
function isNonPublicHost(host: string): boolean {
  return (
    host === LOCALHOST ||
    ((isIPv4(host) || host.startsWith('[')) &&
      !isPublicAddress(host.startsWith('[') ? host.slice(1, -1) : host))
  )
}
/** Fixed machine UI identities and private standard web/service ports never widen. */
export function isMachineBrowserUrl(url: URL): boolean {
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return true
  }
  return (
    BROWSER_MACHINE_UI.test(`${url.hostname}${pathname}`) ||
    BROWSER_MACHINE_API.test(pathname) ||
    (isNonPublicHost(url.hostname) &&
      BROWSER_MACHINE_PORTS.has(
        Number(url.port || (url.protocol === 'https:' ? BROWSER_HTTPS_PORT : BROWSER_HTTP_PORT)),
      ))
  )
}
/** Exact origins only can admit private addresses; host-wide widening never does. */
export function isExplicitDevOrigin(url: URL, entries: ReadonlySet<string>): boolean {
  return (
    entries.has(url.origin) && !isMakerCompanionPort(Number(url.port)) && !isMachineBrowserUrl(url)
  )
}

/** Where a URL the model asked for stands, before any card. */
export type BrowserUrlPlacement =
  | { readonly kind: 'refused' }
  | {
      /** Exact dev origin; public host in the setting; or a public host that needs approval. */
      readonly kind: 'local' | 'widened' | 'needsWidening'
      /** The URL as the browser will open it, its fragment kept (it is never sent). */
      readonly url: string
      /** Its host, as the rule compares hosts. */
      readonly host: string
      /** What an approval and an "always" rule are keyed on: the host and a port other than the default. */
      readonly approvalHost: string
    }

/**
The URL the model asked to open, checked against the rule: an absolute
`http:` or `https:` URL with a plain host and no user name or password.
*/
export function placeBrowserUrl(raw: string, extraHosts: ReadonlySet<string>): BrowserUrlPlacement {
  if (raw.length > BROWSER_CHECK_URL_MAX_CHARS) {
    return { kind: 'refused' }
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch (error) {
    // The URL parser answers a malformed address with a TypeError; anything
    // else is not the address and reaches the caller.
    if (!(error instanceof TypeError)) throw error
    return { kind: 'refused' }
  }
  const host = plainHost(url.hostname)
  if (
    host === undefined ||
    !PAGE_SCHEMES.has(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    isMakerCompanionPort(Number(url.port)) ||
    isMachineBrowserUrl(url) ||
    (isNonPublicHost(host) && !isExplicitDevOrigin(url, extraHosts))
  ) {
    return { kind: 'refused' }
  }
  let kind: 'local' | 'widened' | 'needsWidening' = 'needsWidening'
  if (isExplicitDevOrigin(url, extraHosts)) {
    kind = 'local'
  } else if (extraHosts.has(host)) {
    kind = 'widened'
  }
  return {
    kind,
    url: url.href,
    host,
    approvalHost: url.port === '' ? host : `${host}:${url.port}`,
  }
}

/**
Whether a request the page makes may go out: an http(s) or ws(s) URL to
an exact dev origin or a public host widened for this check. Anything else is blocked,
whatever scheme it uses.
*/
export function isAllowedRequest(rawUrl: string, allowedHosts: ReadonlySet<string>): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch (error) {
    // The URL parser answers a malformed request address with a TypeError;
    // anything else is not the address and reaches the caller.
    if (!(error instanceof TypeError)) throw error
    return false
  }
  return (
    NETWORK_SCHEMES.has(url.protocol) &&
    !isMachineBrowserUrl(url) &&
    !isMakerCompanionPort(Number(url.port)) &&
    (isExplicitDevOrigin(new URL(url.href.replace(/^ws/, 'http')), allowedHosts) ||
      (!isNonPublicHost(url.hostname) && allowedHosts.has(url.hostname)))
  )
}

/** Whether a URL names a network scheme at all (http, https, ws, wss): what the page's lists report. */
export function isNetworkUrl(rawUrl: string): boolean {
  try {
    return NETWORK_SCHEMES.has(new URL(rawUrl).protocol)
  } catch (error) {
    // The URL parser answers a malformed address with a TypeError; anything
    // else is not the address and reaches the caller.
    if (!(error instanceof TypeError)) throw error
    return false
  }
}
