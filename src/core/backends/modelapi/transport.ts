import { notify } from '../../events/notify'
import type { PaidAuthority } from '../../paid/paidAuthority'
import type { PaidQuote, SearchSettlement } from '../../../shared/paid'
import { Usd, type UsdAmount } from '../../../shared/usd'
import {
  ModelApiPacing,
  metaPacingLimits,
  type PacingClass,
  type PacingProvider,
  type RequestPacer,
} from './pacing'
import {
  MODEL_API_BASE_URL,
  PACING_ADMISSION_TIMEOUT_MS,
  MODEL_API_MAX_RETRIES,
  HTTP_TOO_MANY_REQUESTS,
  HTTP_STATUS,
  PROVIDER_RETRY_HTTP_STATUS,
  MODEL_API_RETRY_BASE_MS,
  MODEL_API_RETRY_JITTER_MS,
  MODEL_API_RETRY_MAX_MS,
  MILLISECONDS_PER_SECOND,
  UI_TEXT,
  PROVIDER_HTTP_BODY_MAX_BYTES,
  MODEL_API_STREAM_IDLE_MS,
  PROVIDER_REQUEST_ID_MAX_CHARS,
  type PaidFeature,
} from '../../../shared/constants'
// M95-T: the existing retry/admission loop, shared by Meta and injected codecs.
import { createHash } from 'node:crypto'

interface PaidRequestClaim {
  readonly reservedUsd: UsdAmount
  check(capUsd: UsdAmount): void
  settle(actualCostUsd: UsdAmount, hasUnknownCost?: boolean): Promise<unknown>
}
import type { MediaRequestAccounting } from '../../media/mediaCost'
import { fill } from '../../../shared/l10n/text'
import { classifyRetry, RETRY_TABLES, type RetryTables } from '../../../shared/retryPolicy'
import type { CoreLogger } from '../../logging'
import {
  describeNetworkFailure,
  isConnectionFailure,
  type NetworkAdvice,
  networkFailureMessage,
} from '../../networkFailure'
import { redactSecrets } from '../../redact'
import { scrubSecrets, secretRedactor, type SecretScrubPort } from '../../../shared/redact'
export { redactSecrets } from '../../redact'
import { errorBodySchema, type StreamEvent } from './schemas'
import { scrubRefusalLeak } from './providerRefusal'
import type { UnattendedRun } from '../../schedules/unattended'
import type { ModelApiClientDeps } from './client'

import {
  USAGE_HEADER_ALLOW_LIST,
  usageHeadersSchema,
  type UsageHeaders,
} from '../../../shared/usageJournal'
import type { AuthHeaders, AuthSource } from './authSource'
import { DeadlineError, withDeadline } from '../../timeouts'

export interface TransportDeps {
  readonly vaultScrub?: SecretScrubPort
  readonly streamIdleMs?: number
  readonly pacing?: RequestPacer
  readonly pacingOwner?: object
  readonly pacingProvider?: (modelId: string | undefined) => PacingProvider
  readonly paidAuthority?: PaidAuthority
  readonly onServiceFailure?: (status: number, statusUrl: string) => void
  readonly isRetryableFailure?: (failure: ModelApiError) => boolean
  readonly scheduledRun?: () => UnattendedRun | undefined
  readonly fetch: typeof fetch
  readonly baseUrl: string
  readonly apiKey?: () => Promise<string | undefined>
  readonly auth?: AuthSource
  /** Required by CodecClient: resolve/recheck against the saved network on every attempt. */
  readonly verifyEndpoint?: (url: string) => Promise<void>
  readonly parseError?: (status: number, body: unknown, headers: Headers) => ModelApiError
  /** The preset's own retry table (OPENAI-G20); defaults to the Responses table. */
  readonly retryTable?: RetryTables
  readonly sleep: (ms: number) => Promise<void>
  readonly now: () => number
  readonly random: () => number
  readonly log: CoreLogger
  readonly networkAdvice?: NetworkAdvice
  /**
   * The sentence a send that produced no answer reads as: a configured
   * provider names itself, the network failure and that whether the request
   * arrived is unknown. Meta's network advice when absent.
   */
  readonly sendFailure?: (error: unknown) => string
}

/** U18's captured route: one fresh lowercase session UUID per POST, nothing else. */
const TRANSCRIPTION_ROUTE =
  /^\/asr\/transcribe\?sessionId=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const MULTIPART_PREFIX = 'multipart/form-data; boundary='

/** The stream has already reported its failure; cancellation must not add a second one. */
export function ignoreClosingError(): void {
  // Nothing to add after the response failure.
}

export interface TransportResponse {
  readonly response: Response
  /** Exact credential redaction remains scoped to this response's lifetime. */
  readonly redact: (text: string) => string
  /** Exact request credentials only, for executable and ordinary content. */
  readonly redactContent: (text: string) => string
}

export interface TransportStreamResponse extends TransportResponse {
  /** Only a validated canonical event renews the idle deadline. */
  readonly eventParsed: (event?: StreamEvent) => void
}

/** JSON syntax diagnostics must never include a body fragment or partial credential. */
async function readBoundedJson(response: Response): Promise<unknown> {
  const text = await readBoundedText(response)
  try {
    return JSON.parse(text)
  } catch {
    throw new ModelApiError(
      fill(UI_TEXT.webFetchNetwork, { detail: 'malformed_json' }),
      response.status,
      'malformed_json',
      undefined,
    )
  }
}

/** Keep the response's privacy boundary around every JSON/codec parser. */
export async function parseJsonResponse<T>(
  result: TransportResponse,
  parse: (value: unknown) => T,
): Promise<T> {
  try {
    return parse(await readBoundedJson(result.response))
  } catch (error: unknown) {
    throw redactModelApiError(error, result.redact, result.response.status)
  }
}

