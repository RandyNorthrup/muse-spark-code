// The browser check's address rule (M81, PLAN.md D49): a page reaches
// loopback only (`localhost`, 127.0.0.0/8 and ::1) unless the user widened a
// host, in the machine-scoped `museSpark.browserCheckExtraHosts` or on an
// approval card for one call; the model never widens it. Hosts compare as
// the WHATWG URL parser writes them (`127.1` and `0x7f.0.0.1` are
// `127.0.0.1`, an IPv6 address is bracketed, a name lower-cased and an IDN
// in punycode), and by name only: a name is never looked up, so one that
// resolves elsewhere is blocked, and so is one that resolves to loopback
// unless the user widened it. A widened host is a plain name or address,
// never a pattern: it also goes into the browser's proxy bypass list, where
// `*`, `;` or `<` would mean more. Pure.

import { isIPv4, isIPv6 } from 'node:net'
import { BROWSER_CHECK_HOST_MAX_CHARS, BROWSER_CHECK_URL_MAX_CHARS } from '../../shared/constants'

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
 * A host the user named in the setting, as a URL names it (`Example.COM` →
 * `example.com`, `::1` → `[::1]`), or undefined when it is not a plain name
 * or address: a port, a path, a wildcard or a list is refused.
 */
export function widenedHost(entry: string): string | undefined {
  const given = entry.trim()
  if (given === '' || given.length > BROWSER_CHECK_HOST_MAX_CHARS) {
    return undefined
  }
  let url: URL
  try {
    url = new URL(`http://${isIPv6(given) ? `${IPV6_OPEN}${given}${IPV6_CLOSE}` : given}/`)
  } catch {
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

/** Where a URL the model asked for stands, before any card. */
export type BrowserUrlPlacement =
  | { readonly kind: 'refused' }
  | {
      /** Loopback; covered by the setting; or beyond both, so only a card may widen it. */
      readonly kind: 'local' | 'widened' | 'needsWidening'
      /** The URL as the browser will open it, its fragment kept (it is never sent). */
      readonly url: string
      /** Its host, as the rule compares hosts. */
      readonly host: string
      /** What an approval and an "always" rule are keyed on: the host and a port other than the default. */
      readonly approvalHost: string
    }

/**
 * The URL the model asked to open, checked against the rule: an absolute
 * `http:` or `https:` URL with a plain host and no user name or password.
 */
export function placeBrowserUrl(raw: string, extraHosts: ReadonlySet<string>): BrowserUrlPlacement {
  if (raw.length > BROWSER_CHECK_URL_MAX_CHARS) {
    return { kind: 'refused' }
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { kind: 'refused' }
  }
  const host = plainHost(url.hostname)
  if (
    host === undefined ||
    !PAGE_SCHEMES.has(url.protocol) ||
    url.username !== '' ||
    url.password !== ''
  ) {
    return { kind: 'refused' }
  }
  let kind: 'local' | 'widened' | 'needsWidening' = 'needsWidening'
  if (isLoopbackHost(host)) {
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
 * Whether a request the page makes may go out: an http(s) or ws(s) URL to
 * loopback or a host widened for this check. Anything else is blocked,
 * whatever scheme it uses.
 */
export function isAllowedRequest(rawUrl: string, allowedHosts: ReadonlySet<string>): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  return (
    NETWORK_SCHEMES.has(url.protocol) &&
    (isLoopbackHost(url.hostname) || allowedHosts.has(url.hostname))
  )
}

/** Whether a URL names a network scheme at all (http, https, ws, wss): what the page's lists report. */
export function isNetworkUrl(rawUrl: string): boolean {
  try {
    return NETWORK_SCHEMES.has(new URL(rawUrl).protocol)
  } catch {
    return false
  }
}
