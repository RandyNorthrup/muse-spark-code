// The window's web fetch (M69, PLAN.md D49): the core fetch over this
// machine's resolver and the pinned HTTPS transport, shared by the Model API
// backend's `web_fetch` and the `ide` server's `webFetch` for Muse Code. The
// log names the host and the outcome only: a path or a query can carry
// what the conversation put there.

import { randomBytes } from 'node:crypto'
import { ADDRCONFIG } from 'node:dns'
import { lookup } from 'node:dns/promises'
import type { HtmlConverter } from '../../core/web/htmlConversion'
import { fetchWebPage, type WebFetcher, type WebFetchResult } from '../../core/web/webFetch'
import { WEB_FETCH_MARKER_BYTES } from '../../shared/constants'
import type { Logger } from '../logger'
import { discoverNat64, NAT64_LOOKUPS, type Nat64Lookups } from './nat64'
import { pinnedHttpsRequest } from './pinnedRequest'

/**
Every address the name resolves to, as the operating system's resolver
answers a connection's lookup (Node's `net` asks with ADDRCONFIG: no IPv6
answers on a machine without an IPv6 address), in its order.
*/
async function resolveAll(host: string): Promise<readonly string[]> {
  const answers = await lookup(host, { all: true, order: 'verbatim', hints: ADDRCONFIG })
  return answers.map((answer) => answer.address)
}

/**
The URL's host for the log. Only the URL parser's own malformed-input
failure (`TypeError`) reads as "not a URL"; anything else still throws.
*/
export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch (error: unknown) {
    if (error instanceof TypeError) return '(not a URL)'
    throw error
  }
}

function outcomeOf(result: WebFetchResult): string {
  switch (result.kind) {
    case 'page': {
      const { page } = result
      return `HTTP ${String(page.status)}, ${page.type}, ${String(page.bytes)} bytes`
    }
    case 'moved': {
      return `redirected to another host (${hostOf(result.location)}); handed back to the model`
    }
    case 'failed': {
      return `refused or failed: ${result.failure.kind}`
    }
  }
}

/**
The window's fetch: `convertHtml` turns an HTML page into Markdown apart
from the extension host (pageConverter.ts).
*/
export function createWebFetcher(
  log: Logger,
  convertHtml: HtmlConverter,
  nat64Lookups: Nat64Lookups = NAT64_LOOKUPS,
  rawTextLimit?: number,
): WebFetcher {
  return async (url, signal, isStillAllowed) => {
    const result = await fetchWebPage(
      url,
      {
        ...(rawTextLimit !== undefined && { rawTextLimit }),
        resolve: resolveAll,
        nat64: async () => await discoverNat64(nat64Lookups, log),
        request: pinnedHttpsRequest,
        convertHtml,
        newMarker: () => randomBytes(WEB_FETCH_MARKER_BYTES).toString('hex'),
        // D121: a page answers, or Stop ends the wait; the wait says so.
        notice: (text) => {
          log.info(text)
        },
      },
      signal,
      isStillAllowed,
    )
    log.info(`Web fetch from ${hostOf(url)}: ${outcomeOf(result)}`)
    return result
  }
}