/** Bounded HTTP JSON/error body; cancel before an untrusted response fills memory. */
export async function readBoundedText(response: Response): Promise<string> {
  if (response.body === null) {
    return ''
  }
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) {
        return text + decoder.decode()
      }
      size += next.value.byteLength
      if (size > PROVIDER_HTTP_BODY_MAX_BYTES) {
        throw new ModelApiError(
          fill(UI_TEXT.webFetchNetwork, { detail: 'body_limit' }),
          0,
          'body_limit',
          undefined,
        )
      }
      text += decoder.decode(next.value, { stream: true })
    }
  } finally {
    void reader.cancel().catch(ignoreClosingError)
    reader.releaseLock()
  }
}

export class ModelApiError extends Error {
  /** The provider's request id, when its answer carried one (lane PROVERR). */
  public requestId: string | undefined
  /** The answer's parsed `Retry-After`, when it carried one (lane PROVERR). */
  public retryAfterMs: number | undefined
  public constructor(
    message: string,
    /** HTTP status, or 0 when the request never got a response. */
    public readonly status: number,
    /** The envelope's `error.type` (`rate_limit_error`, …), when any. */
    public readonly kind: string | undefined,
    /** The envelope's `error.code` (`invalid_api_key`, …), when any. */
    public readonly code: string | undefined,
  ) {
    super(message)
    this.name = 'ModelApiError'
  }
}

/** The providers and Model API bundles have separate constructors (D6). */
export function isModelApiError(value: unknown): value is ModelApiError {
  return (
    value instanceof ModelApiError ||
    (typeof value === 'object' &&
      value !== null &&
      'name' in value &&
      (value.name === 'ModelApiError' || value.name === 'CredentialOriginError') &&
      'message' in value &&
      typeof value.message === 'string' &&
      'status' in value &&
      typeof value.status === 'number' &&
      Number.isFinite(value.status) &&
      (!('kind' in value) || value.kind === undefined || typeof value.kind === 'string') &&
      (!('code' in value) || value.code === undefined || typeof value.code === 'string'))
  )
}

/** Diagnostics cross the privacy boundary; executable/model content stays intact. */
export function redactStreamDiagnostics(
  event: StreamEvent,
  redact: (text: string) => string,
): StreamEvent {
  if (event.type === 'error') {
    return {
      ...event,
      message: redact(event.message),
      ...(typeof event.code === 'string' && { code: redact(event.code) }),
    }
  }
  if (!('response' in event)) return event
  const { error, incomplete_details: incomplete } = event.response
  return {
    ...event,
    response: {
      ...event.response,
      ...(error != null && {
        error: {
          ...error,
          message: redact(error.message),
          ...(typeof error.code === 'string' && { code: redact(error.code) }),
        },
      }),
      ...(incomplete?.reason !== undefined && {
        incomplete_details: { ...incomplete, reason: redact(incomplete.reason) },
      }),
    },
  }
}

/** Use at every adapter/error boundary, including a parser that throws while reading headers. */
export function redactModelApiError(
  error: unknown,
  redact: (text: string) => string,
  fallbackStatus: number,
): ModelApiError {
  const out = new ModelApiError(
    error instanceof SyntaxError
      ? fill(UI_TEXT.webFetchNetwork, { detail: 'malformed_json' })
      : redact(error instanceof Error ? error.message : String(error)),
    isModelApiError(error) ? error.status : fallbackStatus,
    isModelApiError(error) && error.kind !== undefined ? redact(error.kind) : undefined,
    isModelApiError(error) && error.code !== undefined ? redact(error.code) : undefined,
  )
  // Lane PROVERR: a refusal keeps its request id and wait across the privacy
  // boundary (both are provider-chosen, never credentials).
  if (isModelApiError(error)) {
    out.requestId = error.requestId
    out.retryAfterMs = error.retryAfterMs
  }
  return out
}

/** Thrown when the key is absent: the caller decides how to prompt. */
export class MissingApiKeyError extends Error {
  public constructor() {
    super('No Model API key is stored')
    this.name = 'MissingApiKeyError'
  }
}

/** Lazy Node bundles have distinct constructors; use the shared error shape. */
export function isMissingApiKeyError(error: unknown): error is MissingApiKeyError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'MissingApiKeyError' &&
    'message' in error &&
    typeof error.message === 'string'
  )
}

const JSON_MEDIA_TYPE = 'application/json'
const RETRY_AFTER_HEADER = 'retry-after'
// Azure OpenAI's 429 wait in milliseconds (research azure-openai.md ZB2,
// https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/quota, read
// 2026-10-17): read before `Retry-After`, which Azure adds only on PTU.
const RETRY_AFTER_MS_HEADER = 'retry-after-ms'
const NETWORK_FAILURE_STATUS = 0

/** The documented error envelope, or the status text when the body is not one. */
async function describeFailure(
  response: Response,
  parseError: TransportDeps['parseError'],
  redact: (text: string) => string,
  now: number,
): Promise<ModelApiError> {
  let body: unknown
  let text = ''
  try {
    text = await readBoundedText(response)
    body = JSON.parse(text, (_key, value: unknown) =>
      typeof value === 'string' ? redact(value) : value,
    )
  } catch (error: unknown) {
    if (error instanceof ModelApiError && error.status === NETWORK_FAILURE_STATUS) throw error
    body = undefined
  }
  // Lane PROVERR: a refusal carries the provider's request id and wait, both
  // provider-chosen and never credentials.
  const attach = (failure: ModelApiError): ModelApiError => {
    const requestId = response.headers.get('request-id') ?? response.headers.get('x-request-id')
    if (requestId !== null && requestId.trim() !== '')
      failure.requestId = requestId.trim().slice(0, PROVIDER_REQUEST_ID_MAX_CHARS)
    failure.retryAfterMs = providerWaitMs(response.headers, now)
    return failure
  }
  if (parseError !== undefined) {
    try {
      return attach(
        redactModelApiError(
          parseError(response.status, body ?? text, response.headers),
          redact,
          response.status,
        ),
      )
    } catch (error: unknown) {
      return attach(redactModelApiError(error, redact, response.status))
    }
  }
  const parsed = errorBodySchema.safeParse(body)
  if (!parsed.success) {
    return attach(
      new ModelApiError(
        redact(`HTTP ${String(response.status)} ${response.statusText}`.trim()),
        response.status,
        undefined,
        undefined,
      ),
    )
  }
  const { error } = parsed.data
  return attach(
    new ModelApiError(
      redact(error.message),
      response.status,
      error.type == null ? undefined : redact(error.type),
      error.code == null ? undefined : redact(error.code),
    ),
  )
}

