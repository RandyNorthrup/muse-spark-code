// A thin, schema-validated client for the three Model API endpoints the
// backend uses (PLAN.md D2): `GET /models`, `POST /responses/input_tokens`
// and the streamed `POST /responses`. Errors follow the documented envelope
// and retry policy (dev.meta.ai/docs/error-handling): 429 / 500 / 503 are
// retried with exponential backoff and jitter, honouring `Retry-After`,
// before any of the response has been read; everything else surfaces as a
// `ModelApiError`. `fetch`, the clock and the key are injected.

import {
  MODEL_API_MAX_RETRIES,
  MODEL_API_RETRY_BASE_MS,
  MODEL_API_RETRY_JITTER_MS,
  MODEL_API_RETRY_MAX_MS,
  MODEL_API_RETRYABLE_STATUSES,
  MODEL_API_REQUEST_TIMEOUT_MS,
  MILLISECONDS_PER_SECOND,
} from '../../../shared/constants'
import type { CoreLogger } from '../../logging'
import {
  type CreateResponseBody,
  errorBodySchema,
  eventTypeSchema,
  inputTokensSchema,
  modelListSchema,
  type StreamEvent,
  streamEventSchema,
} from './schemas'
import { parseSse } from './sse'

export interface ModelApiClientDeps {
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

const JSON_MEDIA_TYPE = 'application/json'
const EVENT_STREAM_MEDIA_TYPE = 'text/event-stream'
const RETRY_AFTER_HEADER = 'retry-after'
const NETWORK_FAILURE_STATUS = 0
const FRAME_PREVIEW_CHARS = 80

/** The documented error envelope, or the status text when the body is not one. */
async function describeFailure(response: Response): Promise<ModelApiError> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
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
  readonly attempt: number
  readonly maxAttempts: number
  readonly delayMs: number
  readonly reason: string
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
  public constructor(private readonly deps: ModelApiClientDeps) {}

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

  private async headers(): Promise<Record<string, string>> {
    const key = await this.deps.apiKey()
    if (key === undefined) {
      throw new MissingApiKeyError()
    }
    return { Authorization: `Bearer ${key}`, 'Content-Type': JSON_MEDIA_TYPE }
  }

  private backoffMs(attempt: number, suggestedMs: number | undefined): number {
    const exponential = Math.min(MODEL_API_RETRY_BASE_MS * 2 ** attempt, MODEL_API_RETRY_MAX_MS)
    const jitter = Math.floor(this.deps.random() * MODEL_API_RETRY_JITTER_MS)
    return Math.min((suggestedMs ?? exponential) + jitter, MODEL_API_RETRY_MAX_MS)
  }

  /**
   * One request with the documented retry policy. The response is handed
   * back unread on success; a non-2xx status becomes a `ModelApiError`.
   */
  private async request(
    path: string,
    init: { readonly method: 'GET' | 'POST'; readonly body?: unknown; readonly accept: string },
    signal: AbortSignal | undefined,
    onRetry?: (notice: RetryNotice) => void,
  ): Promise<Response> {
    const headers = { ...(await this.headers()), Accept: init.accept }
    const url = `${this.deps.baseUrl}${path}`
    const retry = async (attempt: number, delay: number, reason: string) => {
      onRetry?.({
        attempt: attempt + 1,
        maxAttempts: MODEL_API_MAX_RETRIES + 1,
        delayMs: delay,
        reason,
      })
      await this.pause(delay, signal)
    }
    for (let attempt = 0; ; attempt += 1) {
      let response: Response
      try {
        response = await this.deps.fetch(url, {
          method: init.method,
          headers,
          ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
          ...(signal !== undefined && { signal }),
        })
      } catch (error: unknown) {
        if (signal?.aborted === true || attempt >= MODEL_API_MAX_RETRIES) {
          throw error instanceof ModelApiError
            ? error
            : new ModelApiError(
                error instanceof Error ? error.message : String(error),
                NETWORK_FAILURE_STATUS,
                undefined,
                undefined,
              )
        }
        const delay = this.backoffMs(attempt, undefined)
        const reason = error instanceof Error ? error.message : String(error)
        this.deps.log.warn(`Model API request failed to send; retrying in ${String(delay)} ms`)
        await retry(attempt, delay, reason)
        continue
      }
      if (response.ok) {
        return response
      }
      const failure = await describeFailure(response)
      if (!MODEL_API_RETRYABLE_STATUSES.has(response.status) || attempt >= MODEL_API_MAX_RETRIES) {
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

  /** Tokens the rendered input would occupy; not billed (dev.meta.ai/docs/token-counting). */
  public async countInputTokens(body: Omit<CreateResponseBody, 'stream'>): Promise<number> {
    const response = await this.request(
      '/responses/input_tokens',
      { method: 'POST', body, accept: JSON_MEDIA_TYPE },
      AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),
    )
    return inputTokensSchema.parse(await response.json()).input_tokens
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
  ): AsyncGenerator<StreamEvent> {
    const response = await this.request(
      '/responses',
      { method: 'POST', body, accept: EVENT_STREAM_MEDIA_TYPE },
      signal,
      onRetry,
    )
    if (response.body === null) {
      throw new ModelApiError('The response had no body', response.status, undefined, undefined)
    }
    for await (const frame of parseSse(response.body)) {
      let json: unknown
      try {
        json = JSON.parse(frame.data)
      } catch {
        throw new ModelApiError(
          `Malformed stream frame: ${frame.data.slice(0, FRAME_PREVIEW_CHARS)}`,
          response.status,
          undefined,
          undefined,
        )
      }
      const known = streamEventSchema.safeParse(json)
      if (known.success) {
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
      this.deps.log.info(`Model API stream event ${typed.data.type} ignored`)
    }
  }
}
