// An M91 http hook's POST (PLAN.md D70, lane H): the bounded hook payload
// to its allowlisted URL, through the pinned-request path
// (pinnedRequest.ts): HTTPS to the pinned address, the page's own name in
// TLS and the `Host` header, no redirect followed, fixed headers only. No
// second HTTP stack; no credential name ever becomes a header.
//
// Guards (user scope, HTTPS, allowlist, posture) already ran in
// hookHandlers.ts; the scheme is checked again here, so a mistaken caller
// cannot send plain HTTP.

import { Buffer } from 'node:buffer'
import { lookup } from 'node:dns/promises'
import type { HookHttpResult } from '../../core/backends/modelapi/hookHandlers'
import { addressFamily } from '../../core/web/publicAddress'
import type { PinnedTarget } from '../../core/web/webFetch'
import { HOOK_OUTPUT_MAX_BYTES, WEB_FETCH_USER_AGENT } from '../../shared/constants'
import { pinnedPostRequest, type RequestFunction } from './pinnedRequest'

/** What the POST needs beyond the URL and the payload. */
export interface HookHttpRequestDeps {
  /** Every address the name resolves to, from this machine's resolver. */
  readonly resolve?: ((host: string) => Promise<readonly string[]>) | undefined
  /** Node's `https.request`, or a test's stand-in with the same shape. */
  readonly request?: RequestFunction | undefined
  /** Off only for the tests' plain loopback server. */
  readonly isTlsRequired?: boolean | undefined
}

async function resolveAll(host: string): Promise<readonly string[]> {
  const found = await lookup(host, { all: true })
  return found.map((entry) => entry.address)
}

/** The bounded answer body as text; the connection is always let go. */
async function readBounded(
  body: AsyncIterable<Uint8Array | string>,
  close: () => void,
  signal: AbortSignal,
): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  try {
    for await (const chunk of body) {
      signal.throwIfAborted()
      const data = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      const room = HOOK_OUTPUT_MAX_BYTES - bytes
      if (room <= 0) {
        break
      }
      const taken = data.subarray(0, room)
      chunks.push(Buffer.from(taken))
      bytes += taken.length
      if (data.length > room) {
        break
      }
    }
  } finally {
    close()
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * POSTs the payload and answers with the first response's status, headers
 * and bounded body. Tries each resolved address in order; an HTTP answer,
 * whatever its status, ends the tries. Rejects when nothing resolves, no
 * address connects, or the signal aborts.
 */
export async function postHookPayload(
  url: string,
  payload: string,
  signal: AbortSignal,
  deps: HookHttpRequestDeps = {},
): Promise<HookHttpResult> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && deps.isTlsRequired !== false) {
    throw new Error('http hooks call HTTPS urls only')
  }
  const host = parsed.hostname.replaceAll(/^\[|\]$/g, '')
  const resolve = deps.resolve ?? resolveAll
  signal.throwIfAborted()
  const addresses = await resolve(host)
  signal.throwIfAborted()
  if (addresses.length === 0) {
    throw new Error(`http hook host did not resolve: ${host}`)
  }
  let lastError: unknown = new Error(`http hook host is unreachable: ${host}`)
  for (const address of addresses) {
    const family = addressFamily(address)
    if (family === undefined) throw new TypeError('Invalid hook HTTP address')
    const target: PinnedTarget = { url: parsed, host, address, family }
    try {
      const response = await pinnedPostRequest(
        target,
        payload,
        {
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': WEB_FETCH_USER_AGENT,
        },
        signal,
        () => {
          // The turn already waits on the hook's own timeout.
        },
        deps.request,
        deps.isTlsRequired ?? true,
      )
      const bodyText = await readBounded(
        response.body,
        () => {
          response.close()
        },
        signal,
      )
      return { status: response.status, headers: response.headers, bodyText }
    } catch (error: unknown) {
      signal.throwIfAborted()
      lastError = error
    }
  }
  throw lastError
}
