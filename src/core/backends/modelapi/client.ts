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
  MODEL_API_STREAM_IDLE_MS,
  MILLISECONDS_PER_SECOND,
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { DeadlineError, withDeadline } from '../../timeouts'
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
  /** How long a reply stream may send nothing; the constant unless a test shortens it. */
  readonly streamIdleMs?: number
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
const SSE_DONE_SENTINEL = '[DONE]'

/** Closing a parser that already failed rejects with that failure, which the stream reported. */
function ignoreClosingError(): void {
  // Nothing to add: the stream's own error already went to its caller.
}

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
  /** Stream event types already logged as ignored (M39). */
  private readonly ignoredEventTypes = new Set<string>()

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
    // How long the answer took, retries included, at trace level (M39).
    const startedAt = this.deps.now()
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
        this.deps.log.trace(
          `Model API ${init.method} ${path} answered ${String(response.status)} in ${String(this.deps.now() - startedAt)} ms`,
        )
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
    // Nothing from the server for this long, headers or a frame, ends the
    // turn (M39); the request is aborted too, which frees the connection.
    const idleMs = this.deps.streamIdleMs ?? MODEL_API_STREAM_IDLE_MS
    const stalled = fill(UI_TEXT.modelApiStalled, {
      seconds: Math.round(idleMs / MILLISECONDS_PER_SECOND),
    })
    const stall = new AbortController()
    const within = async <T>(waiting: Promise<T>): Promise<T> => {
      try {
        return await withDeadline(waiting, idleMs, stalled)
      } catch (error: unknown) {
        if (error instanceof DeadlineError) {
          stall.abort()
          throw new ModelApiError(stalled, NETWORK_FAILURE_STATUS, undefined, undefined)
        }
        throw error
      }
    }
    const response = await within(
      this.request(
        '/responses',
        { method: 'POST', body, accept: EVENT_STREAM_MEDIA_TYPE },
        AbortSignal.any([signal, stall.signal]),
        onRetry,
      ),
    )
    if (response.body === null) {
      throw new ModelApiError('The response had no body', response.status, undefined, undefined)
    }
    const frames = parseSse(response.body)[Symbol.asyncIterator]()
    try {
      for (;;) {
        const next = await within(frames.next())
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
  }
}
