// A thin, schema-validated Model API client (PLAN.md D2, M34, D86.6):
// models, token counts, streamed responses, generated/edited images and
// public service health.
// Errors follow the documented envelope and retry policy
// (PLAN.md D86.6): 429 / 500 / 502 / 503 / 504 are
// retried with exponential backoff and jitter, honouring `Retry-After`,
// before any of the response has been read; everything else surfaces as a
// `ModelApiError`. `fetch`, the clock and the key are injected.

import { createHash } from 'node:crypto'
import type { PaidFeature } from '../../../shared/constants'
import type { SessionBudgetClaim } from './sessionBudget'

import {
  MODEL_API_MAX_RETRIES,
  MODEL_API_BASE_URL,
  HTTP_TOO_MANY_REQUESTS,
  HTTP_STATUS,
  IMAGE_REQUEST_TIMEOUT_MS,
  MODEL_API_RETRY_BASE_MS,
  MODEL_API_RETRY_JITTER_MS,
  MODEL_API_RETRY_MAX_MS,
  MODEL_API_RETRYABLE_STATUSES,
  MODEL_API_REQUEST_TIMEOUT_MS,
  MODEL_API_STREAM_IDLE_MS,
  MILLISECONDS_PER_SECOND,
  UI_TEXT,
  PACING_ADMISSION_TIMEOUT_MS,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { DeadlineError, withDeadline } from '../../timeouts'
import type { CoreLogger } from '../../logging'
import {
  describeNetworkFailure,
  type NetworkAdvice,
  networkFailureMessage,
} from '../../networkFailure'
import {
  type CreateImageBody,
  type EditImageBody,
  type CreateResponseBody,
  errorBodySchema,
  eventTypeSchema,
  type ImagesResponse,
  imagesResponseSchema,
  inputTokensSchema,
  modelListSchema,
  modelApiStatusSchema,
  type StreamEvent,
  streamEventSchema,
} from './schemas'
import { parseSse } from './sse'
import { estimateCostUsd } from '../../usage/insights'
import {
  ModelApiPacing,
  metaPacingLimits,
  type PacingClass,
  type PacingProvider,
  type RequestPacer,
} from './pacing'
import { fanOutPacingClass } from './subagentTools'
import { redactSecrets } from '../../redact'

export interface ModelApiClientDeps {
  /** Share across clients for one process; omitted clients own a bucket themselves. */
  readonly pacing?: RequestPacer
  /** M95 binding: project the selected record's provider and captured header interpreter. */
  readonly pacingProvider?: (modelId: string | undefined) => PacingProvider
  /** M101 binding: FormatQuirks.retry's classification, after its quota fences. */
  readonly isRetryableFailure?: (
    failure: ModelApiError,
    retryAfterMs: number | undefined,
  ) => boolean
  /** The host presents a 5xx banner with this public link; no response text crosses this port. */
  readonly onServiceFailure?: (status: number, statusUrl: string) => void
  /** Interactive VS Code extras only; ACP/headless clients omit this port. */
  readonly reservePaidRequest?: (
    body: CreateResponseBody | CreateImageBody,
    feature: PaidFeature,
    estimatedInputTokens?: number,
    signal?: AbortSignal,
  ) => Promise<SessionBudgetClaim | undefined>
  readonly fetch: typeof fetch
  readonly baseUrl: string
  /** Read per request so a key pasted later applies without a restart. */
  readonly apiKey: () => Promise<string | undefined>
  readonly sleep: (ms: number) => Promise<void>
  /** Epoch ms, for a `Retry-After` given as a date. */
  readonly now: () => number
  /** 0 ≤ n < 1, for the retry jitter; injected so tests are deterministic. */
  readonly random: () => number
  readonly log: CoreLogger
  /** Idle limit for headers and all response-body reads; tests may shorten it. */
  readonly streamIdleMs?: number
  /**
   * Whose settings a request that never reached Meta names (M56): VS Code's
   * unless the ACP agent says its own (PLAN.md D62, Q66).
   */
  readonly networkAdvice?: NetworkAdvice
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

/** Thrown when the key is absent: the caller decides how to prompt. */
export class MissingApiKeyError extends Error {
  public constructor() {
    super('No Model API key is stored')
    this.name = 'MissingApiKeyError'
  }
}

/**
 * Whether `error` is a `ModelApiError`, by name and fields rather than
 * `instanceof`: Tab's bundle crosses a bundle boundary where `instanceof`
 * fails (M94, PLAN.md D73).
 */
export function isModelApiError(error: unknown): error is ModelApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'ModelApiError' &&
    'status' in error &&
    typeof error.status === 'number' &&
    'message' in error &&
    typeof error.message === 'string'
  )
}

