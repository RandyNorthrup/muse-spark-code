// The first checks on a URL web fetch is asked to read (M69, PLAN.md D49,
// the M44b design), before any lookup or approval: an absolute `https:` URL
// of a reasonable length, no user name or password, a host that is neither
// a local or reserved name nor a non-public IP address. The WHATWG parser
// normalises the host first (`0x7f.1` and `2130706433` become `127.0.0.1`,
// an IDN becomes punycode), so every spelling of a host is judged the same.
// The name's DNS answers are checked later, when the fetch pins one (see
// webFetch.ts). Pure.

import { WEB_FETCH_RESERVED_NAMES, WEB_FETCH_URL_MAX_CHARS } from '../../shared/constants'
import { type WebFetchFailure, webFetchFailure } from './fetchFailure'
import { addressFamily, isPublicAddress } from './publicAddress'

const HTTPS = 'https:'
const IPV6_OPEN = '['
const IPV6_CLOSE = ']'
const LABEL_SEPARATOR = '.'

/** A URL that passed the checks, with its host as a lookup or a connection names it. */
export interface CheckedPageUrl {
  readonly ok: true
  /** The URL, its fragment dropped (it is never sent). */
  readonly url: URL
  /** The host without IPv6 brackets or a trailing dot: a name or an address. */
  readonly host: string
  /** The host's address when the URL names one; undefined for a name to look up. */
  readonly address: string | undefined
}

export type PageUrlCheck =
  CheckedPageUrl | { readonly ok: false; readonly failure: WebFetchFailure }

function refused(failure: WebFetchFailure): PageUrlCheck {
  return { ok: false, failure }
}

/**
 * The host as a lookup takes it: `[::1]` → `::1`, and every trailing dot
 * dropped (`example.com.` and `localhost..` → `example.com`, `localhost`),
 * so no spelling slips past the reserved-name check.
 */
function bareHost(hostname: string): string {
  if (hostname.startsWith(IPV6_OPEN) && hostname.endsWith(IPV6_CLOSE)) {
    return hostname.slice(1, -1)
  }
  let end = hostname.length
  while (end > 0 && hostname[end - 1] === LABEL_SEPARATOR) {
    end -= 1
  }
  return hostname.slice(0, end)
}

/** A name with an empty label (`a..b`, or nothing left): not a name DNS can hold. */
function hasEmptyLabel(host: string): boolean {
  return host.split(LABEL_SEPARATOR).includes('')
}

/** A single-label name, or one under a local or reserved name (RFC 6761 and others). */
function isReservedName(host: string): boolean {
  return (
    !host.includes(LABEL_SEPARATOR) ||
    WEB_FETCH_RESERVED_NAMES.some(
      (name) => host === name || host.endsWith(`${LABEL_SEPARATOR}${name}`),
    )
  )
}

export function checkPageUrl(raw: string): PageUrlCheck {
  if (raw.length > WEB_FETCH_URL_MAX_CHARS) {
    return refused(webFetchFailure('urlTooLong'))
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return refused(webFetchFailure('invalidUrl'))
  }
  if (url.protocol !== HTTPS) {
    return refused(webFetchFailure('notHttps'))
  }
  if (url.username !== '' || url.password !== '') {
    return refused(webFetchFailure('credentials'))
  }
  url.hash = ''
  const host = bareHost(url.hostname.toLowerCase())
  if (addressFamily(host) === undefined) {
    if (hasEmptyLabel(host)) {
      return refused(webFetchFailure('invalidUrl'))
    }
    return isReservedName(host)
      ? refused(webFetchFailure('reservedHost', { host }))
      : { ok: true, url, host, address: undefined }
  }
  return isPublicAddress(host)
    ? { ok: true, url, host, address: host }
    : refused(webFetchFailure('privateAddress', { host, address: host }))
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
