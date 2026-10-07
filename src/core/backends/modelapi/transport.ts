// M95-T: the existing retry/admission loop, shared by Meta and injected codecs.
import { createHash } from 'node:crypto'
import {
  MODEL_API_MAX_RETRIES,
  HTTP_TOO_MANY_REQUESTS,
  HTTP_STATUS,
  MODEL_API_RETRY_BASE_MS,
  MODEL_API_RETRY_JITTER_MS,
  MODEL_API_RETRY_MAX_MS,
  MILLISECONDS_PER_SECOND,
  UI_TEXT,
  PROVIDER_HTTP_BODY_MAX_BYTES,
  MODEL_API_STREAM_IDLE_MS,
} from '../../../shared/constants'
import type { PaidFeature } from '../../../shared/constants'
import type { SessionBudgetClaim } from './sessionBudget'
import { fill } from '../../../shared/l10n/text'
import { classifyRetry, RETRY_TABLES } from '../../../shared/retryPolicy'
import type { CoreLogger } from '../../logging'
import {
  describeNetworkFailure,
  type NetworkAdvice,
  networkFailureMessage,
} from '../../networkFailure'
import { redactSecrets } from '../../redact'
export { redactSecrets } from '../../redact'
import { errorBodySchema } from './schemas'
import type { StreamEvent } from './schemas'
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
  readonly scheduledRun?: () => UnattendedRun | undefined
  readonly fetch: typeof fetch
  readonly baseUrl: string
  readonly apiKey?: () => Promise<string | undefined>
  readonly auth?: AuthSource
  /** Required by CodecClient: resolve/recheck against the saved network on every attempt. */
  readonly verifyEndpoint?: (url: string) => Promise<void>
  readonly parseError?: (status: number, body: unknown, headers: Headers) => ModelApiError
  readonly isTerminalError?: (error: ModelApiError) => boolean
  readonly sleep: (ms: number) => Promise<void>
  readonly now: () => number
  readonly random: () => number
  readonly log: CoreLogger
  readonly networkAdvice?: NetworkAdvice
}

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
  return new ModelApiError(
    error instanceof SyntaxError
      ? fill(UI_TEXT.webFetchNetwork, { detail: 'malformed_json' })
      : redact(error instanceof Error ? error.message : String(error)),
    isModelApiError(error) ? error.status : fallbackStatus,
    isModelApiError(error) && error.kind !== undefined ? redact(error.kind) : undefined,
    isModelApiError(error) && error.code !== undefined ? redact(error.code) : undefined,
  )
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
const NETWORK_FAILURE_STATUS = 0

