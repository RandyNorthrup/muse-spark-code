import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import {
  GITHUB_API_VERSION,
  GITHUB_MEDIA_TYPE,
  MILLISECONDS_PER_SECOND,
  REPORT_GITHUB_RATE_FLOOR,
  REPORT_SOURCE_TIMEOUT_MS,
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import type { ReportSourceRecord } from '../../../shared/reportSchema'
import type { SourceReadContext, SourceResult } from './types'

export interface ReportNetworkPolicy {
  readonly surface: 'editor' | 'terminal'
  readonly mode: 'whenSignedIn' | 'always' | 'off'
  readonly githubSignedIn: boolean
  /** D65/host network posture: mandatory, including public endpoints. */
  readonly allowEgress: (url: string, signal: AbortSignal) => Promise<boolean>
}

export interface ReportNetworkRequest {
  readonly url: string
  readonly method?: 'GET' | 'POST'
  readonly body?: string
}
export type ReportNetworkTransport = (
  request: ReportNetworkRequest,
  etag: string | null,
  signal: AbortSignal,
) => Promise<Response>
export type ReportNetworkQuery = <T>(
  request: ReportNetworkRequest,
  schema: z.ZodMiniType<T>,
  /** Transforms supply their normalized output schema; identity parsers may omit it. */
  outputSchema?: z.ZodMiniType<T>,
) => Promise<T>

/** R binds its export scrub here, including registered values and local roots. */
export interface ReportNetworkDeps {
  readonly policy: ReportNetworkPolicy
  readonly transport: ReportNetworkTransport
  readonly cache: ReportResponseCache
  readonly now: () => string
  readonly scrub: (text: string) => string
  /** W binds named REPORT_* tunables; no caps are changed by this lane. */
  readonly maxBytes: number
  readonly maxPages: number
}

const timestamp = z.iso.datetime({ offset: true })
const entrySchema = z.strictObject({
  key: z.string().check(z.regex(/^[a-f0-9]{64}$/)),
  etag: z.nullable(z.string()),
  observedAt: timestamp,
  data: z.unknown(),
})
type CacheEntry = z.infer<typeof entrySchema>

/**
 * Shared host/runtime storage binding: owner-only, bounded reads and atomic
 * writes of reports/v1/cache/index.json outside the workspace. It must refuse
 * links and check confinement. No credential or raw response is passed to it.
 */
export interface ReportCacheStorage {
  read(signal: AbortSignal): Promise<unknown>
  write(entries: readonly CacheEntry[], signal: AbortSignal): Promise<void>
}

export class ReportResponseCache {
  private pending: Promise<void> = Promise.resolve()
  public constructor(
    private readonly storage: ReportCacheStorage,
    private readonly maxEntries: number,
  ) {
    z.number().check(z.int(), z.positive()).parse(maxEntries)
  }

  private async entries(signal: AbortSignal): Promise<CacheEntry[]> {
    const raw = await this.storage.read(signal)
    return raw === undefined
      ? []
      : z.array(entrySchema).check(z.maxLength(this.maxEntries)).parse(raw)
  }

  public async get(key: string, signal: AbortSignal): Promise<CacheEntry | undefined> {
    await this.pending
    signal.throwIfAborted()
    const entries = await this.entries(signal)
    return entries.find((entry) => entry.key === key)
  }

  public async set(entry: CacheEntry, signal: AbortSignal): Promise<void> {
    const previousWrite = this.pending
    const write = (async () => {
      await previousWrite
      signal.throwIfAborted()
      const previous = await this.entries(signal)
      const entries = previous.filter((item) => item.key !== entry.key)
      entries.push(entrySchema.parse(entry))
      entries.sort((a, b) => compare(a.observedAt, b.observedAt) || compare(a.key, b.key))
      signal.throwIfAborted()
      await this.storage.write(entries.slice(-this.maxEntries), signal)
    })()
    this.pending = (async () => {
      try {
        await write
      } catch {
        // The original caller below receives the failure; release the queue
        // so one failed write cannot permanently block later report reads.
        return
      }
    })()
    await write
  }
}

function compare(a: string, b: string): number {
  return Number(a > b) - Number(a < b)
}

/** Scrub decoded strings, including field names, rather than JSON escape sequences. */
function scrubStructured(value: unknown, scrub: (text: string) => string): unknown {
  if (typeof value === 'string') return scrub(value)
  if (Array.isArray(value)) return value.map((item: unknown) => scrubStructured(item, scrub))
  return value !== null && typeof value === 'object'
    ? Object.fromEntries(
        Object.entries(value).map(([name, item]) => [scrub(name), scrubStructured(item, scrub)]),
      )
    : value
}

const HTTP_NOT_MODIFIED = 304
const HTTP_FORBIDDEN = 403
const HTTP_TOO_MANY_REQUESTS = 429
const PUBLIC_HOSTS = new Set([
  'api.github.com',
  'marketplace.visualstudio.com',
  'open-vsx.org',
  'registry.npmjs.org',
])

export class ReportNetworkFailure extends Error {}

export function unavailableReportSource<T>(
  id: string,
  reason: string,
  status: 'unavailable' | 'notApplicable' = 'unavailable',
): SourceResult<T> {
  return {
    record: { id, status, reason, observedAt: null, freshness: { state: 'unknown', ageMs: null } },
    data: null,
  }
}

/** Requests are never started when policy refuses, even if a cache exists. */
export function isReportNetworkAllowed(
  policy: ReportNetworkPolicy,
  context: SourceReadContext,
): boolean {
  return policy.mode !== 'off' && (policy.surface === 'editor' || context.options.network)
}

export class ReportNetworkReader {
  private readonly limitedUntil = new Map<string, number>()
  private readonly dispatches = new Map<string, Promise<void>>()

  public constructor(private readonly deps: ReportNetworkDeps) {
    z.number().check(z.int(), z.positive()).parse(deps.maxBytes)
    z.number().check(z.int(), z.positive()).parse(deps.maxPages)
  }

  private async query<T>(
    request: ReportNetworkRequest,
    schema: z.ZodMiniType<T>,
    signal: AbortSignal,
    context: SourceReadContext,
    outputSchema: z.ZodMiniType<T> = schema,
  ): Promise<{
    data: T
    observedAt: string
    cached: boolean
  }> {
    const url = new URL(request.url)
    if (
      url.protocol !== 'https:' ||
      !PUBLIC_HOSTS.has(url.hostname) ||
      url.username !== '' ||
      url.password !== '' ||
      url.hash !== '' ||
      url.port !== ''
    ) {
      throw new ReportNetworkFailure('endpoint-refused')
    }
    if (
      (request.method ?? 'GET') !== 'GET' &&
      !(
        request.method === 'POST' &&
        url.hostname === 'marketplace.visualstudio.com' &&
        url.pathname === '/_apis/public/gallery/extensionquery'
      )
    )
      throw new ReportNetworkFailure('read-method-refused')
    if (request.body !== undefined && Buffer.byteLength(request.body) > this.deps.maxBytes)
      throw new ReportNetworkFailure('request-bound')
    if (
      this.deps.scrub(request.url) !== request.url ||
      (request.body !== undefined && this.deps.scrub(request.body) !== request.body)
    )
      throw new ReportNetworkFailure('request-secret-refused')
    if (!(await this.deps.policy.allowEgress(url.href, signal)))
      throw new ReportNetworkFailure('egress-refused')
    signal.throwIfAborted()
    // Cache identity is computed only after scrubbing, including the read-query body.
    const key = createHash('sha256')
      .update(this.deps.scrub(JSON.stringify({ workspaceKey: context.workspaceKey, request })))
      .digest('hex')
    const previous = await this.deps.cache.get(key, signal)
    signal.throwIfAborted()
    const oldEtag = previous?.etag ?? null
    const { response, limited, now } = await this.dispatch(
      request,
      oldEtag !== null && this.deps.scrub(oldEtag) === oldEtag ? oldEtag : null,
      signal,
      context,
      url.origin,
    )
    signal.throwIfAborted()
    if (response.status === HTTP_NOT_MODIFIED) {
      if (previous === undefined) throw new ReportNetworkFailure('cache-missing')
      // A 304 never makes the cached observation newer than it was.
      return {
        data: outputSchema.parse(scrubStructured(previous.data, this.deps.scrub)),
        observedAt: previous.observedAt,
        cached: true,
      }
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new ReportNetworkFailure(
        limited === null
          ? `http-${String(response.status)}`
          : fill(UI_TEXT.reportUi.rateLimitedUntil, { time: new Date(limited).toISOString() }),
      )
    }
    const raw = await this.body(response, signal)
    signal.throwIfAborted()
    const data = outputSchema.parse(scrubStructured(schema.parse(JSON.parse(raw)), this.deps.scrub))
    const etag = response.headers.get('etag')
    const safeEtag = etag !== null && this.deps.scrub(etag) === etag ? etag : null
    await this.deps.cache.set({ key, etag: safeEtag, observedAt: now, data }, signal)
    return { data, observedAt: now, cached: false }
  }

  /** Hold each host's admission through its response headers and rate-state update. */
  private async dispatch(
    request: ReportNetworkRequest,
    etag: string | null,
    signal: AbortSignal,
    context: SourceReadContext,
    origin: string,
  ): Promise<{ response: Response; limited: number | null; now: string }> {
    const previous = this.dispatches.get(origin) ?? Promise.resolve()
    const dispatched = (async () => {
      await previous
      signal.throwIfAborted()
      const now = timestamp.parse(this.deps.now())
      const until = this.limitedUntil.get(origin)
      if (until !== undefined && until > Date.parse(now))
        throw new ReportNetworkFailure(
          fill(UI_TEXT.reportUi.rateLimitedUntil, { time: new Date(until).toISOString() }),
        )
      // No await between the live setting check and the actual transport call.
      if (!this.allowed(context)) throw new ReportNetworkFailure(UI_TEXT.reportUi.networkOff)
      const response = await this.deps.transport(request, etag, signal)
      const limited = this.rateLimit(response, origin, Date.parse(now))
      return { response, limited, now }
    })()
    const pending = (async () => {
      try {
        await dispatched
      } catch {
        // The caller receives the failure; later host admissions can still run.
        return
      }
    })()
    this.dispatches.set(origin, pending)
    try {
      return await dispatched
    } finally {
      if (this.dispatches.get(origin) === pending) this.dispatches.delete(origin)
    }
  }

  private rateLimit(response: Response, origin: string, now: number): number | null {
    const remaining = response.headers.get('x-ratelimit-remaining')
    const reset = response.headers.get('x-ratelimit-reset')
    const retry = response.headers.get('retry-after')
    let until = NaN
    if (retry !== null)
      until = /^\d+$/.test(retry)
        ? now + Number(retry) * MILLISECONDS_PER_SECOND
        : Date.parse(retry)
    const isAtFloor =
      origin === 'https://api.github.com' &&
      remaining !== null &&
      /^\d+$/.test(remaining) &&
      Number(remaining) <= REPORT_GITHUB_RATE_FLOOR
    if (isAtFloor && reset !== null && /^\d+$/.test(reset))
      until = Math.max(
        Number.isFinite(until) ? until : now,
        Number(reset) * MILLISECONDS_PER_SECOND,
      )
    if (
      isAtFloor ||
      Number.isFinite(until) ||
      response.status === HTTP_TOO_MANY_REQUESTS ||
      (retry !== null && response.status === HTTP_FORBIDDEN)
    ) {
      // Missing/malformed reset cannot authorize another dispatch immediately.
      until = until > now && Number.isFinite(until) ? until : now + REPORT_SOURCE_TIMEOUT_MS
      this.limitedUntil.set(origin, until)
      return until
    }
    return null
  }

  private async body(response: Response, signal: AbortSignal): Promise<string> {
    if (response.body === null) throw new ReportNetworkFailure('body-missing')
    const reader = response.body.getReader()
    const stop = async (): Promise<void> => {
      try {
        await reader.cancel()
      } catch {
        return
      }
    }
    const abort = (): void => {
      void stop()
    }
    signal.addEventListener('abort', abort, { once: true })
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      for (;;) {
        signal.throwIfAborted()
        const chunk = await reader.read()
        if (chunk.done) break
        const value = z.instanceof(Uint8Array).parse(chunk.value)
        bytes += value.byteLength
        if (bytes > this.deps.maxBytes) throw new ReportNetworkFailure('body-bound')
        chunks.push(value)
      }
      return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
    } finally {
      signal.removeEventListener('abort', abort)
      await stop()
    }
  }
  public allowed(context: SourceReadContext): boolean {
    return isReportNetworkAllowed(this.deps.policy, context)
  }

  public get signedIn(): boolean {
    return this.deps.policy.githubSignedIn
  }

  public get requiresSignIn(): boolean {
    return this.deps.policy.mode === 'whenSignedIn'
  }

  /** One deadline covers all pages, parsing, egress admission and storage. */
  public async read<T>(
    context: SourceReadContext,
    id: string,
    schema: z.ZodMiniType<T>,
    collect: (query: ReportNetworkQuery) => Promise<{
      data: T
      reason: string | null
    }>,
  ): Promise<SourceResult<T>> {
    if (!this.allowed(context)) return unavailableReportSource(id, UI_TEXT.reportUi.networkOff)
    const controller = new AbortController()
    const signal = AbortSignal.any([context.signal, controller.signal])
    let observedAt: string | null = null
    let isCached = false
    let pages = 0
    const work = async (): Promise<SourceResult<T>> => {
      const result = await collect(async (request, schema, outputSchema) => {
        signal.throwIfAborted()
        pages += 1
        if (pages > this.deps.maxPages) throw new ReportNetworkFailure('page-bound')
        const page = await this.query(request, schema, signal, context, outputSchema)
        if (observedAt === null || Date.parse(page.observedAt) < Date.parse(observedAt)) {
          observedAt = page.observedAt
        }
        isCached ||= page.cached
        return page.data
      })
      signal.throwIfAborted()
      if (observedAt === null) throw new ReportNetworkFailure(result.reason ?? 'no-observed-source')
      const ageMs = Math.max(0, Date.parse(context.asOf) - Date.parse(observedAt))
      const freshness: ReportSourceRecord['freshness'] = {
        state: isCached ? 'stale' : 'fresh',
        ageMs,
      }
      return {
        record:
          result.reason === null
            ? { id, status: 'ok', reason: null, observedAt, freshness }
            : {
                id,
                status: 'partial',
                reason: this.deps.scrub(result.reason),
                observedAt,
                freshness,
              },
        data: schema.parse(scrubStructured(result.data, this.deps.scrub)),
      }
    }
    let abortListener: (() => void) | undefined
    const aborted = new Promise<never>((_resolve, reject) => {
      abortListener = () => {
        reject(new ReportNetworkFailure('source-deadline'))
      }
      signal.addEventListener('abort', abortListener, { once: true })
      if (signal.aborted) abortListener()
    })
    const timer = setTimeout(() => {
      controller.abort()
    }, REPORT_SOURCE_TIMEOUT_MS)
    try {
      return await Promise.race([work(), aborted])
    } catch (error: unknown) {
      const detail = error instanceof ReportNetworkFailure ? error.message : 'source-failed'
      return unavailableReportSource(
        id,
        `${UI_TEXT.reportUi.generationFailed} (${this.deps.scrub(detail)})`,
      )
    } finally {
      clearTimeout(timer)
      if (abortListener !== undefined) signal.removeEventListener('abort', abortListener)
      controller.abort()
    }
  }
}

/** Public fetch has no authorization and refuses redirects to another host. */
export function publicReportTransport(fetcher: typeof fetch): ReportNetworkTransport {
  return async (request, etag, signal) =>
    await fetcher(request.url, {
      method: request.method ?? 'GET',
      ...(request.body !== undefined && { body: request.body }),
      headers: {
        ...(new URL(request.url).hostname === 'api.github.com' && {
          Accept: GITHUB_MEDIA_TYPE,
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
        }),
        ...(etag !== null && { 'If-None-Match': etag }),
        ...(request.body !== undefined && { 'Content-Type': 'application/json' }),
      },
      redirect: 'error',
      credentials: 'omit',
      signal,
    })
}
