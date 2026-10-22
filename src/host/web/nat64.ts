// Shared DNS64 discovery for web fetch and the browser proxy. Kept apart from
// the web-fetch transport so its model text stays in its lazy bundle (D6).
import { lookup, Resolver } from 'node:dns/promises'
import { nat64PrefixesOf } from '../../core/publicAddress'
import type { Nat64Discovery } from '../../core/web/webFetch'
import type { Logger } from '../logger'
import {
  ADDRESS_FAMILIES,
  NAT64_ABSENT_CODES,
  NAT64_DISCOVERY_NAME,
  NAT64_DISCOVERY_TIMEOUT_MS,
  NAT64_DISCOVERY_TRIES,
} from '../../shared/constants'

/**
 * The two ways `ipv4only.arpa`'s AAAA answers are asked for (RFC 7050):
 * the operating system's resolver, as the page's name was looked up, which
 * returns what a DNS64 in its path synthesized; and a DNS query of its own
 * (c-ares), whose NXDOMAIN or NODATA is the only proof that no AAAA record
 * exists. getaddrinfo's failure proves nothing: Node documents that its
 * ENOTFOUND may stand for other failures of the lookup.
 */
export interface Nat64Lookups {
  readonly system: () => Promise<readonly string[]>
  readonly dns: () => Promise<readonly string[]>
}

async function lookupSystem(): Promise<readonly string[]> {
  const answers = await lookup(NAT64_DISCOVERY_NAME, { all: true, family: ADDRESS_FAMILIES.ipv6 })
  return answers.map((answer) => answer.address)
}

async function queryDns(): Promise<readonly string[]> {
  const resolver = new Resolver({
    timeout: NAT64_DISCOVERY_TIMEOUT_MS,
    tries: NAT64_DISCOVERY_TRIES,
  })
  return await resolver.resolve6(NAT64_DISCOVERY_NAME)
}

export const NAT64_LOOKUPS: Nat64Lookups = { system: lookupSystem, dns: queryDns }

function codeOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : 'error'
}

function answersOf(outcome: PromiseSettledResult<readonly string[]>): readonly string[] {
  return outcome.status === 'fulfilled' ? outcome.value : []
}

function outcomeText(outcome: PromiseSettledResult<readonly string[]>): string {
  return outcome.status === 'fulfilled' ? 'no answer' : codeOf(outcome.reason)
}

/**
 * The network's NAT64 prefixes (RFC 7050), from the answers either lookup
 * returned. With none, only the DNS query's NXDOMAIN or NODATA means no
 * DNS64; any other outcome (a timeout, SERVFAIL, a refusal, no servers
 * found), or answers that carry no RFC 6052 prefix, leave NAT64 unknown,
 * and the fetch then uses no IPv6 answer, since any could carry a private
 * address.
 */
export async function discoverNat64(
  lookups: Nat64Lookups,
  log: Pick<Logger, 'info' | 'trace'>,
): Promise<Nat64Discovery> {
  const [system, dns] = await Promise.allSettled([lookups.system(), lookups.dns()])
  const answers = [...answersOf(system), ...answersOf(dns)]
  if (answers.length > 0) {
    const prefixes = nat64PrefixesOf(answers)
    if (prefixes.length > 0) {
      return { isKnown: true, prefixes }
    }
    const shown = answers.join(', ')
    log.info(
      `Web fetch: ${NAT64_DISCOVERY_NAME} answered ${shown}, which carries no NAT64 prefix; IPv6 answers are not used`,
    )
    return { isKnown: false, detail: `${NAT64_DISCOVERY_NAME}: ${shown}` }
  }
  const outcome = `${NAT64_DISCOVERY_NAME}: DNS ${outcomeText(dns)}, system ${outcomeText(system)}`
  if (dns.status === 'rejected' && NAT64_ABSENT_CODES.has(codeOf(dns.reason))) {
    log.trace(`Web fetch: no NAT64 prefix (${outcome})`)
    return { isKnown: true, prefixes: [] }
  }
  log.info(`Web fetch: NAT64 discovery failed (${outcome}); IPv6 answers are not used`)
  return { isKnown: false, detail: outcome }
}