/**
 * `Retry-After` in milliseconds: a delay in seconds, or an HTTP date (RFC
 * 9110 §10.2.3 allows both; PLAN.md D25), measured from `now`.
 */
export function retryAfterMs(header: string | null, now: number): number | undefined {
  if (header === null || header.trim() === '') {
    return undefined
  }
  const seconds = Number(header)
  if (Number.isFinite(seconds)) {
    return seconds >= 0 ? seconds * MILLISECONDS_PER_SECOND : undefined
  }
  const at = Date.parse(header)
  return Number.isNaN(at) ? undefined : Math.max(at - now, 0)
}

/**
 * The wait an answer names, in every form a provider uses: `retry-after-ms`
 * (milliseconds; Azure OpenAI, read before `Retry-After` per research
 * azure-openai.md ZB2), then `Retry-After` (seconds or an HTTP date).
 * Read whole here; the retry loop honours it up to its own ceiling, so a
 * hostile or corrupt header stalls one bounded wait per try at most.
 */
export function providerWaitMs(headers: Headers, now: number): number | undefined {
  const milliseconds = headers.get(RETRY_AFTER_MS_HEADER)
  if (milliseconds !== null && milliseconds.trim() !== '') {
    const value = Number(milliseconds)
    if (Number.isFinite(value) && value >= 0) return value
  }
  return retryAfterMs(headers.get(RETRY_AFTER_HEADER), now)
}

/**
 * Which requests join the pacing bucket. Meta governs only its inference
 * path with a model id; a configured provider's inference travels a native
 * path (never `/responses`) with the codec-supplied model id, so any of its
 * model-carrying requests joins the same bucket its rate-limit observations
 * feed. Count and list calls carry no model id and stay observation-only.
 */
export function isPacingGoverned(
  path: string,
  modelId: string | undefined,
  provider: string,
): boolean {
  return modelId !== undefined && (path === '/responses' || provider !== 'meta')
}

/** One retry the client is about to make, for the transcript's notice. */
export interface RetryNotice {
  readonly phase?: 'pacing'
  readonly attempt: number
  readonly maxAttempts: number
  readonly delayMs: number
  readonly reason: string
}

/**
 * The retries one model call has used (the review of PR #28): a stream sent
 * again whole and the HTTP retries inside each of its requests draw on the
 * same MODEL_API_MAX_RETRIES.
 */
export interface RetryBudget {
  retriesUsed: number
}

/** In-memory identity of an explicitly confirmed scheduled Model API run. */
export interface ConfirmedModelRequest {
  readonly modelId: string
  readonly keyDigest: string
  readonly providerId?: string | undefined
  readonly origin?: string | undefined
  /**
   * Which confirmed run this identity belongs to. Stale-identity refusals
   * keep the schedule guidance for scheduled prompts and name the hook call
   * for model-hook runs.
   */
  readonly runKind?: 'scheduled' | 'review' | 'hookModel' | undefined
  /** The paid gate and session model must still match before every HTTP try. */
  readonly isStillAllowed: () => boolean
  /** Only after identity and gate checks, immediately before the first HTTP try. */
  readonly onRequestStarted: () => void
}

/**
 * A stale-identity refusal that names the confirmed run: scheduled prompts
 * keep the schedule guidance, model-hook runs name the hook call.
 */
export function staleConfirmedError(confirmed: ConfirmedModelRequest): Error {
  return new Error(
    confirmed.runKind === 'hookModel'
      ? UI_TEXT.requestStaleHookModel
      : UI_TEXT.scheduleConfirmationExpired,
  )
}

/**
 * Whether an error is a lapsed-confirmation refusal carrying the run's own
 * guidance. Branches whose catch maps failures to branch text (the plan
 * retry sentence, the adapter's failure text) let these through unchanged,
 * so a lapsed hook, schedule or review says what lapsed.
 */
export function isStaleConfirmedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === UI_TEXT.requestStaleHookModel ||
      error.message === UI_TEXT.scheduleConfirmationExpired)
  )
}

/**
 * The one confirmed-dispatch gate every provider branch runs: proceed while
 * the confirmation names this model and is still allowed, and refuse with
 * the run's own guidance otherwise. Branches that accept more than the bare
 * session model id (a catalogue id, a provider, an origin) check those
 * fields themselves and pass `isSameModel` for the model half, so a future
 * branch cannot miss a step by hand-copying the condition.
 */
export function assertConfirmedAllowed(
  requestModel: string,
  confirmed: ConfirmedModelRequest | undefined,
  isSameModel: (confirmedModelId: string, requestModel: string) => boolean = (left, right) =>
    left === right,
): void {
  if (
    confirmed !== undefined &&
    (!isSameModel(confirmed.modelId, requestModel) || !confirmed.isStillAllowed())
  ) {
    throw staleConfirmedError(confirmed)
  }
}

/**
 * Mark a confirmed dispatch started: the start receipt and the
 * scheduled-prompt use tally run exactly once, adjacent to the send, with
 * the admission observer right after. Call sites invoke this once per
 * dispatch, after the final gate re-check.
 */
