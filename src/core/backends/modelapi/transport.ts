// M95-T: the existing retry/admission loop, shared by Meta and injected codecs.
import { createHash } from 'node:crypto'
import {
  MODEL_API_MAX_RETRIES,
  HTTP_TOO_MANY_REQUESTS,
  MODEL_API_RETRY_BASE_MS,
  MODEL_API_RETRY_JITTER_MS,
  MODEL_API_RETRY_MAX_MS,
  MODEL_API_RETRYABLE_STATUSES,
  MILLISECONDS_PER_SECOND,
  UI_TEXT,
  PROVIDER_HTTP_BODY_MAX_BYTES,
  MODEL_API_STREAM_IDLE_MS,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import type { CoreLogger } from '../../logging'
import {
  describeNetworkFailure,
  type NetworkAdvice,
  networkFailureMessage,
} from '../../networkFailure'
import { redactSecrets } from '../../redact'
import { errorBodySchema } from './schemas'
import type { AuthHeaders, AuthSource } from './authSource'
import { DeadlineError, withDeadline } from '../../timeouts'

export interface TransportDeps {
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
    (value instanceof Error &&
      (value.name === 'ModelApiError' || value.name === 'CredentialOriginError') &&
      'status' in value &&
      typeof value.status === 'number' &&
      Number.isFinite(value.status) &&
      'kind' in value &&
      (value.kind === undefined || typeof value.kind === 'string') &&
      'code' in value &&
      (value.code === undefined || typeof value.code === 'string'))
  )
}

/** Use at every adapter/error boundary, including a parser that throws while reading headers. */
export function redactModelApiError(
  error: unknown,
  redact: (text: string) => string,
  fallbackStatus: number,
): ModelApiError {
  return new ModelApiError(
    redact(error instanceof Error ? error.message : String(error)),
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
  readonly providerId?: string
  readonly origin?: string
  /** The paid gate and session model must still match before every HTTP try. */
  readonly isStillAllowed: () => boolean
  /** Only after identity and gate checks, immediately before the first HTTP try. */
  readonly onRequestStarted: () => void
}

/** Owned synchronous admission and attempt observation; no fields cross the HTTP wire. */
export interface ResponseAttemptGuard {
  (keyDigest: string | undefined): void
  /** After every final fence and request build, adjacent to the actual fetch call. */
  readonly onRequestStarted?: () => void
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

  /** Headers and each stream read have the same idle deadline; cancellation owns the reader. */
  public async streamRequest(
    path: string,
    init: {
      readonly body: unknown
      readonly headers?: Readonly<Record<string, string>>
      readonly accept: string
    },
    signal: AbortSignal,
    onRetry?: (notice: RetryNotice) => void,
    budget?: RetryBudget,
    admitAttempt?: ResponseAttemptGuard,
    confirmed?: ConfirmedModelRequest,
    idleMs = MODEL_API_STREAM_IDLE_MS,
  ): Promise<TransportResponse> {
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
    let isClosed = false
    const close = () => {
      if (isClosed) {
        return
      }
      isClosed = true
      combined.removeEventListener('abort', close)
      void reader.cancel().catch(ignoreClosingError)
      reader.releaseLock()
    }
    combined.addEventListener('abort', close, { once: true })
    const body = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        try {
          const next = await within(reader.read())
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
              : error,
          )
        }
      },
      cancel: () => {
        stall.abort()
        close()
      },
    })
    return {
      ...result,
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
    },
    signal: AbortSignal | undefined,
    onRetry?: (notice: RetryNotice) => void,
    budget?: RetryBudget,
    admitAttempt?: ResponseAttemptGuard,
    confirmed?: ConfirmedModelRequest,
  ): Promise<TransportResponse> {
    const isRateLimitOnly = init.retries === 'rateLimitOnly'
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
      // Local consent refusal is outside the transport retry catch: it never
      // becomes another billable attempt.
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
      if (response.ok) {
        this.deps.log.trace(
          `Model API ${init.method} ${credentials.redact(path)} answered ${String(response.status)} in ${String(this.deps.now() - startedAt)} ms`,
        )
        return { response, redact: credentials.redact }
      }
      const failure = await describeFailure(response, this.deps.parseError, credentials.redact)
      const isRetryable =
        !this.deps.isTerminalError?.(failure) &&
        (isRateLimitOnly
          ? response.status === HTTP_TOO_MANY_REQUESTS
          : MODEL_API_RETRYABLE_STATUSES.has(response.status))
      if (!isRetryable || attempt >= MODEL_API_MAX_RETRIES) {
        throw failure
      }
      const delay = this.backoffMs(
        attempt,
        retryAfterMs(response.headers.get(RETRY_AFTER_HEADER), this.deps.now()),
      )
      this.deps.log.warn(
        `Model API answered ${String(response.status)} (${failure.message}); retrying in ${String(delay)} ms`,
      )
      await retry(attempt, delay, `HTTP ${String(response.status)}: ${failure.message}`)
    }
  }
}
