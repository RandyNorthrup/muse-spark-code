import { describe, expect, it } from 'vitest'
import type { HtmlConversion } from '../../src/core/web/htmlConversion'
import { createWebFetcher, discoverNat64, type Nat64Lookups } from '../../src/host/web/webFetcher'
import { FakeLogOutputChannel } from './helpers/fakes'
import { logLines } from './helpers/logText'

const NSP_ANSWER = '2a01:4f8:c0c:1234:c0:0:aa00:0'
const NSP_PREFIX = { prefix: 0x2a_01_04_f8_0c_0c_12_34n, length: 64 }

/** A converter these tests never reach: their pages are refused before any is read. */
function unused(): Promise<HtmlConversion> {
  return Promise.resolve({ ok: false, kind: 'failed', detail: 'not reached' })
}

/** A lookup that answers the list, or fails with the error code. */
function settle(outcome: readonly string[] | string): () => Promise<readonly string[]> {
  return () =>
    typeof outcome === 'string' ? Promise.reject(lookupError(outcome)) : Promise.resolve(outcome)
}

/** Both lookups: an answer list, or the error code they fail with. */
function lookups(
  system: readonly string[] | string,
  dns: readonly string[] | string,
): Nat64Lookups {
  return { system: settle(system), dns: settle(dns) }
}

describe("the window's web fetch (M69)", () => {
  it('logs the host and the outcome, never the path or the query', async () => {
    const log = new FakeLogOutputChannel()
    const fetchPage = createWebFetcher(log, unused, lookups('ENOTFOUND', 'ENODATA'))
    const result = await fetchPage(
      'https://localhost:8443/private/path?token=abc',
      new AbortController().signal,
    )
    expect(result).toMatchObject({ kind: 'failed', failure: { kind: 'reservedHost' } })
    await fetchPage('not a url', new AbortController().signal)
    expect(logLines(log)).toEqual([
      'Web fetch from localhost:8443: refused or failed: reservedHost',
      'Web fetch from (not a URL): refused or failed: invalidUrl',
    ])
  })

  it("reads the network's NAT64 prefix from either lookup's answers", async () => {
    const log = new FakeLogOutputChannel()
    const known = { isKnown: true, prefixes: [NSP_PREFIX] }
    // The system's resolver synthesizes it even when the DNS query's server does not.
    expect(await discoverNat64(lookups([NSP_ANSWER], 'ENODATA'), log)).toEqual(known)
    expect(await discoverNat64(lookups('ENOTFOUND', [NSP_ANSWER]), log)).toEqual(known)
  })

  it("takes only the DNS query's NXDOMAIN or NODATA as no DNS64", async () => {
    const log = new FakeLogOutputChannel()
    for (const code of ['ENODATA', 'ENOTFOUND']) {
      expect(await discoverNat64(lookups('ENOTFOUND', code), log)).toEqual({
        isKnown: true,
        prefixes: [],
      })
    }
    expect(logLines(log).at(0)).toBe(
      'Web fetch: no NAT64 prefix (ipv4only.arpa: DNS ENODATA, system ENOTFOUND)',
    )
  })

  it('leaves NAT64 unknown, never absent, on any other outcome', async () => {
    const log = new FakeLogOutputChannel()
    // getaddrinfo's ENOTFOUND proves nothing: Node documents it for other failures too.
    for (const code of ['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED', 'EREFUSED', 'EAI_AGAIN']) {
      expect(await discoverNat64(lookups('ENOTFOUND', code), log)).toEqual({
        isKnown: false,
        detail: `ipv4only.arpa: DNS ${code}, system ENOTFOUND`,
      })
    }
    // A DNS query that returned nothing without saying why.
    expect(await discoverNat64(lookups('ENOTFOUND', []), log)).toMatchObject({ isKnown: false })
    // Answers that carry neither of ipv4only.arpa's IPv4 addresses.
    expect(await discoverNat64(lookups(['2001:db8::1'], 'ENODATA'), log)).toEqual({
      isKnown: false,
      detail: 'ipv4only.arpa: 2001:db8::1',
    })
    expect(logLines(log).at(0)).toBe(
      'Web fetch: NAT64 discovery failed (ipv4only.arpa: DNS ETIMEOUT, system ENOTFOUND); IPv6 answers are not used',
    )
  })
})

function lookupError(code: string): Error {
  return Object.assign(new Error(`query ${code} ipv4only.arpa`), { code })
}
