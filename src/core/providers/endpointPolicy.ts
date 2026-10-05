// The endpoint policy (M95, PLAN.md D74): URL rules and the address
// classifier over M69's ranges. HTTPS only, with plain HTTP only to a
// loopback address (shown as "local"). No user information, query or
// fragment in an address. An HTTPS address on a private network asks once
// when it is saved and is recorded as private; link-local addresses and
// the cloud metadata addresses are refused. Each request checks the name's
// answers again, so a public provider whose name later resolves to a
// private or loopback address is refused. Pure: callers resolve names and
// pass the answers in.

import { BlockList, isIPv4, isIPv6 } from 'node:net'
import {
  ENDPOINT_LINK_LOCAL_RANGES,
  ENDPOINT_LOOPBACK_RANGES,
  ENDPOINT_PRIVATE_RANGES,
  ENDPOINT_UNSPECIFIED_RANGES,
} from '../../shared/constants'
import { isPublicAddress } from '../web/publicAddress'

/** What an address is, for the endpoint policy. */
export type EndpointAddressClass =
  'loopback' | 'private' | 'link-local' | 'metadata' | 'public' | 'unusable'

/** The cloud metadata hosts the threat model refuses (D74). */
export const METADATA_ADDRESSES: ReadonlySet<string> = new Set([
  '169.254.169.254',
  '168.63.129.16',
  'fd00:ec2::254',
])

// An IPv6 form carrying an IPv4 tail (`::ffff:1.2.3.4`) is judged by it.
const IPV4_TAIL_SEPARATOR = ':'

function buildList(
  ranges: readonly (readonly [string, number])[],
  family: 'ipv4' | 'ipv6',
): BlockList {
  const list = new BlockList()
  for (const [network, prefix] of ranges) {
    if ((family === 'ipv4') === isIPv4(network)) {
      list.addSubnet(network, prefix, family)
    }
  }
  return list
}

const v4Loopback = buildList(ENDPOINT_LOOPBACK_RANGES, 'ipv4')
const v4LinkLocal = buildList(ENDPOINT_LINK_LOCAL_RANGES, 'ipv4')
const v4Private = buildList(ENDPOINT_PRIVATE_RANGES, 'ipv4')
const v4Unspecified = buildList(ENDPOINT_UNSPECIFIED_RANGES, 'ipv4')
const v6Loopback = buildList(ENDPOINT_LOOPBACK_RANGES, 'ipv6')
const v6LinkLocal = buildList(ENDPOINT_LINK_LOCAL_RANGES, 'ipv6')
const v6Private = buildList(ENDPOINT_PRIVATE_RANGES, 'ipv6')
const v6Unspecified = buildList(ENDPOINT_UNSPECIFIED_RANGES, 'ipv6')

function classifyIpv4(address: string): EndpointAddressClass {
  if (v4Unspecified.check(address, 'ipv4')) {
    return 'unusable'
  }
  if (v4Loopback.check(address, 'ipv4')) {
    return 'loopback'
  }
  if (METADATA_ADDRESSES.has(address)) {
    return 'metadata'
  }
  if (v4LinkLocal.check(address, 'ipv4')) {
    return 'link-local'
  }
  if (v4Private.check(address, 'ipv4')) {
    return 'private'
  }
  return isPublicAddress(address) ? 'public' : 'unusable'
}

function classifyIpv6(address: string): EndpointAddressClass {
  // An IPv6 zone (`fe80::1%eth0`) names a local interface: never dialled.
  if (address.includes('%')) {
    return 'unusable'
  }
  const lower = address.toLowerCase()
  if (METADATA_ADDRESSES.has(lower)) {
    return 'metadata'
  }
  const tail = lower.slice(lower.lastIndexOf(IPV4_TAIL_SEPARATOR) + 1)
  if (tail.includes('.')) {
    return isIPv4(tail) ? classifyIpv4(tail) : 'unusable'
  }
  if (v6Unspecified.check(address, 'ipv6')) {
    return 'unusable'
  }
  if (v6Loopback.check(address, 'ipv6')) {
    return 'loopback'
  }
  if (v6LinkLocal.check(address, 'ipv6')) {
    return 'link-local'
  }
  if (v6Private.check(address, 'ipv6')) {
    return 'private'
  }
  return isPublicAddress(address) ? 'public' : 'unusable'
}

/**
 * What an IP address is for the endpoint policy. Anything that is not an
 * address at all is unusable. Metadata is checked before its block
 * (169.254.169.254 is link-local, fd00:ec2::254 is unique-local).
 */
export function classifyAddress(address: string): EndpointAddressClass {
  if (isIPv4(address)) {
    return classifyIpv4(address)
  }
  return isIPv6(address) ? classifyIpv6(address) : 'unusable'
}