export function noteConfirmedRequestStarted(
  confirmed: ConfirmedModelRequest | undefined,
  admitAttempt: Pick<ResponseAttemptGuard, 'onRequestStarted'> | undefined,
): void {
  confirmed?.onRequestStarted()
  admitAttempt?.onRequestStarted?.()
}

/** Owned synchronous admission and attempt observation; no fields cross the HTTP wire. */
export interface ResponseObservation {
  readonly headers?: UsageHeaders | undefined
  readonly firstTokenMs?: number | undefined
  readonly retries?: number | undefined
  readonly rateLimited?: boolean | undefined
  readonly retryDelayMs?: number | undefined
}

/** Drops all unlisted, oversized and non-ASCII values before observation. */
export function rateLimitHeaders(headers: Headers): UsageHeaders {
  const kept: UsageHeaders = {}
  for (const key of USAGE_HEADER_ALLOW_LIST) {
    const value = headers.get(key)
    if (value !== null && usageHeadersSchema.safeParse({ [key]: value }).success) kept[key] = value
  }
  return kept
}

export interface ResponseAttemptGuard {
  readonly mediaAccounting?: MediaRequestAccounting
  readonly pacingClass?: PacingClass
  readonly searchQuote?: PaidQuote
  readonly onSearchesReturned?: (settlement: SearchSettlement) => void
  readonly prepareRetry?: (keyDigest: string, signal: AbortSignal) => Promise<void>
  /** Durable admission before the synchronous credential/gate fence. */
  readonly prepare?: () => Promise<void>
  readonly reservePaidRequest?: ModelApiClientDeps['reservePaidRequest']
  readonly paidFeature?: PaidFeature
  readonly paidEstimatedInputTokens?: number
  (keyDigest: string | undefined): void
  /** Pure request-policy fence after admission waits and last before dispatch; never reserves. */
  readonly check?: () => void
  /** After every final fence and request build, adjacent to the actual fetch call. */
  readonly onRequestStarted?: () => void
  readonly observe?: (observation: ResponseObservation) => void
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

/** Rejects as soon as `signal` aborts, instead of sleeping the retry delay out. */
function whenAborted(signal: AbortSignal): { readonly promise: Promise<never>; dispose(): void } {
  let onAbort: (() => void) | undefined
  const promise = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(new ModelApiError('cancelled', NETWORK_FAILURE_STATUS, undefined, undefined))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
    }
  })
  return {
    promise,
    dispose: () => {
      if (onAbort !== undefined) {
        signal.removeEventListener('abort', onAbort)
      }
    },
  }
}

const ownerPacers = new WeakMap<object, RequestPacer>()

export class RequestTransport {
  private static hasLoggedObservationFailure = false
  private readonly pacing: RequestPacer
  public constructor(private readonly deps: TransportDeps) {
    this.pacing =
      deps.pacing ??
      (deps.pacingOwner === undefined ? undefined : ownerPacers.get(deps.pacingOwner)) ??
      new ModelApiPacing({ now: deps.now, wait: (ms, signal) => this.pause(ms, signal) })
    if (deps.pacingOwner !== undefined) ownerPacers.set(deps.pacingOwner, this.pacing)
    if (deps.auth !== undefined && deps.verifyEndpoint === undefined) {
      throw new ModelApiError(
        fill(UI_TEXT.webFetchNetwork, { detail: 'endpoint_verifier_required' }),
        0,
        'endpoint_verifier_required',
        undefined,
      )
    }
  }
  private observe(guard: ResponseAttemptGuard | undefined, observation: ResponseObservation): void {
    try {
      guard?.observe?.(observation)
    } catch {
      if (!RequestTransport.hasLoggedObservationFailure) {
        RequestTransport.hasLoggedObservationFailure = true
        this.deps.log.warn('Usage observation failed')
      }
    }
  }

  /** Read authorization fresh for every attempt. */
  private async headers(url: string): Promise<AuthHeaders> {
    if (this.deps.auth !== undefined) {
      return await this.deps.auth.headers(url)
    }
    const key = await this.deps.apiKey?.()
    if (key === undefined) {
      throw new MissingApiKeyError()
    }
    return {
      redact: (text) => redactSecrets(text, [key]),
      values: { Authorization: `Bearer ${key}`, 'Content-Type': JSON_MEDIA_TYPE },
      keyDigest: createHash('sha256').update(key).digest('hex'),
    }
  }

  /** One direct request on the configured endpoint and key: no retry, no redirect. */
  private async sendDirect(
    route: string,
    method: 'GET' | 'POST' | 'DELETE',
    signal: AbortSignal,
    multipart:
      { readonly body: ReadableStream<Uint8Array>; readonly contentType: string } | undefined,
    expectedAccountId: string | undefined,
    beforeFetch?: () => void,
  ): Promise<{ readonly response: Response; readonly redact: (text: string) => string }> {
    const credentials = await this.headers(this.deps.baseUrl)
    signal.throwIfAborted()
    if (expectedAccountId !== undefined && credentials.keyDigest !== expectedAccountId)
      throw new Error(UI_TEXT.media.filesReadOnly)
    const init: RequestInit & { readonly duplex?: 'half' } = {
      method,
      headers: {
        Authorization: credentials.values['Authorization'] ?? '',
        Accept: JSON_MEDIA_TYPE,
        ...(multipart !== undefined && { 'Content-Type': multipart.contentType }),
      },
      redirect: 'error',
      signal,
      ...(multipart !== undefined && { body: multipart.body, duplex: 'half' }),
    }
    await this.deps.verifyEndpoint?.(`${this.deps.baseUrl}${route}`)
    signal.throwIfAborted()
    // The caller's final admission, in the same tick as the fetch.
    beforeFetch?.()
    const response = await this.deps.fetch(`${this.deps.baseUrl}${route}`, init)
    return { response, redact: credentials.redact }
  }

