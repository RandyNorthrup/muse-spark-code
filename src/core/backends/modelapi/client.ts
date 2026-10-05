// A thin, schema-validated client for the four Model API endpoints the
// backend uses (PLAN.md D2): `GET /models`, `POST /responses/input_tokens`,
// the streamed `POST /responses` and `POST /images/generations` (M34).
// Errors follow the documented envelope and retry policy
// (dev.meta.ai/docs/error-handling): 429 / 500 / 503 are
// retried with exponential backoff and jitter, honouring `Retry-After`,
// before any of the response has been read; everything else surfaces as a
// `ModelApiError`. `fetch`, the clock and the key are injected.

import {
  RequestTransport,
  ignoreClosingError,
  ModelApiError,
  parseJsonResponse,
  redactModelApiError,
  type ConfirmedModelRequest,
  type ResponseAttemptGuard,
  type RetryBudget,
  type RetryNotice,
} from './transport'
export {
  MissingApiKeyError,
  ModelApiError,
  retryAfterMs,
  type ConfirmedModelRequest,
  type ResponseAttemptGuard,
  type RetryBudget,
  type RetryNotice,
} from './transport'
import type { ProviderClient } from './providerClient'
import type { PaidFeature } from '../../../shared/constants'
import type { SessionBudgetClaim } from './sessionBudget'
import { estimateCostUsd } from '../../usage/insights'

import {
  IMAGE_REQUEST_TIMEOUT_MS,
  MODEL_API_REQUEST_TIMEOUT_MS,
  UI_TEXT,
} from '../../../shared/constants'
import type { CoreLogger } from '../../logging'
import type { NetworkAdvice } from '../../networkFailure'
import {
  type CreateImageBody,
  type EditImageBody,
  type CreateResponseBody,
  eventTypeSchema,
  type ImagesResponse,
  imagesResponseSchema,
  inputTokensSchema,
  modelListSchema,
  type StreamEvent,
  streamEventSchema,
} from './schemas'
import { parseSse } from './sse'

export interface ModelApiClientDeps {
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
  /** How long a reply stream may send nothing; the constant unless a test shortens it. */
  readonly streamIdleMs?: number
  /**
   * Whose settings a request that never reached Meta names (M56): VS Code's
   * unless the ACP agent says its own (PLAN.md D62, Q66).
   */
  readonly networkAdvice?: NetworkAdvice
}

const JSON_MEDIA_TYPE = 'application/json'
const EVENT_STREAM_MEDIA_TYPE = 'text/event-stream'
const SSE_DONE_SENTINEL = '[DONE]'

export class ModelApiClient implements ProviderClient {
  private readonly ignoredEventTypes = new Set<string>()
  private readonly transport: RequestTransport
  public readonly provider
  public readonly capabilities = () => ({
    toolCalling: true,
    vision: true,
    reasoning: true,
    parallelToolCalls: true,
  })
  public constructor(private readonly deps: ModelApiClientDeps) {
    this.transport = new RequestTransport(deps)
    this.provider = {
      id: 'meta',
      label: 'Meta',
      origin: new URL(deps.baseUrl).origin,
      format: 'responses',
      auth: 'apiKey',
      isLocal: false,
    } as const
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
      const result = await this.transport.request(
        path,
        {
          method: 'POST',
          body,
          accept: JSON_MEDIA_TYPE,
          retries: 'rateLimitOnly',
          ...(paid !== undefined && { paid }),
        },
        active,
        undefined,
        undefined,
        admitAttempt,
      )
      const parsed = await parseJsonResponse(result, (json) => imagesResponseSchema.parse(json))
      // The request asks for one image; ambiguous results retain their flat fee.
      if (claim !== undefined) {
        await claim.settle(parsed.data.length === 0 ? 0 : claim.reservedUsd)
      }
      return parsed
    } finally {
      if (paid?.isSent === false) {
        await paid.claim.settle(0)
      }
    }
  }

  /** Whether interactive extras have a finite daily admission port (D78). */
  public get hasPaidDailyBudget(): boolean {
    return this.deps.reservePaidRequest !== undefined
  }

  /** Bind a one-use child consent to the stored key without retaining it. */
  public async currentKeyDigest(): Promise<string> {
    return await this.transport.currentKeyDigest()
  }

  /** The wait before retry number `attempt` (0-based): the same backoff and jitter as a request's. */
  public retryDelayMs(attempt: number): number {
    return this.transport.backoffMs(attempt, undefined)
  }

  /** Waits `ms`, or rejects as soon as the turn's Stop aborts `signal`. */
  public async waitBeforeRetry(ms: number, signal: AbortSignal): Promise<void> {
    await this.transport.pause(ms, signal)
  }

  /** The chat model ids the key can use, as the catalogue lists them. */
  public async listModels(): Promise<readonly string[]> {
    // No turn to stop it: a deadline instead, so a panel never waits for ever (D25).
    const result = await this.transport.request(
      '/models',
      { method: 'GET', accept: JSON_MEDIA_TYPE },
      AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),
    )
    const parsed = await parseJsonResponse(result, (json) => modelListSchema.parse(json))
    return parsed.data.map((model) => result.redact(model.id))
  }

  /** Tokens the rendered input would occupy; not billed (dev.meta.ai/docs/token-counting). */
  public async countInputTokens(body: Omit<CreateResponseBody, 'stream'>): Promise<number> {
    const result = await this.transport.request(
      '/responses/input_tokens',
      { method: 'POST', body, accept: JSON_MEDIA_TYPE },
      AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),
    )
    return await parseJsonResponse(result, (json) => inputTokensSchema.parse(json).input_tokens)
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
    if (feature === undefined && confirmed !== undefined) {
      feature = 'scheduledPrompts'
    }
    if (feature === undefined && body.tools.some((tool) => tool.type === 'web_search')) {
      feature = 'webSearch'
    }
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
      const { response, redact, eventParsed } = await this.transport.streamRequest(
        '/responses',
        { body, accept: EVENT_STREAM_MEDIA_TYPE, ...(paid !== undefined && { paid }) },
        signal,
        onRetry,
        budget,
        admitAttempt,
        confirmed,
        this.deps.streamIdleMs,
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
          json = JSON.parse(JSON.stringify(json), (_key, value: unknown) =>
            typeof value === 'string' ? redact(value) : value,
          )
          const known = streamEventSchema.safeParse(json)
          if (known.success) {
            eventParsed()
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
          this.deps.log.info(
            `Model API stream events of type ${redact(typed.data.type)} are ignored`,
          )
        }
      } catch (error: unknown) {
        throw redactModelApiError(error, redact, response.status)
      } finally {
        // An early end (a malformed frame, a stall, the caller stopping)
        // closes the parser, which releases the response body (the review of
        // PR #20). Not awaited: after a stall its last read may never settle.
        void frames.return(undefined).catch(ignoreClosingError)
      }
    } finally {
      if (paid?.isSent === false) {
        await paid.claim.settle(0)
      }
    }
  }
}