/** Why an endpoint URL was refused, in plain words for the panel. */
export type EndpointRefusalReason =
  | 'unsupported-scheme'
  | 'has-userinfo'
  | 'has-query'
  | 'has-fragment'
  | 'http-off-loopback'
  | 'link-local'
  | 'metadata'
  | 'unusable-address'
  | 'mixed-answers'
  | 'invalid-url'

/** Where a saved endpoint lives. */
export type EndpointNetwork = 'local' | 'private' | 'public'

export type EndpointVerdict =
  | { readonly kind: 'ok'; readonly origin: string; readonly network: EndpointNetwork }
  | { readonly kind: 'confirm-private'; readonly origin: string }
  | { readonly kind: 'refused'; readonly reason: EndpointRefusalReason }

const HTTP_SCHEME = 'http:'
const HTTPS_SCHEME = 'https:'
const DEFAULT_PORTS: Readonly<Record<string, number>> = { 'http:': 80, 'https:': 443 }

/**
 * The origin (`scheme://host[:port]`) a credential binds to: the scheme and
 * host lowercased, a default port dropped. Undefined for an invalid URL or
 * one with user information, a query or a fragment.
 */
export function originOf(urlText: string): string | undefined {
  let url: URL
  try {
    url = new URL(urlText)
  } catch {
    return undefined
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    return undefined
  }
  const port =
    url.port === '' || Number(url.port) === DEFAULT_PORTS[url.protocol] ? '' : `:${url.port}`
  return `${url.protocol}//${url.hostname.toLowerCase()}${port}`
}

function refusal(reason: EndpointRefusalReason): EndpointVerdict {
  return { kind: 'refused', reason }
}

/**
 * Check an endpoint URL against the resolved answers for its name (an
 * IP-literal host is its own single answer). HTTPS only, except to
 * loopback; no userinfo, query or fragment; link-local, metadata and
 * unusable answers refused; a public name resolving to anything but public
 * refused; an all-private HTTPS address asks once (`confirm-private`).
 */
export function checkEndpointUrl(urlText: string, answers: readonly string[]): EndpointVerdict {
  let url: URL
  try {
    url = new URL(urlText)
  } catch {
    return refusal('invalid-url')
  }
  if (url.protocol !== HTTP_SCHEME && url.protocol !== HTTPS_SCHEME) {
    return refusal('unsupported-scheme')
  }
  if (url.username !== '' || url.password !== '') {
    return refusal('has-userinfo')
  }
  if (url.search !== '') {
    return refusal('has-query')
  }
  if (url.hash !== '') {
    return refusal('has-fragment')
  }
  const origin = originOf(urlText)
  if (origin === undefined) {
    return refusal('invalid-url')
  }
  if (answers.length === 0) {
    return refusal('unusable-address')
  }
  const classes = answers.map((answer) => classifyAddress(answer))
  if (classes.includes('metadata')) {
    return refusal('metadata')
  }
  if (classes.includes('link-local')) {
    return refusal('link-local')
  }
  if (classes.includes('unusable')) {
    return refusal('unusable-address')
  }
  if (classes.every((candidate) => candidate === 'loopback')) {
    return { kind: 'ok', origin, network: 'local' }
  }
  if (classes.includes('loopback')) {
    // One answer is loopback and another is not: the name points two ways.
    return refusal('mixed-answers')
  }
  if (url.protocol !== HTTPS_SCHEME) {
    return refusal('http-off-loopback')
  }
  if (classes.every((candidate) => candidate === 'private')) {
    return { kind: 'confirm-private', origin }
  }
  if (classes.every((candidate) => candidate === 'public')) {
    return { kind: 'ok', origin, network: 'public' }
  }
  // A public name with a private answer (or the reverse): refused, so a
  // provider whose DNS later aims inside is never called.
  return refusal('mixed-answers')
}

/**
 * Re-check a saved endpoint's answers before a request (the transport does
 * this every time): `ok` only while every answer is still diallable and in
 * the saved network. A private network saved after its one question stays
 * usable; anything that moved (rebinding, a new link-local or metadata
 * answer) refuses.
 */
export function verifyRequestAnswers(
  saved: EndpointNetwork,
  answers: readonly string[],
): { readonly ok: true } | { readonly ok: false; readonly reason: EndpointRefusalReason } {
  if (answers.length === 0) {
    return { ok: false, reason: 'unusable-address' }
  }
  const classes = answers.map((answer) => classifyAddress(answer))
  if (classes.includes('metadata')) {
    return { ok: false, reason: 'metadata' }
  }
  if (classes.includes('link-local')) {
    return { ok: false, reason: 'link-local' }
  }
  if (classes.includes('unusable')) {
    return { ok: false, reason: 'unusable-address' }
  }
  const wanted = saved === 'local' ? 'loopback' : saved
  return classes.every((candidate) => candidate === wanted)
    ? { ok: true }
    : { ok: false, reason: 'mixed-answers' }
}
