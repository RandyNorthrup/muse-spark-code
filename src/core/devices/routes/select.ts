// Choosing how to reach a node (M110d lane X1, D90.8): the person's own
// route order decides, and every refusal says which legs were tried. An
// overlay address (RFC 6598's 100.64.0.0/10, shared with M100's lane T)
// always goes over the overlay; anything else follows the order.
import { isIPv4, isIPv6 } from 'node:net'
import * as z from 'zod/mini'

export const nodeRouteKinds = ['direct', 'relay', 'overlay', 'ssh'] as const
export const nodeRouteKindSchema = z.enum(nodeRouteKinds)
export type NodeRouteKind = z.infer<typeof nodeRouteKindSchema>

const OVERLAY_FIRST_OCTET = 100
const OVERLAY_SECOND_MIN = 64
const OVERLAY_SECOND_MAX = 127
const IPV4_LOOPBACK_OCTET = 127
const RFC1918_FIRST = 10
const RFC1918_SECOND = 172
const RFC1918_SECOND_MIN = 16
const RFC1918_SECOND_MAX = 31
const RFC1918_THIRD_FIRST = 192
const RFC1918_THIRD_SECOND = 168
const LINK_LOCAL_FIRST = 169
const LINK_LOCAL_SECOND = 254
const HEX = 16
const IPV6_LINK_LOCAL_MIN = 0xfe_80
const IPV6_LINK_LOCAL_MAX = 0xfe_bf
const IPV6_UNIQUE_LOCAL_MIN = 0xfc_00
const IPV6_UNIQUE_LOCAL_MAX = 0xfd_ff

/** True for RFC 6598's shared address space, 100.64.0.0/10. */
export function isOverlayAddress(address: string): boolean {
  if (!isIPv4(address)) return false
  const [first, second] = address.split('.', 2)
  const firstOctet = Number(first)
  const secondOctet = Number(second)
  return (
    firstOctet === OVERLAY_FIRST_OCTET &&
    Number.isSafeInteger(secondOctet) &&
    secondOctet >= OVERLAY_SECOND_MIN &&
    secondOctet <= OVERLAY_SECOND_MAX
  )
}

function isLocalIpv4(address: string): boolean {
  const [first, second] = address.split('.', 2)
  const firstOctet = Number(first)
  const secondOctet = Number(second)
  return (
    Number.isSafeInteger(secondOctet) &&
    (firstOctet === IPV4_LOOPBACK_OCTET ||
      firstOctet === RFC1918_FIRST ||
      (firstOctet === RFC1918_SECOND &&
        secondOctet >= RFC1918_SECOND_MIN &&
        secondOctet <= RFC1918_SECOND_MAX) ||
      (firstOctet === RFC1918_THIRD_FIRST && secondOctet === RFC1918_THIRD_SECOND) ||
      (firstOctet === LINK_LOCAL_FIRST && secondOctet === LINK_LOCAL_SECOND))
  )
}

function isLocalIpv6(address: string): boolean {
  const bare = address.split('%', 1)[0]
  if (bare === undefined || !isIPv6(bare)) return false
  if (bare === '::1') return true
  const [first] = bare.split(':', 1)
  if (first === undefined || first === '') return false
  const value = Number.parseInt(first, HEX)
  return (
    Number.isSafeInteger(value) &&
    ((value >= IPV6_LINK_LOCAL_MIN && value <= IPV6_LINK_LOCAL_MAX) ||
      (value >= IPV6_UNIQUE_LOCAL_MIN && value <= IPV6_UNIQUE_LOCAL_MAX))
  )
}

/**
True for addresses dialled directly: loopback, RFC 1918, link-local and
unique-local. Documentation, benchmark and other reserved ranges are not
diallable and go by relay, ssh or not at all.
*/
export function isNodeLocalAddress(address: string): boolean {
  if (isOverlayAddress(address)) return false
  return isIPv4(address) ? isLocalIpv4(address) : isLocalIpv6(address)
}

export interface NodeRouteAttempt {
  readonly kind: NodeRouteKind
  readonly address: string | undefined
}

export type NodeRouteDecision =
  | { readonly reachable: true; readonly attempt: NodeRouteAttempt }
  | {
      readonly reachable: false
      readonly tried: readonly NodeRouteAttempt[]
      readonly reason: string
    }

/* The first route in the person's order that has a leg: overlay wins for
 * overlay addresses, direct for anything diallable without help, then the
 * relay and ssh legs when the person has them. No order, no route. */
interface RouteLegs {
  readonly addresses: readonly string[]
  readonly relay: string | undefined
  readonly ssh: string | undefined
}

function legAddress(kind: NodeRouteKind, legs: RouteLegs): string | undefined {
  switch (kind) {
    case 'overlay': {
      return legs.addresses.find((candidate) => isOverlayAddress(candidate))
    }
    case 'direct': {
      return legs.addresses.find((candidate) => isNodeLocalAddress(candidate))
    }
    case 'relay': {
      return legs.relay
    }
    case 'ssh': {
      return legs.ssh
    }
  }
}

export function selectNodeRoute(options: {
  readonly addresses: readonly string[]
  readonly preference: readonly NodeRouteKind[]
  readonly relay: string | undefined
  readonly ssh: string | undefined
}): NodeRouteDecision {
  const tried: NodeRouteAttempt[] = []
  for (const kind of options.preference) {
    const address = legAddress(kind, options)
    if (address !== undefined) return { reachable: true, attempt: { kind, address } }
    tried.push({ kind, address: undefined })
  }
  const reason =
    options.preference.length === 0
      ? 'no route order is set'
      : `no route answered: ${tried.map((leg) => leg.kind).join(', ')}`
  return { reachable: false, tried, reason }
}
