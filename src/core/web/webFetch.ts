// Web fetch (M69, PLAN.md D49, the network-safety design of M44b): one
// public HTTPS page, read by the extension from the user's machine, for the
// model on either backend. Each hop of the fetch:
//
// - checks the URL (pageUrl.ts): `https:` only, no credentials, no local or
//   reserved name, no non-public address;
// - resolves the name here and refuses it when any answer is not a public
//   address (an answer under the network's NAT64 prefix is judged by the IPv4
//   address it carries; while that prefix cannot be learned, no IPv6 answer
//   is used, since any could carry a private address), then PINS the checked
//   answers: the request goes to
//   one of those addresses (TLS still verifies the name), so no second lookup
//   can move it into the user's network. They are tried as RFC 8305 says: the
//   next starts when the one before has not connected within
//   WEB_FETCH_ATTEMPT_DELAY_MS, the first to connect wins. Through a proxy,
//   the proxy is asked for that address too (src/host/web/pinnedRequest.ts);
// - follows a redirect on the same host, checked, resolved and pinned
//   again, at most WEB_FETCH_MAX_REDIRECTS times; a redirect to another host
//   is handed back to the model, which asks again (each host is approved on
//   its own);
// - reads at most WEB_FETCH_MAX_BYTES of an allowed content type within
//   WEB_FETCH_TIMEOUT_MS, then turns HTML into Markdown and leaves text as
//   it is.
//
// What the model receives marks the page as untrusted data between markers
// the page cannot know; text the server chose (a redirect's URL, the title)
// stays inside them, and what is said outside them is the extension's own,
// naming a server's type or coding only when it is a short token. Nothing
// here is billed: the fetch is the extension's own, not Meta's paid search.
// The transport and the resolver are the host's; this module decides.

