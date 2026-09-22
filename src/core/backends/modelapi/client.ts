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

/** `Retry-After` in milliseconds when the header carries a delay in seconds. */
function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get(RETRY_AFTER_HEADER)
  if (header === null) {
    return undefined
  }
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * MILLISECONDS_PER_SECOND : undefined
}

export class ModelApiClient {
  public constructor(private readonly deps: ModelApiClientDeps) {}

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
  ): Promise<Response> {
    const headers = { ...(await this.headers()), Accept: init.accept }
    const url = `${this.deps.baseUrl}${path}`
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
        this.deps.log.warn(`Model API request failed to send; retrying in ${String(delay)} ms`)
        await this.deps.sleep(delay)
        continue
      }
      if (response.ok) {
        return response
      }
      const failure = await describeFailure(response)
      if (!MODEL_API_RETRYABLE_STATUSES.has(response.status) || attempt >= MODEL_API_MAX_RETRIES) {
        throw failure
      }
      const delay = this.backoffMs(attempt, retryAfterMs(response))
      this.deps.log.warn(
        `Model API answered ${String(response.status)} (${failure.message}); retrying in ${String(delay)} ms`,
      )
      await this.deps.sleep(delay)
    }
  }

  /** The chat model ids the key can use, as the catalogue lists them. */
  public async listModels(): Promise<readonly string[]> {
    const response = await this.request(
      '/models',
      { method: 'GET', accept: JSON_MEDIA_TYPE },
      undefined,
    )
    const parsed = modelListSchema.parse(await response.json())
    return parsed.data.map((model) => model.id)
  }

  /** Tokens the rendered input would occupy; not billed (dev.meta.ai/docs/token-counting). */
  public async countInputTokens(body: Omit<CreateResponseBody, 'stream'>): Promise<number> {
    const response = await this.request(
      '/responses/input_tokens',
      { method: 'POST', body, accept: JSON_MEDIA_TYPE },
      undefined,
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
  ): AsyncGenerator<StreamEvent> {
    const response = await this.request(
      '/responses',
      { method: 'POST', body, accept: EVENT_STREAM_MEDIA_TYPE },
      signal,
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