  /** Bound headers and every body read, without timing local admission, backoff or consumers. */
  public async fetchWithIdleDeadline(url: string, init: RequestInit): Promise<Response> {
    const idleMs = this.deps.streamIdleMs ?? MODEL_API_STREAM_IDLE_MS
    const stalled = fill(UI_TEXT.modelApiStalled, {
      seconds: Math.round(idleMs / MILLISECONDS_PER_SECOND),
    })
    const stall = new AbortController()
    const active = AbortSignal.any([
      stall.signal,
      ...(init.signal === undefined || init.signal === null ? [] : [init.signal]),
    ])
    const within = async <T>(waiting: Promise<T>): Promise<T> => {
      if (active.aborted) {
        void waiting.catch(ignoreClosingError)
        throw new ModelApiError('cancelled', NETWORK_FAILURE_STATUS, undefined, undefined)
      }
      const aborted = whenAborted(active)
      try {
        return await withDeadline(Promise.race([waiting, aborted.promise]), idleMs, stalled)
      } catch (error: unknown) {
        if (error instanceof DeadlineError) {
          stall.abort()
          throw new ModelApiError(stalled, NETWORK_FAILURE_STATUS, undefined, undefined)
        }
        throw error
      } finally {
        aborted.dispose()
      }
    }
    const response = await within(this.deps.fetch(url, { ...init, signal: active }))
    if (response.body === null) return response
    const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader()
    const cancel = (reason: unknown) => {
      stall.abort()
      void reader.cancel(reason).catch(ignoreClosingError)
      reader.releaseLock()
    }
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          try {
            const next = await within(reader.read())
            if (next.done) {
              reader.releaseLock()
              controller.close()
            } else {
              controller.enqueue(next.value)
            }
          } catch (error: unknown) {
            controller.error(error)
            cancel(error)
          }
        },
        cancel,
      },
      // Read only when a consumer asks; local event handling has no provider idle timer.
      { highWaterMark: 0 },
    )
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  /** The retry delay, cut short by the turn's Stop. */
  /** Files share this client's configured endpoint and key; uploads are never retried ambiguously. */
  public async requestFile(
    route: string,
    method: 'GET' | 'POST' | 'DELETE',
    signal: AbortSignal,
    multipart?: { readonly body: ReadableStream<Uint8Array>; readonly contentType: string },
    expectedAccountId?: string,
  ): Promise<Response> {
    if (!/^\/files(?:\?after=file-[A-Za-z0-9_-]+|\/file-[A-Za-z0-9_-]+)?$/u.test(route))
      throw new Error('Invalid Files route')
    const sent = await this.sendDirect(route, method, signal, multipart, expectedAccountId)
    if (!sent.response.ok)
      throw await describeFailure(sent.response, this.deps.parseError, sent.redact, this.deps.now())
    return sent.response
  }

  /**
   * U18 / D85.5: the batch transcription POST, and nothing else. The route is
   * the captured `/asr/transcribe?sessionId=<uuid>`; the body is the
   * adapter's multipart. Unlike Files, a refusal is not thrown: the adapter
   * reads the captured 400 body ("The 'audio' part must be…"). The body is
   * read bounded and the key redacted before it is handed back. One attempt:
   * a charged POST is never retried here. `dispatch` is the paid admission,
   * run after the key and endpoint checks, immediately before the fetch.
   */
  public async requestTranscription(
    route: string,
    signal: AbortSignal,
    multipart: { readonly body: ReadableStream<Uint8Array>; readonly contentType: string },
    expectedAccountId: string | undefined,
    dispatch: () => void,
  ): Promise<Response> {
    if (!TRANSCRIPTION_ROUTE.test(route) || !multipart.contentType.startsWith(MULTIPART_PREFIX))
      throw new Error('Invalid transcription route')
    const sent = await this.sendDirect(
      route,
      'POST',
      signal,
      multipart,
      expectedAccountId,
      dispatch,
    )
    const text = sent.redact(await readBoundedText(sent.response))
    return new Response(text, {
      status: sent.response.status,
      statusText: sent.response.statusText,
      headers: { 'Content-Type': sent.response.headers.get('Content-Type') ?? JSON_MEDIA_TYPE },
    })
  }

  public async pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
    if (signal === undefined) {
      await this.deps.sleep(ms)
      return
    }
    if (signal.aborted) {
      throw new ModelApiError('cancelled', NETWORK_FAILURE_STATUS, undefined, undefined)
    }
    const aborted = whenAborted(signal)
    try {
      await Promise.race([this.deps.sleep(ms), aborted.promise])
    } finally {
      aborted.dispose()
    }
  }

  public async currentKeyDigest(): Promise<string> {
    const credentials = await this.headers(this.deps.baseUrl)
    return credentials.keyDigest
  }

  /** Headers and parsed-event progress have an idle deadline; cancellation owns the reader. */
  public async streamRequest(
    path: string,
    init: {
      readonly body: unknown
      readonly headers?: Readonly<Record<string, string>>
      readonly modelId?: string
      readonly pacingClass?: PacingClass
      readonly estimatedTokens?: number
      readonly accept: string
      readonly paid?: {
        readonly claim: PaidRequestClaim
        readonly run?: UnattendedRun | undefined
        isSent: boolean
      }
    },
    signal: AbortSignal,
    onRetry?: (notice: RetryNotice) => void,
    budget?: RetryBudget,
    admitAttempt?: ResponseAttemptGuard,
    confirmed?: ConfirmedModelRequest,
    idleMs = MODEL_API_STREAM_IDLE_MS,
  ): Promise<TransportStreamResponse> {
    const startedAt = this.deps.now()
    const stall = new AbortController()
    const combined = AbortSignal.any([signal, stall.signal])
    const message = fill(UI_TEXT.modelApiStalled, {
      seconds: Math.round(idleMs / MILLISECONDS_PER_SECOND),
    })
    const result = await this.request(
      path,
      { method: 'POST', ...init },
      combined,
      onRetry,
      budget,
      admitAttempt,
      confirmed,
    )
    const { response } = result
    if (response.body === null) {
      throw new ModelApiError(
        fill(UI_TEXT.webFetchNetwork, { detail: 'empty_body' }),
        response.status,
        'empty_body',
        undefined,
      )
    }
    const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader()
    let hasFirstToken = false
    let isClosed = false
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const eventParsed = (event?: StreamEvent) => {
      if (
        !hasFirstToken &&
        event !== undefined &&
        [
          'response.output_text.delta',
          'response.reasoning_summary_text.delta',
          'response.function_call_arguments.delta',
        ].includes(event.type)
      ) {
        hasFirstToken = true
        this.observe(admitAttempt, { firstTokenMs: Math.max(0, this.deps.now() - startedAt) })
      }
      clearTimeout(idleTimer)
      if (!isClosed) {
        idleTimer = setTimeout(() => {
          stall.abort()
        }, idleMs)
      }
    }
    const close = () => {
      if (isClosed) {
        return
      }
      isClosed = true
      clearTimeout(idleTimer)
      combined.removeEventListener('abort', close)
      void reader.cancel().catch(ignoreClosingError)
      reader.releaseLock()
    }
    combined.addEventListener('abort', close, { once: true })
    eventParsed()
    const body = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        const aborted = whenAborted(combined)
        try {
          const next = await Promise.race([reader.read(), aborted.promise])
          // Cancellation can close the reader before the abort promise wins the race.
          if (combined.aborted) {
            throw new ModelApiError(signal.aborted ? 'cancelled' : message, 0, undefined, undefined)
          }
          if (next.done) {
            close()
            controller.close()
          } else {
            controller.enqueue(next.value)
          }
        } catch (error: unknown) {
          close()
          controller.error(
            combined.aborted && !(error instanceof ModelApiError)
              ? new ModelApiError(signal.aborted ? 'cancelled' : message, 0, undefined, undefined)
              : redactModelApiError(error, result.redact, response.status),
          )
        } finally {
          aborted.dispose()
        }
      },
      cancel: () => {
        stall.abort()
        close()
      },
    })
    return {
      ...result,
      eventParsed,
      response: new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
    }
  }

  public backoffMs(attempt: number, suggestedMs?: number): number {
    const jitter = Math.floor(this.deps.random() * MODEL_API_RETRY_JITTER_MS)
    // The provider's own wait is the least it asks for (every provider
    // documents it so): honoured whole up to our retry ceiling. Past the
    // ceiling the ceiling applies — a hostile or corrupt header must not
    // stall a turn for longer than one bounded wait per try. Still waited
    // and still retried, never shortened below what was asked within it.
    if (suggestedMs !== undefined) return Math.min(suggestedMs + jitter, MODEL_API_RETRY_MAX_MS)
    const exponential = Math.min(MODEL_API_RETRY_BASE_MS * 2 ** attempt, MODEL_API_RETRY_MAX_MS)
    return Math.min(exponential + jitter, MODEL_API_RETRY_MAX_MS)
  }

  /**
   * One request with the documented retry policy. The response is handed
   * back unread on success; a non-2xx status becomes a `ModelApiError`.
   */
  public async request(
    path: string,
    init: {
      readonly method: 'GET' | 'POST'
      readonly body?: unknown
      readonly modelId?: string
      readonly pacingClass?: PacingClass
      readonly estimatedTokens?: number
      readonly accept: string
      /**
       * `rateLimitOnly` for a request that bills per call (M34, the review
       * of PR #27): a 429 was refused before any work and is retried; a
       * lost connection or a server error may have been done and billed,
       * so it is not.
       */
      readonly headers?: Readonly<Record<string, string>>
      readonly retries?: 'all' | 'rateLimitOnly'
      readonly paid?: {
        readonly claim: PaidRequestClaim
        readonly run?: UnattendedRun | undefined
        isSent: boolean
      }
    },
    signal: AbortSignal | undefined,
    onRetry?: (notice: RetryNotice) => void,
    budget?: RetryBudget,
    admitAttempt?: ResponseAttemptGuard,
    confirmed?: ConfirmedModelRequest,
  ): Promise<TransportResponse> {
    const provider = this.deps.pacingProvider?.(init.modelId) ?? {
      identity: { provider: 'meta' },
      readLimits: metaPacingLimits,
    }
    const isGoverned = isPacingGoverned(path, init.modelId, provider.identity.provider)
    // Meta observes only its governed paths; a configured provider observes
    // every answer through its own header reader (undefined where the
    // provider sends no limit headers, so only a 429 pause applies).
    const shouldObserveLimits =
      isGoverned || path === '/responses/input_tokens' || provider.identity.provider !== 'meta'
    const isRateLimitOnly =
      init.retries === 'rateLimitOnly' ||
      init.paid !== undefined ||
      admitAttempt?.mediaAccounting !== undefined
    const url = `${this.deps.baseUrl}${path}`
    if (!path.startsWith('/') || new URL(url).origin !== new URL(this.deps.baseUrl).origin) {
      throw new ModelApiError(
        fill(UI_TEXT.webFetchNetwork, { detail: 'origin_mismatch' }),
        0,
        'origin_mismatch',
        undefined,
      )
    }
    const retry = async (attempt: number, delay: number, reason: string) => {
      if (budget !== undefined) {
        budget.retriesUsed = attempt + 1
      }
      this.observe(admitAttempt, { retries: attempt + 1 })
      onRetry?.({
        attempt: attempt + 1,
        maxAttempts: MODEL_API_MAX_RETRIES + 1,
        delayMs: delay,
        reason,
      })
      await this.pause(delay, signal)
    }
    // How long the answer took, retries included, at trace level (M39).
    const startedAt = this.deps.now()
    for (let attempt = budget?.retriesUsed ?? 0; ; attempt += 1) {
      // Rebuild on every retry: rotation may change the vault while we wait.
      // Outside the transport retry catch: a scrub failure must never send.
      const scrubGeneration = this.deps.vaultScrub?.generation
      const wireBody =
        this.deps.vaultScrub === undefined || init.body === undefined
          ? undefined
          : await scrubSecrets(JSON.stringify(init.body), this.deps.vaultScrub)
      if (wireBody !== undefined && this.deps.vaultScrub !== undefined) {
        // Exact-value replacement must still leave valid JSON. No raw body
        // can be sent if an unusual value matched protocol syntax.
        JSON.parse(wireBody)
      }
      let credentials: Awaited<ReturnType<RequestTransport['headers']>>
      try {
        credentials = await this.headers(url)
      } catch (error: unknown) {
        if (isAborted(signal)) {
          throw new ModelApiError('cancelled', NETWORK_FAILURE_STATUS, undefined, undefined)
        }
        if (error instanceof MissingApiKeyError) {
          admitAttempt?.(undefined)
        }
        throw error
      }
      if (isAborted(signal)) {
        throw new ModelApiError('cancelled', NETWORK_FAILURE_STATUS, undefined, undefined)
      }
      admitAttempt?.check?.()
      await this.deps.verifyEndpoint?.(url)
      if (isAborted(signal)) {
        throw new ModelApiError('cancelled', NETWORK_FAILURE_STATUS, undefined, undefined)
      }
      admitAttempt?.check?.()
      if (
        confirmed !== undefined &&
        (credentials.keyDigest !== confirmed.keyDigest ||
          (confirmed.origin !== undefined && confirmed.origin !== new URL(url).origin) ||
          !confirmed.isStillAllowed())
      ) {
        throw staleConfirmedError(confirmed)
      }
      // A scheduled fire's authority is live: checked before pacing and again
      // after it, since revocation or a key change can land during the wait.
      const assertScheduleAuthority = () => {
        if (init.method !== 'POST' || (path !== '/responses' && !path.startsWith('/images/')))
          return
        const run = this.deps.scheduledRun?.()
        if (
          (run !== init.paid?.run && (run !== undefined || init.paid?.run !== undefined)) ||
          (run !== undefined && (!run.isActive() || credentials.keyDigest !== run.paid?.accountId))
        )
          throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
      }
      assertScheduleAuthority()
      const account = `${provider.identity.provider}:${this.deps.baseUrl}:${credentials.keyDigest}`
      const kind = init.pacingClass ?? 'foreground'
      if (isGoverned) {
        const admission = new AbortController()
        try {
          await withDeadline(
            this.pacing.acquire(
              account,
              kind,
              init.estimatedTokens ?? 0,
              AbortSignal.any([signal ?? new AbortController().signal, admission.signal]),
              (delayMs) =>
                onRetry?.({
                  phase: 'pacing',
                  attempt,
                  maxAttempts: MODEL_API_MAX_RETRIES + 1,
                  delayMs,
                  reason: UI_TEXT.modelApiPacingWaiting,
                }),
            ),
            PACING_ADMISSION_TIMEOUT_MS,
            UI_TEXT.modelApiPacingExpired,
          )
        } finally {
          admission.abort()
        }
        admitAttempt?.check?.()
        if (kind !== 'foreground' && credentials.keyDigest !== (await this.currentKeyDigest()))
          throw new Error(UI_TEXT.notSignedInReason)
      }
      if (isAborted(signal))
        throw new ModelApiError('cancelled', NETWORK_FAILURE_STATUS, undefined, undefined)
      assertScheduleAuthority()
      // Local consent refusal is outside the transport retry catch: it never
      // becomes another billable attempt.
      await admitAttempt?.prepare?.()
      admitAttempt?.check?.()
      if (init.paid !== undefined) {
        if (init.paid.isSent) {
          throw new Error(UI_TEXT.sessionBudgetRetryUnavailable)
        }
        init.paid.claim.check(Usd.from(0).toAmount())
      }
      if (
        admitAttempt?.searchQuote !== undefined &&
        this.deps.paidAuthority !== undefined &&
        !this.deps.paidAuthority.canSpend(admitAttempt.searchQuote)
      )
        throw new Error(UI_TEXT.sessionBudgetSearchUnavailable)
      admitAttempt?.mediaAccounting?.check()
      admitAttempt?.(credentials.keyDigest)
      if (isAborted(signal)) {
        throw new ModelApiError('cancelled', NETWORK_FAILURE_STATUS, undefined, undefined)
      }
      if (confirmed !== undefined && !confirmed.isStillAllowed()) {
        throw staleConfirmedError(confirmed)
      }
      if (
        wireBody !== undefined &&
        scrubGeneration !== undefined &&
        this.deps.vaultScrub?.generation !== scrubGeneration
      ) {
        // The vault rotated during admission: the scrubbed body is
        // older than the values, so rebuild it instead of sending. A Lock in
        // the same window fails the rebuild, which never sends either.
        continue
      }
      const metadata = Object.fromEntries(
        Object.entries(init.headers ?? {}).filter(
          ([name]) =>
            ![
              'authorization',
              'x-api-key',
              'x-goog-api-key',
              'api-key',
              'content-type',
              'accept',
            ].includes(name.toLowerCase()),
        ),
      )
      // Preserve Meta's request shape; remove case variants before applying authoritative headers.
      const headers = {
        ...metadata,
        ...credentials.values,
        'Content-Type': JSON_MEDIA_TYPE,
        Accept: init.accept,
      }
      const requestInit: RequestInit = {
        method: init.method,
        redirect: 'error',
        headers,
        ...(init.body !== undefined && { body: wireBody ?? JSON.stringify(init.body) }),
        ...(signal !== undefined && { signal }),
      }
      admitAttempt?.check?.()
      noteConfirmedRequestStarted(confirmed, admitAttempt)
      if (init.paid !== undefined) {
        init.paid.isSent = true
      }
      const sent = this.pacing.snapshot(account)
      admitAttempt?.mediaAccounting?.started()
      let response: Response
      try {
        response = await this.fetchWithIdleDeadline(url, requestInit)
      } catch (error: unknown) {
        if (isModelApiError(error) || signal?.aborted === true) {
          throw isModelApiError(error)
            ? redactModelApiError(error, credentials.redact, NETWORK_FAILURE_STATUS)
            : new ModelApiError(
                credentials.redact(error instanceof Error ? error.message : String(error)),
                NETWORK_FAILURE_STATUS,
                undefined,
                undefined,
              )
        }
        // A refusal the product raised inside the send (an endpoint pin, a
        // budget or ledger stop) is no connection failure: it passes on with
        // its own message and type and is never retried (lane PROVERRORS).
        if (!isConnectionFailure(error)) throw error
        // No answer came: its causes say why, and the message names the
        // setting or store to check (M56, PLAN.md D43), or the provider and
        // the unknown fate of the send (lane PROVERRORS). A transient send
        // failure is retried below, as Anthropic documents its SDK doing
        // ("automatically retries transient failures (such as connection
        // errors …) with exponential backoff", platform.claude.com/docs/en/
        // api/errors, read 2026-10-17); the retry notice marks the attempt
        // ambiguous, since the send may have arrived.
        const reason = credentials.redact(
          this.deps.sendFailure?.(error) ?? networkFailureMessage(error, this.deps.networkAdvice),
        )
        if (isRateLimitOnly || attempt >= MODEL_API_MAX_RETRIES) {
          throw new ModelApiError(reason, NETWORK_FAILURE_STATUS, undefined, undefined)
        }
        const delay = this.backoffMs(attempt, undefined)
        this.deps.log.warn(
          `Model API request failed to send (${credentials.redact(describeNetworkFailure(error).detail)}); retrying in ${String(delay)} ms`,
        )
        await retry(attempt, delay, reason)
        continue
      }
      if (shouldObserveLimits)
        this.pacing.observe(
          account,
          provider.readLimits?.(response.headers),
          response.status === HTTP_TOO_MANY_REQUESTS
            ? (providerWaitMs(response.headers, this.deps.now()) ??
                Math.min(MODEL_API_RETRY_BASE_MS * 2 ** attempt, MODEL_API_RETRY_MAX_MS))
            : undefined,
          sent,
        )
      this.observe(admitAttempt, {
        headers: rateLimitHeaders(response.headers),
        ...(!response.ok && { rateLimited: response.status === HTTP_TOO_MANY_REQUESTS }),
      })
      if (response.ok) {
        this.deps.log.trace(
          `Model API ${init.method} ${credentials.redact(path)} answered ${String(response.status)} in ${String(this.deps.now() - startedAt)} ms`,
        )
        const secrets = Object.entries(credentials.values)
          .filter(([name]) =>
            ['authorization', 'x-api-key', 'x-goog-api-key', 'api-key'].includes(
              name.toLowerCase(),
            ),
          )
          .map(([, value]) => (value.startsWith('Bearer ') ? value.slice('Bearer '.length) : value))
        return {
          response,
          redact: credentials.redact,
          redactContent: secretRedactor(secrets, false),
        }
      }
      const failure = await describeFailure(
        response,
        this.deps.parseError,
        credentials.redact,
        this.deps.now(),
      )
      if (response.status === HTTP_TOO_MANY_REQUESTS || response.status === HTTP_STATUS.badRequest)
        admitAttempt?.mediaAccounting?.refused()
      if (
        init.paid !== undefined &&
        (response.status === HTTP_TOO_MANY_REQUESTS || response.status === HTTP_STATUS.badRequest)
      ) {
        init.paid.isSent = false
      }
      // The wait the provider named, in whichever form it used, is waited
      // out whole before the next try (lane PROVERRORS).
      const waitMs = failure.retryAfterMs
      // OPENAI-G20: the preset's own retry table decides, so its override
      // (e.g. OpenAI's documented retryable `server_error`) is read, not
      // skipped. The envelope kind/code the parsers carry is what lets a
      // quota 429 refuse while a bare one retries.
      const decision = classifyRetry(this.deps.retryTable ?? RETRY_TABLES.responses, {
        status: response.status,
        kind: failure.kind,
        code: failure.code,
        message: failure.message,
      })
      const isRetryable =
        (this.deps.isRetryableFailure?.(failure) ?? decision.retry) &&
        (!isRateLimitOnly || response.status === HTTP_TOO_MANY_REQUESTS)
      if (!isRetryable || attempt >= MODEL_API_MAX_RETRIES) {
        if (
          response.status >= HTTP_STATUS.internalServerError &&
          provider.identity.provider === 'meta'
        )
          notify(
            [() => this.deps.onServiceFailure?.(response.status, `${MODEL_API_BASE_URL}/status`)],
            undefined,
            this.deps.log,
            'modelApi.serviceFailure',
          )
        throw failure
      }
      const delay = this.backoffMs(attempt, waitMs)
      // The provider's words can carry a masked-key remnant or an account
      // id (PLAN.md D118): the log file keeps the scrubbed form only.
      this.deps.log.warn(
        `Model API answered ${String(response.status)} (${scrubRefusalLeak(failure.message)}); retrying in ${String(delay)} ms`,
      )
      if (
        response.status === PROVIDER_RETRY_HTTP_STATUS.gatewayTimeout &&
        admitAttempt?.prepareRetry !== undefined
      )
        await admitAttempt.prepareRetry(
          credentials.keyDigest,
          signal ?? new AbortController().signal,
        )
      await retry(attempt, delay, `HTTP ${String(response.status)}: ${failure.message}`)
    }
  }
}
