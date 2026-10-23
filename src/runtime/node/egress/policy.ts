// D90.5's egress policy (M110b W1): what a sandbox may reach. Names
// match the workspace allowlist (exact, or `*.domain` for anything
// below it — never the apex itself, as with certificates); the cloud
// metadata addresses are blocked on every host whatever the policy;
// every DNS answer passes the metadata check and D74's address checks
// (NAT64-aware), and any failure refuses the connection whole — a
// rebinding setup mixes answers. New connections are rate limited only
// at the rate the person sets, none by default. Pure: the server owns
// sockets, DNS and the audit sink.
import { ADDRESS_FAMILIES, MILLISECONDS_PER_SECOND } from '../../../shared/constants'
import { addressFamily, isPublicAddress, type Nat64Prefix } from '../../../core/web/publicAddress'

/** The workspace's egress policy: the allowlist, and the person's rate. */
export interface EgressPolicy {
  /** Allowed names: exact, or `*.domain` for anything below the domain. */
  readonly allow: readonly string[]
  /** New outbound connections per second; undefined is unlimited. */
  readonly maxNewPerSecond?: number
}

/** What the network's NAT64 discovery answered (RFC 7050). */
export interface EgressNat64 {
  readonly isKnown: boolean
  readonly prefixes: readonly Nat64Prefix[]
}

function cleanName(host: string): string {
  return host.toLowerCase().replace(/\.$/, '')
}

/**
Split a CONNECT authority into host and port: `host:port`,
`[v6]:port`. Anything else (no port, bad port, unbalanced brackets)
is refused, never defaulted.
*/
export function parseConnectTarget(authority: string): { host: string; port: number } | undefined {
  const split = authority.startsWith('[') ? splitBracketed(authority) : splitBare(authority)
  if (split === undefined || split.host.length === 0 || !/^[0-9]+$/.test(split.portText)) {
    return undefined
  }
  const port = Number(split.portText)
  return port < 1 || port > MAX_PORT ? undefined : { host: split.host, port }
}

function splitBracketed(authority: string): { host: string; portText: string } | undefined {
  const close = authority.indexOf(']')
  if (close === -1) return undefined
  const rest = authority.slice(close + 1)
  return rest.startsWith(':')
    ? { host: authority.slice(1, close), portText: rest.slice(1) }
    : undefined
}

function splitBare(authority: string): { host: string; portText: string } | undefined {
  const colon = authority.lastIndexOf(':')
  return colon === -1
    ? undefined
    : { host: authority.slice(0, colon), portText: authority.slice(colon + 1) }
}

/**
Whether the host is allowlisted. IP literals match exactly only —
wildcards never match addresses. An empty allowlist allows nothing.
*/
export function isNameAllowed(policy: EgressPolicy, host: string): boolean {
  const name = cleanName(host)
  const isLiteral = addressFamily(name) !== undefined
  for (const entry of policy.allow) {
    const rule = cleanName(entry)
    if (rule.startsWith('*.')) {
      const suffix = rule.slice(1)
      if (!isLiteral && name.endsWith(suffix) && name.length > suffix.length) return true
    } else if (name === rule) {
      return true
    }
  }
  return false
}

/** The cloud metadata addresses, blocked on every host whatever the policy. */
const METADATA_IPV4 = '169.254.169.254'
const METADATA_IPV6 = 'fd00:ec2::254'

const IPV4_OCTET_SPACE = 256
const IPV4_OCTET_MAX = 255
const IPV4_OCTET_SHIFT = 8
const IPV4_PART_COUNT = 4
const IPV6_GROUP_COUNT = 8
const HEX_DIGITS_PER_GROUP = 4
const HEX_RADIX = 16
const MAX_PORT = 65_535

/** One dotted-quad tail as two hextets; undefined when not a quad. */
function dottedGroups(part: string): string[] | undefined {
  if (!part.includes('.')) return [part]
  const bytes = part.split('.')
  if (bytes.length !== IPV4_PART_COUNT || bytes.some((byte) => !/^[0-9]+$/.test(byte))) {
    return undefined
  }
  const numbers = bytes.map(Number)
  if (numbers.some((number) => number > IPV4_OCTET_MAX)) return undefined
  return [
    ((numbers[0] ?? 0) * IPV4_OCTET_SPACE + (numbers[1] ?? 0)).toString(HEX_RADIX),
    ((numbers[2] ?? 0) * IPV4_OCTET_SPACE + (numbers[3] ?? 0)).toString(HEX_RADIX),
  ]
}