import { Buffer } from 'node:buffer'
import { pipeline, Readable, type Transform } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import * as z from 'zod/mini'
import {
  type AddressFamily,
  ADDRESS_FAMILIES,
  HTTP_PROXY_AUTHENTICATION_REQUIRED,
  HTTP_REDIRECT_STATUSES,
  HTTP_SUCCESS_MAX,
  HTTP_SUCCESS_MIN,
  MODEL_TEXT,
  UI_TEXT,
  WEB_FETCH_ATTEMPT_DELAY_MS,
  WEB_FETCH_CONVERT_MAX_CHARS,
  WEB_FETCH_DETAIL_MAX_CHARS,
  WEB_FETCH_HTML_TYPES,
  WEB_FETCH_MAX_BYTES,
  WEB_FETCH_MAX_CONTENT_CHARS,
  WEB_FETCH_MAX_REDIRECTS,
  WEB_FETCH_NOT_TLS_CODE,
  WEB_FETCH_TEXT_TYPES,
  WEB_FETCH_TIMEOUT_MS,
  WEB_FETCH_XHTML_TYPE,
  WEB_FETCH_TOKEN_MAX_CHARS,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { describeNetworkFailure, networkFailureCodes } from '../networkFailure'
import {
  type FailureFacts,
  redirectRefused,
  type WebFetchFailure,
  type WebFetchFailureKind,
  webFetchFailure,
} from './fetchFailure'
import type { HtmlConversionFailure, HtmlConverter } from './htmlConversion'
import { mimeParameter } from './mimeType'
import { decodeWithBom, encodingOf, UndecodableText } from './textDecoding'
import { approvalHost, type CheckedPageUrl, checkPageUrl } from './pageUrl'
import { addressFamily, isPublicAddress, type Nat64Prefix } from './publicAddress'

/** Where one request goes: the URL as sent, and the address it is pinned to. */
export interface PinnedTarget {
  readonly url: URL
  /** The URL's host: the name TLS verifies and the `Host` header carries. */
  readonly host: string
  /** The checked public address the connection is made to. */
  readonly address: string
  readonly family: AddressFamily
}

/** A response as the transport hands it over, its body not yet read. */
export interface PinnedResponse {
  readonly status: number
  /** Header names in lower case; a repeated header's values joined with `, `. */
  readonly headers: Readonly<Record<string, string | undefined>>
  readonly body: AsyncIterable<Uint8Array>
  /** Lets the connection go without reading the rest of the body. */
  close(): void
}

/**
 * What NAT64 discovery (RFC 7050) learned: the network's prefixes (none where
 * no DNS64 answers), or that it could not tell, and why.
 */
export type Nat64Discovery =
  | { readonly isKnown: true; readonly prefixes: readonly Nat64Prefix[] }
  | { readonly isKnown: false; readonly detail: string }

/** No NAT64 to consider: every answer is IPv4. */
const NO_NAT64: Nat64Discovery = { isKnown: true, prefixes: [] }

export interface WebFetchDeps {
  /** Every address the name resolves to, from this machine's resolver. */
  readonly resolve: (host: string) => Promise<readonly string[]>
  /** The network's NAT64 prefixes (RFC 7050), asked only when an answer is IPv6. */
  readonly nat64: () => Promise<Nat64Discovery>
  /**
   * One GET to the pinned address; `onConnected` once its TLS connection is
   * up. Rejects when it cannot be made or `signal` aborts.
   */
  readonly request: (
    target: PinnedTarget,
    signal: AbortSignal,
    onConnected: () => void,
  ) => Promise<PinnedResponse>
  /** An HTML page as Markdown, converted apart from the fetch (htmlConversion.ts). */
  readonly convertHtml: HtmlConverter
  /** Fresh random hexadecimal for the markers around the page's content. */
  readonly newMarker: () => string
  /** The whole fetch's deadline; WEB_FETCH_TIMEOUT_MS unless a test shortens it. */
  readonly timeoutMs?: number
}

/** A page that was read. */
export interface WebPage {
  readonly url: string
  readonly finalUrl: string
  readonly status: number
  readonly type: string
  readonly bytes: number
}

export type WebFetchResult =
  | {
      readonly kind: 'page'
      readonly page: WebPage
      /** What the model receives: the header, the notice, and the marked content. */
      readonly text: string
    }
  | {
      /** A redirect to another host, handed back to the model (not followed). */
      readonly kind: 'moved'
      readonly location: string
      readonly text: string
      /** What the row says, in the display language. */
      readonly visibleText: string
    }
  | { readonly kind: 'failed'; readonly failure: WebFetchFailure }

/**
 * The host's fetch: one URL, stopped by the turn's signal; `isStillAllowed`
 * is asked before each request goes out.
 */
export type WebFetcher = (
  url: string,
  signal: AbortSignal,
  isStillAllowed?: () => boolean,
) => Promise<WebFetchResult>

const MEDIA_TYPE_SEPARATOR = ';'
const CHARSET = 'charset'
const IDENTITY = 'identity'
// A text page's encoding when nothing declares one.
const UTF_8 = 'utf8'
const ADDRESS_LIST_SEPARATOR = ', '
// A media type (`type/subtype`) or a coding: RFC 9110 token characters.
const TOKEN = /^[\w!#$%&'*+.^`|~-]+(?:\/[\w!#$%&'*+.^`|~-]+)?$/

/** A listener that has nothing to do until it is replaced. */
function ignore(): void {
  // Replaced before it can run; see unlessAborted.
}

class FetchRefused extends Error {
  public constructor(public readonly failure: WebFetchFailure) {
    super(failure.reason)
    this.name = 'FetchRefused'
  }
}

function refuse(kind: WebFetchFailureKind, facts: FailureFacts = {}): never {
  throw new FetchRefused(webFetchFailure(kind, facts))
}

/** A server's type or coding, named only when it is a short token. */
function shownToken(value: string): string | undefined {
  return value.length <= WEB_FETCH_TOKEN_MAX_CHARS && TOKEN.test(value) ? value : undefined
}

/** `work`, or the signal's reason as soon as it aborts; `work` is left to settle. */
async function unlessAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let onAbort: () => void = ignore
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([work, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** The name's answers from this machine's resolver, or the refusal. */
async function answersFor(
  checked: CheckedPageUrl,
  deps: WebFetchDeps,
  signal: AbortSignal,
): Promise<readonly string[]> {
  if (checked.address !== undefined) {
    return [checked.address]
  }
  try {
    return await unlessAborted(deps.resolve(checked.host), signal)
  } catch (error: unknown) {
    if (signal.aborted) {
      throw error
    }
    return refuse('unresolved', { host: checked.host })
  }
}

/**
 * The addresses a checked URL's request may be pinned to, in the resolver's
 * order, once every answer is checked; the name is never looked up again.
 */
async function pin(
  checked: CheckedPageUrl,
  deps: WebFetchDeps,
  signal: AbortSignal,
): Promise<readonly PinnedTarget[]> {
  const { host, url } = checked
  const addresses = await answersFor(checked, deps, signal)
  const hasIpv6 = addresses.some((address) => addressFamily(address) === ADDRESS_FAMILIES.ipv6)
  const nat64 = hasIpv6 ? await unlessAborted(deps.nat64(), signal) : NO_NAT64
  // A name with any non-public answer is refused whole: a rebinding setup
  // mixes a public answer with a private one.
  const prefixes = nat64.isKnown ? nat64.prefixes : []
  const blocked = addresses.find((address) => !isPublicAddress(address, prefixes))
  if (blocked !== undefined) {
    refuse('privateAddress', { host, address: blocked })
  }
  // Without a known answer about NAT64, an IPv6 answer may carry any IPv4
  // address under a prefix nobody named: only the IPv4 answers are used.
  const usable = nat64.isKnown
    ? addresses
    : addresses.filter((address) => addressFamily(address) === ADDRESS_FAMILIES.ipv4)
  if (!nat64.isKnown && usable.length === 0) {
    refuse('nat64Unknown', { host, detail: nat64.detail })
  }
  const targets = usable.flatMap((address) => {
    const family = addressFamily(address)
    return family === undefined ? [] : [{ url, host, address, family }]
  })
  if (targets.length === 0) {
    refuse('unresolved', { host })
  }
  return targets
}

/** A connection that failed, with the addresses it was tried at. */
class ConnectFailed extends Error {
  public constructor(
    public readonly failure: unknown,
    public readonly targets: readonly PinnedTarget[],
  ) {
    super('no pinned address answered')
    this.name = 'ConnectFailed'
  }
}

/**
 * The first pinned address to connect, as RFC 8305 races them: an attempt
 * starts when the one before has not connected within the attempt delay, or
 * at once when it failed; the first to connect wins and the others are
 * stopped. An attempt that connected is the answer, whatever it says.
 */
function requestPinned(
  targets: readonly PinnedTarget[],
  deps: WebFetchDeps,
  signal: AbortSignal,
  ensureAllowed: () => void,
): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const attempts: AbortController[] = []
    let next = 0
    let failed = 0
    let winner: number | undefined
    let isSettled = false
    let lastError: unknown
    let timer: ReturnType<typeof setTimeout> | undefined
    const stopOthers = (keep: number) => {
      for (const [index, attempt] of attempts.entries()) {
        if (index !== keep) {
          attempt.abort()
        }
      }
    }
    const settle = (outcome: () => void) => {
      if (isSettled) {
        return
      }
      isSettled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      outcome()
    }
    function onAbort(): void {
      stopOthers(-1)
      settle(() => {
        reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
      })
    }
    const start = () => {
      clearTimeout(timer)
      const index = next
      const target = targets[index]
      if (isSettled || winner !== undefined || target === undefined) {
        return
      }
      try {
        ensureAllowed()
      } catch (error: unknown) {
        settle(() => {
          reject(error instanceof Error ? error : new Error(String(error)))
        })
        stopOthers(-1)
        return
      }
      next += 1
      const attempt = new AbortController()
      attempts.push(attempt)
      const connected = () => {
        if (isSettled || winner !== undefined) {
          return
        }
        winner = index
        clearTimeout(timer)
        stopOthers(index)
      }
      const onFailure = (error: unknown) => {
        if (winner === index) {
          settle(() => {
            reject(new ConnectFailed(error, [target]))
          })
          return
        }
        if (winner !== undefined || isSettled) {
          return
        }
        lastError = error
        failed += 1
        if (failed === targets.length) {
          settle(() => {
            reject(new ConnectFailed(lastError, targets))
          })
        } else {
          start()
        }
      }
      const run = async () => {
        let response: PinnedResponse
        try {
          response = await deps.request(
            target,
            AbortSignal.any([signal, attempt.signal]),
            connected,
          )
        } catch (error: unknown) {
          onFailure(error)
          return
        }
        if (isSettled) {
          response.close()
          return
        }
        connected()
        if (winner === index) {
          settle(() => {
            resolve(response)
          })
        } else {
          response.close()
        }
      }
      void run()
      if (next < targets.length) {
        timer = setTimeout(start, WEB_FETCH_ATTEMPT_DELAY_MS)
      }
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    start()
  })
}

/** The status of an answer the transport refused because it did not come over TLS. */
function notTlsStatus(error: unknown): number | undefined {
  return isNotTls(error) ? error.status : undefined
}

/** The transport's refusal of an answer that did not come over TLS; both fields checked. */
function isNotTls(error: unknown): error is { readonly code: string; readonly status: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === WEB_FETCH_NOT_TLS_CODE &&
    'status' in error &&
    typeof error.status === 'number'
  )
}

/** Why no pinned address gave an answer, in web fetch's own words (not M56's Meta advice). */
function connectionFailure(failed: ConnectFailed): WebFetchFailure {
  const [first] = failed.targets
  const host = first?.host ?? ''
  const address = failed.targets.map((target) => target.address).join(ADDRESS_LIST_SEPARATOR)
  const status = notTlsStatus(failed.failure)
  if (status !== undefined) {
    return webFetchFailure(
      status === HTTP_PROXY_AUTHENTICATION_REQUIRED ? 'proxyCredentials' : 'proxyRefused',
      { host, address, status },
    )
  }
  const facts = { host, address, detail: detailOf(failed.failure) }
  const { kind } = describeNetworkFailure(failed.failure)
  switch (kind) {
    case 'certificate':
    case 'unreachable': {
      return webFetchFailure(kind, facts)
    }
    // This transport reports a proxy's refusal by its code (above); M56 reads
    // one from an error's message, which here may hold a server's text.
    case 'proxyCredentials':
    case 'proxyRefused':
    case 'other': {
      return webFetchFailure('network', facts)
    }
  }
}

/** A network failure's detail: its causes' codes, capped (never a certificate's names). */
function detailOf(error: unknown): string {
  return networkFailureCodes(error).slice(0, WEB_FETCH_DETAIL_MAX_CHARS)
}

/** The headers the fetch reads, checked at the transport's boundary. */
const readHeadersSchema = z.object({
  'content-type': z.optional(z.string()),
  'content-length': z.optional(z.string()),
  'content-encoding': z.optional(z.string()),
  location: z.optional(z.string()),
})
type ReadHeaders = z.infer<typeof readHeadersSchema>

function headersOf(response: PinnedResponse): ReadHeaders {
  return readHeadersSchema.parse(response.headers)
}

/** A header's media type, lower case, without parameters. */
function mediaTypeOf(contentType: string): string {
  return (contentType.split(MEDIA_TYPE_SEPARATOR)[0] ?? '').trim().toLowerCase()
}

/**
 * A text body as text: a byte order mark, else the header's charset, else
 * UTF-8 (a label nobody knows counts as none); an encoding this runtime
 * cannot decode refuses the page, never reads it as UTF-8. An HTML page is
 * decoded by its converter, as HTML decodes it (htmlCharset.ts).
 */
function decodeText(bytes: Uint8Array, contentType: string): string {
  const label = mimeParameter(contentType, CHARSET)
  const encoding = (label === undefined ? undefined : encodingOf(label)) ?? UTF_8
  try {
    return decodeWithBom(bytes, encoding)
  } catch (error: unknown) {
    if (error instanceof UndecodableText) {
      refuse('undecodable', { encoding: shownToken(error.encoding) })
    }
    throw error
  }
}

/** A decompressor's output, and whether the body under it failed (the network, not the data). */
interface Decoded {
  readonly chunks: AsyncIterable<Uint8Array>
  readonly hasSourceFailed: () => boolean
}

/**
 * The body through a decompressor. `pipeline` destroys the decompressor with
 * the body's error (an abort, a reset), so reading it fails rather than
 * waiting forever; its callback has nothing left to do.
 */
function through(body: AsyncIterable<Uint8Array>, decompressor: Transform): Decoded {
  let hasFailed = false
  const source = Readable.from(body)
  source.once('error', () => {
    hasFailed = true
  })
  pipeline(source, decompressor, ignore)
  return { chunks: decompressor, hasSourceFailed: () => hasFailed }
}

/** The body as it came off the wire, decompressed; refused for an unknown coding. */
function decoded(body: AsyncIterable<Uint8Array>, coding: string): Decoded {
  switch (coding) {
    case '':
    case IDENTITY: {
      return { chunks: body, hasSourceFailed: () => true }
    }
    case 'gzip':
    case 'x-gzip': {
      return through(body, createGunzip())
    }
    case 'deflate': {
      return through(body, createInflate())
    }
    case 'br': {
      return through(body, createBrotliDecompress())
    }
    default: {
      return refuse('encoding', { encoding: shownToken(coding) })
    }
  }
}

/** Every chunk, refused as soon as the total passes the cap. */
async function collect(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  let total = 0
  for await (const chunk of chunks) {
    total += chunk.byteLength
    if (total > WEB_FETCH_MAX_BYTES) {
      refuse('tooLarge')
    }
    parts.push(chunk)
  }
  return Buffer.concat(parts)
}

/**
 * The whole body within the cap. Damaged compressed data is refused as the
 * coding's, not reported as a network failure.
 */
async function readCapped(
  response: PinnedResponse,
  headers: ReadHeaders,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const declared = Number(headers['content-length'] ?? NaN)
  if (Number.isFinite(declared) && declared > WEB_FETCH_MAX_BYTES) {
    refuse('tooLarge')
  }
  const coding = (headers['content-encoding'] ?? IDENTITY).trim().toLowerCase()
  const body = decoded(response.body, coding)
  try {
    return await collect(body.chunks)
  } catch (error: unknown) {
    if (error instanceof FetchRefused || signal.aborted || body.hasSourceFailed()) {
      throw error
    }
    return refuse('encoding', { encoding: shownToken(coding) })
  }
}

/** The facts line, the notice and the marked content, as the model receives them. */
function pageText(
  page: WebPage,
  content: string,
  flags: { readonly isHtml: boolean; readonly hasMore: boolean },
  marker: string,
): string {
  const shown =
    content.length > WEB_FETCH_MAX_CONTENT_CHARS
      ? content.slice(0, WEB_FETCH_MAX_CONTENT_CHARS)
      : content
  const facts = [
    fill(MODEL_TEXT.webFetchHeader, {
      url: page.url,
      status: String(page.status),
      type: page.type,
      bytes: String(page.bytes),
    }),
    flags.isHtml ? MODEL_TEXT.webFetchConverted : MODEL_TEXT.webFetchAsText,
    ...(flags.hasMore || shown.length < content.length
      ? [fill(MODEL_TEXT.webFetchTruncated, { shown: String(shown.length) })]
      : []),
  ].join(' ')
  return [
    facts,
    MODEL_TEXT.webFetchUntrusted,
    fill(MODEL_TEXT.webFetchOpen, { marker }),
    shown,
    fill(MODEL_TEXT.webFetchClose, { marker }),
  ].join('\n')
}

/** Why a page's HTML was not converted, as web fetch names it. */
const CONVERSION_FAILURES: Readonly<Record<HtmlConversionFailure, WebFetchFailureKind>> = {
  timeout: 'conversionTimeout',
  memory: 'conversionMemory',
  failed: 'conversionFailed',
  undecodable: 'undecodable',
}

/**
 * The page's text, HTML as Markdown by the converter (on its worker): the
 * final URL and the title go inside the markers. A page the converter could
 * not convert in time or memory is refused with that reason.
 */
async function contentOf(
  body: { readonly bytes: Uint8Array; readonly contentType: string; readonly isHtml: boolean },
  urls: { readonly requested: URL; readonly final: URL },
  convertHtml: HtmlConverter,
  signal: AbortSignal,
): Promise<{ readonly content: string; readonly hasMore: boolean }> {
  const redirected =
    urls.final.href === urls.requested.href
      ? []
      : [fill(MODEL_TEXT.webFetchRedirected, { url: urls.final.href })]
  if (!body.isHtml) {
    return {
      content: [...redirected, decodeText(body.bytes, body.contentType)].join('\n\n'),
      hasMore: false,
    }
  }
  const converted = await convertHtml(
    {
      bytes: body.bytes,
      charset: mimeParameter(body.contentType, CHARSET),
      url: urls.final.href,
      maxChars: WEB_FETCH_CONVERT_MAX_CHARS,
    },
    signal,
  )
  if (!converted.ok) {
    // The page arrived; the fetch's deadline passed while it was converted.
    // (A stopped turn is rethrown by fetchWebPage, whatever is refused here.)
    return signal.aborted
      ? refuse('conversionTimeout')
      : refuse(CONVERSION_FAILURES[converted.kind], {
          detail: converted.detail,
          encoding: shownToken(converted.detail),
        })
  }
  const { page } = converted
  const title =
    page.title === undefined ? [] : [fill(MODEL_TEXT.webFetchTitle, { title: page.title })]
  return {
    content: [...redirected, ...title, page.markdown].join('\n\n'),
    hasMore: page.isTruncated,
  }
}

/** The page read and converted, once its status and type are allowed. */
async function readPage(
  response: PinnedResponse,
  urls: { readonly requested: URL; readonly final: URL },
  deps: WebFetchDeps,
  signal: AbortSignal,
): Promise<WebFetchResult> {
  const { status } = response
  if (status < HTTP_SUCCESS_MIN || status > HTTP_SUCCESS_MAX) {
    refuse('httpStatus', { status })
  }
  const headers = headersOf(response)
  const contentType = headers['content-type']
  if (contentType === undefined || contentType.trim() === '') {
    refuse('noContentType')
  }
  const type = mediaTypeOf(contentType)
  if (type === WEB_FETCH_XHTML_TYPE) {
    refuse('xhtml')
  }
  const isHtml = WEB_FETCH_HTML_TYPES.has(type)
  if (!isHtml && !WEB_FETCH_TEXT_TYPES.has(type)) {
    refuse('contentType', { type: shownToken(type) })
  }
  const bytes = await readCapped(response, headers, signal)
  const { content, hasMore } = await contentOf(
    { bytes, contentType, isHtml },
    urls,
    deps.convertHtml,
    signal,
  )
  const page: WebPage = {
    url: urls.requested.href,
    finalUrl: urls.final.href,
    status,
    type,
    bytes: bytes.byteLength,
  }
  return {
    kind: 'page',
    page,
    text: pageText(page, content, { isHtml, hasMore }, deps.newMarker()),
  }
}

/** Why the request failed: a refusal, the deadline, or the network. */
function failureOf(error: unknown, deadline: AbortSignal): WebFetchFailure {
  if (error instanceof FetchRefused) {
    return error.failure
  }
  if (deadline.aborted) {
    return webFetchFailure('timeout')
  }
  return error instanceof ConnectFailed
    ? connectionFailure(error)
    : webFetchFailure('network', { detail: detailOf(error) })
}

/** The redirect's target: checked like the first URL, or handed back when it is another host's. */
function nextHop(
  response: PinnedResponse,
  headers: ReadHeaders,
  current: CheckedPageUrl,
): { readonly next: CheckedPageUrl } | { readonly moved: string } {
  const { location } = headers
  if (location === undefined || location.trim() === '') {
    refuse('redirectWithoutLocation', { status: response.status })
  }
  let target: URL
  try {
    target = new URL(location.trim(), current.url)
  } catch {
    throw new FetchRefused(redirectRefused(webFetchFailure('invalidUrl')))
  }
  const checked = checkPageUrl(target.href)
  if (!checked.ok) {
    throw new FetchRefused(redirectRefused(checked.failure))
  }
  return approvalHost(checked.url) === approvalHost(current.url)
    ? { next: checked }
    : { moved: checked.url.href }
}

/** A redirect to another host: the target stays inside the markers. */
function movedResult(location: string, marker: string): WebFetchResult {
  const text = [
    MODEL_TEXT.webFetchMoved,
    fill(MODEL_TEXT.webFetchMovedOpen, { marker }),
    location,
    fill(MODEL_TEXT.webFetchMovedClose, { marker }),
  ].join('\n')
  return { kind: 'moved', location, text, visibleText: fill(UI_TEXT.webFetchMoved, { location }) }
}

/** Every hop of one fetch, within the deadline and the redirect limit. */
async function fetchHops(
  first: CheckedPageUrl,
  deps: WebFetchDeps,
  signal: AbortSignal,
  isStillAllowed: () => boolean,
): Promise<WebFetchResult> {
  // What allowed the fetch (trust, the mode, the setting) may change while a
  // lookup or a connection is awaited: it is asked again before each sends
  // anything.
  const ensureAllowed = () => {
    if (!isStillAllowed()) {
      refuse('withdrawn')
    }
  }
  let current = first
  for (let redirects = 0; ; redirects += 1) {
    ensureAllowed()
    const targets = await pin(current, deps, signal)
    ensureAllowed()
    const response = await requestPinned(targets, deps, signal, ensureAllowed)
    try {
      if (!HTTP_REDIRECT_STATUSES.has(response.status)) {
        return await readPage(response, { requested: first.url, final: current.url }, deps, signal)
      }
      if (redirects >= WEB_FETCH_MAX_REDIRECTS) {
        refuse('tooManyRedirects')
      }
      const hop = nextHop(response, headersOf(response), current)
      if ('moved' in hop) {
        return movedResult(hop.moved, deps.newMarker())
      }
      current = hop.next
    } finally {
      response.close()
    }
  }
}

/** For a caller with no condition that can change during the fetch. */
function isAlwaysAllowed(): boolean {
  return true
}

/**
 * Fetches one page. Resolves with the page, a redirect to another host, or
 * the reason nothing was read; rejects only when `turn` aborts (Stop).
 * `isStillAllowed` is asked before each hop's lookup and connection.
 */
export async function fetchWebPage(
  rawUrl: string,
  deps: WebFetchDeps,
  turn: AbortSignal,
  isStillAllowed: () => boolean = isAlwaysAllowed,
): Promise<WebFetchResult> {
  const first = checkPageUrl(rawUrl)
  if (!first.ok) {
    return { kind: 'failed', failure: first.failure }
  }
  const deadline = AbortSignal.timeout(deps.timeoutMs ?? WEB_FETCH_TIMEOUT_MS)
  const signal = AbortSignal.any([turn, deadline])
  try {
    return await fetchHops(first, deps, signal, isStillAllowed)
  } catch (error: unknown) {
    if (turn.aborted) {
      throw error
    }
    return { kind: 'failed', failure: failureOf(error, deadline) }
  }
}