/** The documented error envelope, or the status text when the body is not one. */
async function describeFailure(
  response: Response,
  parseError: TransportDeps['parseError'],
  redact: (text: string) => string,
): Promise<ModelApiError> {
  let body: unknown
  try {
    body = JSON.parse(await readBoundedText(response), (_key, value: unknown) =>
      typeof value === 'string' ? redact(value) : value,
    )
  } catch {
    body = undefined
  }
  if (parseError !== undefined) {
    try {
      return redactModelApiError(
        parseError(response.status, body, response.headers),
        redact,
        response.status,
      )
    } catch (error: unknown) {
      return redactModelApiError(error, redact, response.status)
    }
  }
  const parsed = errorBodySchema.safeParse(body)
  if (!parsed.success) {
    return new ModelApiError(
      redact(`HTTP ${String(response.status)} ${response.statusText}`.trim()),
      response.status,
      undefined,
      undefined,
    )
  }
  const { error } = parsed.data
  return new ModelApiError(
    redact(error.message),
    response.status,
    error.type == null ? undefined : redact(error.type),
    error.code == null ? undefined : redact(error.code),
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

/** One retry the client is about to make, for the transcript's notice. */
export interface RetryNotice {
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
  /** The paid gate and session model must still match before every HTTP try. */
  readonly isStillAllowed: () => boolean
  /** Only after identity and gate checks, immediately before the first HTTP try. */
  readonly onRequestStarted: () => void
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
  /** Durable admission before the synchronous credential/gate fence. */
  readonly prepare?: () => Promise<void>
  readonly reservePaidRequest?: ModelApiClientDeps['reservePaidRequest']
  readonly paidFeature?: PaidFeature
  readonly paidEstimatedInputTokens?: number
  (keyDigest: string | undefined): void
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

export class RequestTransport {
  private static hasLoggedObservationFailure = false
  public constructor(private readonly deps: TransportDeps) {
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

  /** The retry delay, cut short by the turn's Stop. */
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
      readonly accept: string
      readonly paid?: {
        readonly claim: SessionBudgetClaim
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
    const within = async <T>(work: Promise<T>): Promise<T> => {
      const aborted = whenAborted(combined)
      try {
        return await withDeadline(Promise.race([work, aborted.promise]), idleMs, message)
      } catch (error: unknown) {
        if (error instanceof DeadlineError) {
          stall.abort()
          throw new ModelApiError(message, 0, undefined, undefined)
        }
        throw error
      } finally {
        aborted.dispose()
      }
    }
    const result = await within(
      this.request(
        path,
        { method: 'POST', ...init },
        combined,
        onRetry,
        budget,
        admitAttempt,
        confirmed,
      ),
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
    const exponential = Math.min(MODEL_API_RETRY_BASE_MS * 2 ** attempt, MODEL_API_RETRY_MAX_MS)
    const jitter = Math.floor(this.deps.random() * MODEL_API_RETRY_JITTER_MS)
    return Math.min((suggestedMs ?? exponential) + jitter, MODEL_API_RETRY_MAX_MS)
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
        readonly claim: SessionBudgetClaim
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
    const isRateLimitOnly = init.retries === 'rateLimitOnly' || init.paid !== undefined
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
      await this.deps.verifyEndpoint?.(url)
      if (isAborted(signal)) {
        throw new ModelApiError('cancelled', NETWORK_FAILURE_STATUS, undefined, undefined)
      }
      if (
        confirmed !== undefined &&
        (credentials.keyDigest !== confirmed.keyDigest ||
          (confirmed.origin !== undefined && confirmed.origin !== new URL(url).origin) ||
          !confirmed.isStillAllowed())
      ) {
        throw new Error(UI_TEXT.scheduleConfirmationExpired)
      }
      if (init.method === 'POST' && (path === '/responses' || path.startsWith('/images/'))) {
        const run = this.deps.scheduledRun?.()
        if (
          (run !== init.paid?.run && (run !== undefined || init.paid?.run !== undefined)) ||
          (run !== undefined && (!run.isActive() || credentials.keyDigest !== run.paid?.accountId))
        )
          throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
      }
      // Local consent refusal is outside the transport retry catch: it never
      // becomes another billable attempt.
      await admitAttempt?.prepare?.()
      if (init.paid !== undefined) {
        if (init.paid.isSent) {
          throw new Error(UI_TEXT.sessionBudgetRetryUnavailable)
        }
        init.paid.claim.check(0)
      }
      admitAttempt?.(credentials.keyDigest)
      if (isAborted(signal)) {
        throw new ModelApiError('cancelled', NETWORK_FAILURE_STATUS, undefined, undefined)
      }
      if (confirmed !== undefined && !confirmed.isStillAllowed()) {
        throw new Error(UI_TEXT.scheduleConfirmationExpired)
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
        ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
        ...(signal !== undefined && { signal }),
      }
      confirmed?.onRequestStarted()
      admitAttempt?.onRequestStarted?.()
      if (init.paid !== undefined) {
        init.paid.isSent = true
      }
      let response: Response
      try {
        response = await this.deps.fetch(url, requestInit)
      } catch (error: unknown) {
        if (error instanceof ModelApiError || signal?.aborted === true) {
          throw error instanceof ModelApiError
            ? redactModelApiError(error, credentials.redact, NETWORK_FAILURE_STATUS)
            : new ModelApiError(
                credentials.redact(error instanceof Error ? error.message : String(error)),
                NETWORK_FAILURE_STATUS,
                undefined,
                undefined,
              )
        }
        // Never reached the server: its causes say why, and the message
        // names the setting or store to check (M56, PLAN.md D43).
        const reason = credentials.redact(
          this.deps.auth === undefined
            ? networkFailureMessage(error, this.deps.networkAdvice)
            : fill(UI_TEXT.webFetchNetwork, {
                detail: `${new URL(url).origin}: ${describeNetworkFailure(error).detail}`,
              }),
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
          redactContent: (text) => redactSecrets(text, secrets, false),
        }
      }
      const failure = await describeFailure(response, this.deps.parseError, credentials.redact)
      if (
        init.paid !== undefined &&
        (response.status === HTTP_TOO_MANY_REQUESTS || response.status === HTTP_STATUS.badRequest)
      ) {
        init.paid.isSent = false
      }
      const waitMs = retryAfterMs(response.headers.get(RETRY_AFTER_HEADER), this.deps.now())
      const decision = classifyRetry(RETRY_TABLES.responses, {
        status: response.status,
        kind: failure.kind,
        code: failure.code,
        message: failure.message,
        retryAfterMs: waitMs,
      })
      if (!decision.retry && decision.reason === 'retry-after-cap') {
        throw new ModelApiError(
          fill(UI_TEXT.modelApiRetryAfterTooLong, {
            wait: Math.ceil((waitMs ?? 0) / MILLISECONDS_PER_SECOND),
            cap: RETRY_TABLES.responses.retryAfterCapMs / MILLISECONDS_PER_SECOND,
          }),
          response.status,
          failure.kind,
          failure.code,
        )
      }
      const isRetryable =
        !this.deps.isTerminalError?.(failure) &&
        decision.retry &&
        (!isRateLimitOnly || response.status === HTTP_TOO_MANY_REQUESTS)
      if (!isRetryable || attempt >= MODEL_API_MAX_RETRIES) {
        throw failure
      }
      const delay = this.backoffMs(attempt, waitMs)
      this.deps.log.warn(
        `Model API answered ${String(response.status)} (${failure.message}); retrying in ${String(delay)} ms`,
      )
      await retry(attempt, delay, `HTTP ${String(response.status)}: ${failure.message}`)
    }
  }
}