/**
 * Whether `error` is a `MissingApiKeyError`, by name rather than
 * `instanceof` (see above).
 */
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
const EVENT_STREAM_MEDIA_TYPE = 'text/event-stream'
const RETRY_AFTER_HEADER = 'retry-after'
const NETWORK_FAILURE_STATUS = 0
const SSE_DONE_SENTINEL = '[DONE]'
/** HTTP's gateway timeout code, not an inferred vendor error kind. */
const HTTP_GATEWAY_TIMEOUT = 504

/** Closing a parser that already failed rejects with that failure, which the stream reported. */
function ignoreClosingError(): void {
  // Nothing to add: the stream's own error already went to its caller.
}

/** The documented error envelope, or the status text when the body is not one. */
async function describeFailure(response: Response): Promise<ModelApiError> {
  let body: unknown
  try {
    body = await response.json()
  } catch (error: unknown) {
    if (error instanceof ModelApiError) throw error
    body = undefined
  }
  const parsed = errorBodySchema.safeParse(body)
  if (!parsed.success) {
    return new ModelApiError(
      `HTTP ${String(response.status)} ${response.statusText}`.trim(),
      response.status,
      undefined,
      undefined,
    )
  }
  const { error } = parsed.data
  return new ModelApiError(
    error.message,
    response.status,
    error.type ?? undefined,
    error.code ?? undefined,
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
  /** A local admission wait is neither a failed attempt nor a billed retry. */
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
  /** The paid gate and session model must still match before every HTTP try. */
  readonly isStillAllowed: () => boolean
  /** Only after identity and gate checks, immediately before the first HTTP try. */
  readonly onRequestStarted: () => void
}

/** Owned synchronous admission and attempt observation; no fields cross the HTTP wire. */
export interface ResponseAttemptGuard {
  readonly pacingClass?: PacingClass
  readonly paidFeature?: PaidFeature
  readonly paidEstimatedInputTokens?: number
  (keyDigest: string | undefined): void
  /** After every final fence and request build, adjacent to the actual fetch call. */
  readonly onRequestStarted?: () => void
  /** A capped owner retains the old liability and reserves the next try before admitting it. */
  readonly prepareRetry?: (keyDigest: string, signal: AbortSignal) => Promise<void>
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

export class ModelApiClient {
  /** Stream event types already logged as ignored (M39). */
  private readonly ignoredEventTypes = new Set<string>()
  private readonly pacing: RequestPacer

  public constructor(private readonly deps: ModelApiClientDeps) {
    this.pacing =
      deps.pacing ??
      new ModelApiPacing({
        now: deps.now,
        wait: (ms, signal) => this.pause(ms, signal),
      })
  }

  private pacingProvider(modelId: string | undefined): PacingProvider {
    return (
      this.deps.pacingProvider?.(modelId) ?? {
        identity: { provider: 'meta' },
        readLimits: metaPacingLimits,
      }
    )
  }

  /** The retry delay, cut short by the turn's Stop. */
  private async pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
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

  private async headers(): Promise<{
    readonly values: Record<string, string>
    readonly keyDigest: string
  }> {
    const key = await this.deps.apiKey()
    if (key === undefined) {
      throw new MissingApiKeyError()
    }
    return {
      values: { Authorization: `Bearer ${key}`, 'Content-Type': JSON_MEDIA_TYPE },
      keyDigest: createHash('sha256').update(key).digest('hex'),
    }
  }

  private backoffMs(attempt: number, suggestedMs: number | undefined): number {
    const exponential = Math.min(MODEL_API_RETRY_BASE_MS * 2 ** attempt, MODEL_API_RETRY_MAX_MS)
    const jitter = Math.floor(this.deps.random() * MODEL_API_RETRY_JITTER_MS)
    return Math.min((suggestedMs ?? exponential) + jitter, MODEL_API_RETRY_MAX_MS)
  }

  /** Bound headers and every body read, without timing local admission, backoff or consumers. */
  private async fetchWithIdleDeadline(url: string, init: RequestInit): Promise<Response> {
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

  /**
   * One request with the documented retry policy. The response is handed
   * back unread on success; a non-2xx status becomes a `ModelApiError`.
   */
  private async request(
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
      readonly retries?: 'all' | 'rateLimitOnly'
      readonly paid?: {
        readonly claim: SessionBudgetClaim
        isSent: boolean
      }
    },
    signal: AbortSignal | undefined,
    onRetry?: (notice: RetryNotice) => void,
    budget?: RetryBudget,
    admitAttempt?: ResponseAttemptGuard,
    confirmed?: ConfirmedModelRequest,
  ): Promise<Response> {
    const isRateLimitOnly = init.retries === 'rateLimitOnly' || init.paid !== undefined
    const fixedHeaders =
      admitAttempt === undefined && confirmed === undefined ? await this.headers() : undefined
    const url = `${this.deps.baseUrl}${path}`
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
    const provider = this.pacingProvider(init.modelId)
    for (let attempt = budget?.retriesUsed ?? 0; ; attempt += 1) {
      let credentials: Awaited<ReturnType<ModelApiClient['headers']>>
      try {
        credentials = fixedHeaders ?? (await this.headers())
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
      if (
        confirmed !== undefined &&
        (credentials.keyDigest !== confirmed.keyDigest || !confirmed.isStillAllowed())
      ) {
        throw new Error(UI_TEXT.scheduleConfirmationExpired)
      }
      const account = `${provider.identity.provider}:${this.deps.baseUrl}:${credentials.keyDigest}`
      const kind = init.pacingClass ?? 'foreground'
      if (path === '/responses' && init.method === 'POST') {
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
        // Waiting yields: key, consent, Stop and budget fences still run
        // immediately before dispatch, never only before joining the bucket.
        if (kind !== 'foreground' && credentials.keyDigest !== (await this.currentKeyDigest())) {
          throw new Error(UI_TEXT.notSignedInReason)
        }
      }
      if (isAborted(signal)) {
        throw new ModelApiError('cancelled', NETWORK_FAILURE_STATUS, undefined, undefined)
      }
      // Local consent refusal is outside the transport retry catch: it never
      // becomes another billable attempt.
      if (init.paid !== undefined) {
        if (init.paid.isSent) throw new Error(UI_TEXT.sessionBudgetRetryUnavailable)
        init.paid.claim.check(0)
      }
      admitAttempt?.(credentials.keyDigest)
      if (isAborted(signal)) {
        throw new ModelApiError('cancelled', NETWORK_FAILURE_STATUS, undefined, undefined)
      }
      if (confirmed !== undefined && !confirmed.isStillAllowed()) {
        throw new Error(UI_TEXT.scheduleConfirmationExpired)
      }
      const headers = { ...credentials.values, Accept: init.accept }
      const requestInit: RequestInit = {
        method: init.method,
        headers,
        ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
        ...(signal !== undefined && { signal }),
      }
      confirmed?.onRequestStarted()
      admitAttempt?.onRequestStarted?.()
      if (init.paid !== undefined) init.paid.isSent = true
      const sent = this.pacing.snapshot(account)
      let response: Response
      try {
        response = await this.fetchWithIdleDeadline(url, requestInit)
      } catch (error: unknown) {
        if (error instanceof ModelApiError || signal?.aborted === true) {
          throw error instanceof ModelApiError
            ? error
            : new ModelApiError(
                error instanceof Error ? error.message : String(error),
                NETWORK_FAILURE_STATUS,
                undefined,
                undefined,
              )
        }
        // Never reached the server: its causes say why, and the message
        // names the setting or store to check (M56, PLAN.md D43).
        const reason = networkFailureMessage(error, this.deps.networkAdvice)
        if (isRateLimitOnly || attempt >= MODEL_API_MAX_RETRIES) {
          throw new ModelApiError(reason, NETWORK_FAILURE_STATUS, undefined, undefined)
        }
        const delay = this.backoffMs(attempt, undefined)
        this.deps.log.warn(
          `Model API request failed to send (${describeNetworkFailure(error).detail}); retrying in ${String(delay)} ms`,
        )
        await retry(attempt, delay, reason)
        continue
      }
      const suggestedDelayMs = retryAfterMs(
        response.headers.get(RETRY_AFTER_HEADER),
        this.deps.now(),
      )
      this.pacing.observe(
        account,
        provider.readLimits?.(response.headers),
        response.status === HTTP_TOO_MANY_REQUESTS
          ? (suggestedDelayMs ??
              Math.min(MODEL_API_RETRY_BASE_MS * 2 ** attempt, MODEL_API_RETRY_MAX_MS))
          : undefined,
        sent,
      )
      if (response.ok) {
        this.deps.log.trace(
          `Model API ${init.method} ${path} answered ${String(response.status)} in ${String(this.deps.now() - startedAt)} ms`,
        )
        return response
      }
      const failure = await describeFailure(response)
      if (
        init.paid !== undefined &&
        (response.status === HTTP_TOO_MANY_REQUESTS || response.status === HTTP_STATUS.badRequest)
      )
        init.paid.isSent = false
      const isRetryable = isRateLimitOnly
        ? response.status === HTTP_TOO_MANY_REQUESTS
        : (this.deps.isRetryableFailure?.(failure, suggestedDelayMs) ??
          (MODEL_API_RETRYABLE_STATUSES.has(response.status) ||
            response.status === HTTP_GATEWAY_TIMEOUT))
      if (!isRetryable || attempt >= MODEL_API_MAX_RETRIES) {
        if (
          response.status >= HTTP_STATUS.internalServerError &&
          provider.identity.provider === 'meta'
        ) {
          this.deps.onServiceFailure?.(response.status, `${MODEL_API_BASE_URL}/status`)
        }
        throw failure
      }
      const delay = this.backoffMs(attempt, suggestedDelayMs)
      this.deps.log.warn(
        `Model API answered ${String(response.status)} (${failure.message}); retrying in ${String(delay)} ms`,
      )
      await retry(attempt, delay, `HTTP ${String(response.status)}: ${failure.message}`)
      if (response.status === HTTP_GATEWAY_TIMEOUT && admitAttempt?.prepareRetry !== undefined) {
        await admitAttempt.prepareRetry(
          credentials.keyDigest,
          signal ?? new AbortController().signal,
        )
      }
    }
  }

  /** A billed image request: only a 429 is retried, with a deadline of its own. */
  private async imageRequest(
    path: string,
    body: CreateImageBody,
    signal: AbortSignal,
    admitAttempt?: ResponseAttemptGuard,
  ): Promise<ImagesResponse> {
    const active = AbortSignal.any([signal, AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS)])
    const claim = await this.deps.reservePaidRequest?.(body, 'imageGeneration', undefined, active)
    const paid = claim === undefined ? undefined : { claim, isSent: false }
    try {
      const response = await this.request(
        path,
        {
          method: 'POST',
          body,
          modelId: body.model,
          accept: JSON_MEDIA_TYPE,
          retries: 'rateLimitOnly',
          ...(paid !== undefined && { paid }),
        },
        active,
        undefined,
        undefined,
        admitAttempt,
      )
      const result = imagesResponseSchema.parse(await response.json())
      // The request asks for exactly one image; retain its flat fee on any ambiguous result.
      if (claim !== undefined) await claim.settle(result.data.length === 0 ? 0 : claim.reservedUsd)
      return result
    } finally {
      if (paid?.isSent === false) await paid.claim.settle(0)
    }
  }

  /** Whether interactive extras have a finite daily admission port (D78). */
  public get hasPaidDailyBudget(): boolean {
    return this.deps.reservePaidRequest !== undefined
  }

  /** Bind a one-use child consent to the stored key without retaining it. */
  public async currentKeyDigest(): Promise<string> {
    const credentials = await this.headers()
    return credentials.keyDigest
  }

  /** The wait before retry number `attempt` (0-based): the same backoff and jitter as a request's. */
  public retryDelayMs(attempt: number): number {
    return this.backoffMs(attempt, undefined)
  }

  /** Waits `ms`, or rejects as soon as the turn's Stop aborts `signal`. */
  public async waitBeforeRetry(ms: number, signal: AbortSignal): Promise<void> {
    await this.pause(ms, signal)
  }

  /** The chat model ids the key can use, as the catalogue lists them. */
  public async listModels(): Promise<readonly string[]> {
    // No turn to stop it: a deadline instead, so a panel never waits for ever (D25).
    const response = await this.request(
      '/models',
      { method: 'GET', accept: JSON_MEDIA_TYPE },
      AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),
    )
    const parsed = modelListSchema.parse(await response.json())
    return parsed.data.map((model) => model.id)
  }

  /** Public, non-inference health read. The status capture required no authentication. */
  public async readServiceStatus(
    signal?: AbortSignal,
  ): Promise<ReturnType<typeof modelApiStatusSchema.parse>> {
    if (this.pacingProvider(undefined).identity.provider !== 'meta') {
      throw new Error(UI_TEXT.modelApiStatusUnavailable)
    }
    let status = NETWORK_FAILURE_STATUS
    let retryAfter: number | undefined
    try {
      const response = await this.fetchWithIdleDeadline(`${MODEL_API_BASE_URL}/status`, {
        method: 'GET',
        headers: { Accept: JSON_MEDIA_TYPE },
        signal: AbortSignal.any([
          AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),
          ...(signal === undefined ? [] : [signal]),
        ]),
      })
      status = response.status
      retryAfter = retryAfterMs(response.headers.get(RETRY_AFTER_HEADER), this.deps.now())
      if (!response.ok) {
        void response.body?.cancel().catch(ignoreClosingError)
        throw new Error(UI_TEXT.modelApiStatusUnavailable)
      }
      return modelApiStatusSchema.parse(await response.json())
    } catch {
      // Shared scrubber plus an allowlist: provider prose, identifiers, stack and causes never cross.
      const failure = new ModelApiError(
        redactSecrets(UI_TEXT.modelApiStatusUnavailable),
        status,
        'service_status',
        undefined,
      )
      throw Object.assign(failure, { retryAfterMs: retryAfter })
    }
  }

  /** Tokens the rendered input would occupy; not billed (dev.meta.ai/docs/token-counting). */
  public async countInputTokens(body: Omit<CreateResponseBody, 'stream'>): Promise<number> {
    const response = await this.request(
      '/responses/input_tokens',
      { method: 'POST', body, modelId: body.model, accept: JSON_MEDIA_TYPE },
      AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),
    )
    return inputTokensSchema.parse(await response.json()).input_tokens
  }

  /**
   * One generated image (M34): `POST /images/generations`, validated. Billed
   * per image returned; a failed or filtered one is not. The turn's Stop and
   * a deadline of its own end the wait.
   */
  public async createImage(
    body: CreateImageBody,
    signal: AbortSignal,
    admitAttempt?: ResponseAttemptGuard,
  ): Promise<ImagesResponse> {
    return await this.imageRequest('/images/generations', body, signal, admitAttempt)
  }

  /** One edited image (M44): `POST /images/edits`, billed and retried as a generation is. */
  public async editImage(
    body: EditImageBody,
    signal: AbortSignal,
    admitAttempt?: ResponseAttemptGuard,
  ): Promise<ImagesResponse> {
    return await this.imageRequest('/images/edits', body, signal, admitAttempt)
  }

  /**
   * The streamed response as validated events. Unknown event types are
   * skipped; a malformed known one or a non-JSON frame ends the stream with
   * an error, since the reply can no longer be trusted.
   */
  public async *streamResponse(
    body: CreateResponseBody,
    signal: AbortSignal,
    onRetry?: (notice: RetryNotice) => void,
    budget?: RetryBudget,
    admitAttempt?: ResponseAttemptGuard,
    confirmed?: ConfirmedModelRequest,
  ): AsyncGenerator<StreamEvent> {
    if (
      confirmed !== undefined &&
      (body.model !== confirmed.modelId || !confirmed.isStillAllowed())
    ) {
      throw new Error(UI_TEXT.scheduleConfirmationExpired)
    }
    let feature = admitAttempt?.paidFeature
    if (feature === undefined && confirmed !== undefined) feature = 'scheduledPrompts'
    if (feature === undefined && body.tools.some((tool) => tool.type === 'web_search'))
      feature = 'webSearch'
    const claim =
      feature === undefined
        ? undefined
        : await this.deps.reservePaidRequest?.(
            body,
            feature,
            admitAttempt?.paidEstimatedInputTokens,
            signal,
          )
    const paid = claim === undefined ? undefined : { claim, isSent: false }
    try {
      const response = await this.request(
        '/responses',
        {
          method: 'POST',
          body,
          accept: EVENT_STREAM_MEDIA_TYPE,
          modelId: body.model,
          pacingClass: admitAttempt?.pacingClass ?? fanOutPacingClass(feature),
          estimatedTokens:
            (admitAttempt?.paidEstimatedInputTokens ??
              new TextEncoder().encode(JSON.stringify([body.input, body.instructions, body.tools]))
                .length) + body.max_output_tokens,
          ...(paid !== undefined && { paid }),
        },
        signal,
        onRetry,
        budget,
        admitAttempt,
        confirmed,
      )
      if (response.body === null) {
        throw new ModelApiError('The response had no body', response.status, undefined, undefined)
      }
      const frames = parseSse(response.body)[Symbol.asyncIterator]()
      try {
        for (;;) {
          const next = await frames.next()
          if (next.done === true) {
            return
          }
          const frame = next.value
          // OpenAI-style streams end with `data: [DONE]`; a keep-alive may carry no
          // data. Neither is an event (D26).
          if (frame.data.trim() === '' || frame.data === SSE_DONE_SENTINEL) {
            continue
          }
          let json: unknown
          try {
            json = JSON.parse(frame.data)
          } catch {
            throw new ModelApiError(
              // Its length, not its text: the frame is model output, and this
              // message becomes the failed turn's reason in the log (M39).
              `Malformed stream frame (${String(frame.data.length)} characters)`,
              response.status,
              undefined,
              undefined,
            )
          }
          const known = streamEventSchema.safeParse(json)
          if (known.success) {
            if (
              claim !== undefined &&
              ['response.completed', 'response.incomplete', 'response.failed'].includes(
                known.data.type,
              ) &&
              'response' in known.data
            ) {
              const usage = known.data.response.usage
              const cached = usage?.input_tokens_details?.cached_tokens ?? 0
              if (
                usage !== null &&
                usage !== undefined &&
                Number.isSafeInteger(usage.input_tokens) &&
                usage.input_tokens >= 0 &&
                Number.isSafeInteger(usage.output_tokens) &&
                usage.output_tokens >= 0 &&
                Number.isSafeInteger(cached) &&
                cached >= 0 &&
                cached <= usage.input_tokens
              ) {
                await claim.settle(
                  estimateCostUsd(
                    {
                      inputTokens: usage.input_tokens,
                      outputTokens: usage.output_tokens,
                      cachedTokens: cached,
                    },
                    body.model,
                  ),
                )
              }
            }
            yield known.data
            continue
          }
          const typed = eventTypeSchema.safeParse(json)
          if (!typed.success) {
            throw new ModelApiError(
              'Stream frame without a type',
              response.status,
              undefined,
              undefined,
            )
          }
          // Once a type, not once a frame (M39).
          if (this.ignoredEventTypes.has(typed.data.type)) {
            continue
          }
          this.ignoredEventTypes.add(typed.data.type)
          this.deps.log.info(`Model API stream events of type ${typed.data.type} are ignored`)
        }
      } finally {
        // An early end (a malformed frame, a stall, the caller stopping)
        // closes the parser, which releases the response body (the review of
        // PR #20). Not awaited: after a stall its last read may never settle.
        void frames.return(undefined).catch(ignoreClosingError)
      }
    } finally {
      if (paid?.isSent === false) await paid.claim.settle(0)
    }
  }
}