/** Expand an IPv6 literal to full lowercase form; undefined when not IPv6. */
export function expandIpv6(ip: string): string | undefined {
  const zone = ip.indexOf('%')
  const bare = (zone === -1 ? ip : ip.slice(0, zone)).toLowerCase()
  const halves = bare.split('::')
  if (halves.length > 2) return undefined
  const parse = (side: string | undefined): string[] | undefined => {
    if (side === undefined || side === '') return []
    const groups: string[] = []
    for (const part of side.split(':')) {
      const expanded = dottedGroups(part)
      if (expanded === undefined) return undefined
      groups.push(...expanded)
    }
    return groups
  }
  const head = parse(halves[0])
  const tail = halves.length === 1 ? [] : parse(halves[1])
  if (head === undefined || tail === undefined) return undefined
  if (halves.length === 1 && head.length !== IPV6_GROUP_COUNT) return undefined
  if (head.length + tail.length > IPV6_GROUP_COUNT) return undefined
  const full = [
    ...head,
    ...Array.from({ length: IPV6_GROUP_COUNT - head.length - tail.length }, () => '0'),
    ...tail,
  ]
  return full.some((group) => !/^[0-9a-f]{1,4}$/.test(group))
    ? undefined
    : full.map((group) => group.padStart(HEX_DIGITS_PER_GROUP, '0')).join(':')
}

function octetOf(value: number, shift: number): number {
  return (value >> shift) & IPV4_OCTET_MAX
}

function unmapIpv4(ip: string): string {
  const expanded = expandIpv6(ip)
  if (expanded === undefined) return ip
  const prefix = '0000:0000:0000:0000:0000:ffff:'
  if (!expanded.startsWith(prefix)) return expanded
  const tail = expanded.slice(prefix.length).split(':')
  if (tail.length !== 2) return expanded
  const high = Number.parseInt(tail[0] ?? '', HEX_RADIX)
  const low = Number.parseInt(tail[1] ?? '', HEX_RADIX)
  const parts = [
    octetOf(high, IPV4_OCTET_SHIFT),
    octetOf(high, 0),
    octetOf(low, IPV4_OCTET_SHIFT),
    octetOf(low, 0),
  ]
  return parts.map(String).join('.')
}

/**
Whether the address is a cloud metadata address. Answer IPs arrive
resolver-canonical from the server; literals are normalized
defensively (brackets, zones, case, mapped forms) before comparing.
*/
export function isMetadataIp(ip: string): boolean {
  const bare = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip
  const zone = bare.indexOf('%')
  const clean = (zone === -1 ? bare : bare.slice(0, zone)).toLowerCase()
  if (clean === METADATA_IPV4) return true
  const expandedMetadata = expandIpv6(METADATA_IPV6)
  return unmapIpv4(clean) === METADATA_IPV4 || expandIpv6(clean) === expandedMetadata
}

/** A new-connection rate bucket: full at start, refilled by the clock. */
export interface RateState {
  readonly tokens: number
  readonly lastMono: number
}

export function initialRate(maxPerSecond: number, nowMono: number): RateState {
  return { tokens: maxPerSecond, lastMono: nowMono }
}

/**
Spend one new connection: unlimited without the person's rate,
fail-closed at zero or below, otherwise the bucket decides. Pure: the
server keeps the state per sandbox.
*/
export function checkRate(
  maxPerSecond: number | undefined,
  state: RateState,
  nowMono: number,
): { readonly ok: boolean; readonly state: RateState } {
  if (maxPerSecond === undefined) return { ok: true, state }
  if (maxPerSecond <= 0) return { ok: false, state }
  const elapsedMs = Math.max(0, nowMono - state.lastMono)
  const tokens = Math.min(
    maxPerSecond,
    state.tokens + (elapsedMs * maxPerSecond) / MILLISECONDS_PER_SECOND,
  )
  return tokens < 1
    ? { ok: false, state: { tokens, lastMono: nowMono } }
    : { ok: true, state: { tokens: tokens - 1, lastMono: nowMono } }
}

export type UsableAnswers =
  | { readonly ok: true; readonly usable: readonly string[] }
  | {
      readonly ok: false
      readonly reason: 'metadata' | 'private-address' | 'nat64-unknown'
      readonly address: string
    }

/**
The addresses a connection may use, once every answer is checked: any
metadata or non-public answer refuses the connection whole, and without
a known NAT64 answer only IPv4 answers are used (an IPv6 answer may
carry any IPv4 address under a prefix nobody named).
*/
export function selectUsableAnswers(
  answers: readonly [string, ...string[]],
  nat64: EgressNat64,
): UsableAnswers {
  for (const answer of answers) {
    if (isMetadataIp(answer)) return { ok: false, reason: 'metadata', address: answer }
  }
  const prefixes = nat64.isKnown ? nat64.prefixes : []
  const blocked = answers.find((answer) => !isPublicAddress(answer, prefixes))
  if (blocked !== undefined) return { ok: false, reason: 'private-address', address: blocked }
  if (!nat64.isKnown) {
    const usable = answers.filter((answer) => addressFamily(answer) === ADDRESS_FAMILIES.ipv4)
    return usable.length === 0
      ? { ok: false, reason: 'nat64-unknown', address: answers[0] }
      : { ok: true, usable }
  }
  return { ok: true, usable: answers }
}
