import { resolveAttemptBillingRoute } from './billingRoute'
// M95-T: canonical client seam. Codecs/registry load only in the BYO bundle.
import type { ModelCapabilities } from '../../providers/capabilities'
import * as z from 'zod/mini'
import type { CredentialAuth } from '../../providers/credentialRecord'
import type { ProviderFormat } from '../../providers/providersFile'
import type { CreateResponseBody, StreamEvent } from './schemas'
import {
  RequestTransport,
  UNBOUNDED_RETRIES,
  assertConfirmedAllowed,
  canRetryWithinBudget,
  ignoreClosingError,
  redactModelApiError,
  rethrowStreamError,
  ModelApiError,
  parseJsonResponse,
  type TransportDeps,
  type ConfirmedModelRequest,
  type ResponseAttemptGuard,
  type RetryBudget,
  type RetryNotice,
} from './transport'
import type { AuthSource } from './authSource'
import { isRefusalRetryable, isRetryableStreamFailure } from './providerRefusal'
import { PROVIDER_CONNECTION_LOST_CODE, UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { streamEventSchema, usageSchema } from '../../../host/backend/modelApiEntry'
import {
  estimatedStreamTokens,
  modelPricedUsage,
  requestImageCount,
  type ModelPricePolicy,
} from './modelPolicy'
import type { UnattendedRun } from '../../schedules/unattended'
import { Usd } from '../../../shared/usd'

// Only usage metadata is extensible here; item guards consume the stripped,
// parsed canonical representation, never a codec's unvalidated original.
const extendedUsageSchema = z.object({
  response: z.object({ usage: z.optional(z.nullable(z.looseObject(usageSchema.shape))) }),
})
function parseCanonicalEvent(value: unknown): StreamEvent {
  const parsed = streamEventSchema.parse(value)
  if ('response' in parsed) {
    const metadata = extendedUsageSchema.parse(value)
    return { ...parsed, response: { ...parsed.response, ...metadata.response } }
  }
  return parsed
}

export interface ProviderIdentity {
  readonly id: string
  readonly label: string
  readonly origin: string
  readonly format: ProviderFormat
  readonly auth: CredentialAuth
  readonly isLocal: boolean
}

export interface ProviderClient {
  readonly provider: ProviderIdentity
  readonly capabilities: (modelId: string) => ModelCapabilities
  streamResponse(
    body: CreateResponseBody,
    signal: AbortSignal,
    onRetry?: (notice: RetryNotice) => void,
    budget?: RetryBudget,
    admitAttempt?: ResponseAttemptGuard,
    confirmed?: ConfirmedModelRequest,
    /**
    M101-REPLAY-ORIGIN: the producing model's ref per replayed `call_id`.
    Only the Responses codec reads it; every other route ignores it.
    */
    replayOrigins?: Readonly<Record<string, string>>,
  ): AsyncGenerator<StreamEvent>
  countInputTokens(body: Omit<CreateResponseBody, 'stream'>, signal?: AbortSignal): Promise<number>
  /** Preserve today's host contract; registry owns the richer catalogue/model rows. */
  listModels(signal?: AbortSignal): Promise<readonly string[]>
  currentKeyDigest(): Promise<string>
  retryDelayMs(attempt: number): number
  waitBeforeRetry(ms: number, signal: AbortSignal): Promise<void>
  /**
  The retries one call may use (lane RETRYLIMITS, PR #225): the person's
  `museSpark.modelApiMaxRetries` setting caps the provider's documented
  maximum (never raises it), decides alone where the provider documents
  none, else undefined (unbounded: the provider's own Retry-After waits
  and stop answers govern the loop). The selected model rides along so
  an aggregate client answers for the provider that handled the request.
  */
  maxRetries(modelId?: string): number | undefined
  /**
  The person's live `museSpark.modelApiMaxRetries` setting, before any
  provider maximum caps it, so the turn loop can tell a person-set cap
  stop from a provider refusal (PR #225).
  */
  personCap(): number | undefined
}

export interface ProviderModel {
  readonly id: string
  readonly capabilities: ModelCapabilities
  readonly contextWindow: number
  readonly maxOutputTokens: number
}

export interface NativeRequest {
  /** Relative to the configured base, always confined to its exact origin. */
  readonly path: string
  readonly body: unknown
  readonly headers?: Readonly<Record<string, string>>
}

/** Implementations belong to R/H/A/G/O; every external shape is parsed there. */
export interface WireEncodeOptions {
  /**
  M101-REPLAY-ORIGIN: the producing model's ref per replayed `call_id`.
  Only the Responses encoder reads it; every other format ignores it.
  */
  readonly replayOrigins?: Readonly<Record<string, string>> | undefined
}

export interface WireCodec {
  readonly format: ProviderFormat
  encode(body: CreateResponseBody, model: ProviderModel, options?: WireEncodeOptions): NativeRequest
  decode(response: Response, model: ProviderModel): AsyncGenerator<StreamEvent>
  parseError(status: number, body: unknown, headers: Headers): ModelApiError
  readonly models: {
    readonly path: string
    readonly parse: (body: unknown) => readonly ProviderModel[]
  }
  readonly countTokens?: {
    readonly encode: (
      body: Omit<CreateResponseBody, 'stream'>,
      model: ProviderModel,
    ) => NativeRequest
    readonly parse: (body: unknown) => number
  }
}

export interface CodecClientDeps {
  readonly provider: ProviderIdentity
  readonly baseUrl: string
  readonly codec: WireCodec
  readonly auth: AuthSource
  readonly modelFor: (modelId: string) => ProviderModel
  /** Resolve names and apply P's saved-network policy before every attempt. */
  readonly verifyEndpoint: (url: string) => Promise<void>
  readonly transport: Omit<
    TransportDeps,
    'baseUrl' | 'auth' | 'apiKey' | 'parseError' | 'verifyEndpoint'
  >
  readonly streamIdleMs?: number
}

/** The only BYO HTTP adapter: no codec or provider implementation loads on activation. */
export class CodecClient implements ProviderClient {
  private readonly transport: RequestTransport
  public readonly provider: ProviderIdentity
  public readonly capabilities: (modelId: string) => ModelCapabilities
  public readonly currentKeyDigest: () => Promise<string>
  public readonly retryDelayMs: (attempt: number) => number
  public readonly waitBeforeRetry: (ms: number, signal: AbortSignal) => Promise<void>
  public constructor(
    private readonly deps: CodecClientDeps,
    private readonly scheduledRun?: () => UnattendedRun | undefined,
    private readonly scheduledPrice?: ModelPricePolicy,
  ) {
    this.provider = deps.provider
    if (
      new URL(deps.baseUrl).origin !== deps.provider.origin ||
      deps.codec.format !== deps.provider.format
    ) {
      throw new ModelApiError(
        fill(UI_TEXT.webFetchNetwork, { detail: 'provider_pin_mismatch' }),
        0,
        'origin_mismatch',
        undefined,
      )
    }
    this.capabilities = (modelId) => deps.modelFor(modelId).capabilities
    this.transport = new RequestTransport({
      ...deps.transport,
      baseUrl: deps.baseUrl,
      auth: deps.auth,
      verifyEndpoint: deps.verifyEndpoint,
      parseError: (status, body, headers) => deps.codec.parseError(status, body, headers),
      // Lane PROVERR: a credit, usage-limit (Z.ai's 1308-1321, lane
      // PROVERRORS), authentication, permission, not-found, content-filter,
      // invalid-request or too-large refusal is never retried; anything
      // else follows the preset's own retry table (OPENAI-G20), defaulting
      // to the Responses table.
      isRetryableFailure: (failure) => isRefusalRetryable(failure, deps.transport.retryTable),
      ...(scheduledRun !== undefined && { scheduledRun }),
    })
    this.currentKeyDigest = this.transport.currentKeyDigest.bind(this.transport)
    this.retryDelayMs = this.transport.backoffMs.bind(this.transport)
    this.waitBeforeRetry = this.transport.pause.bind(this.transport)
  }
  /** This client's effective retry limit (see `ProviderClient.maxRetries`). */
  public maxRetries(): number | undefined {
    return this.transport.maxRetries()
  }

  /** The person's live retry limit, uncapped (see `ProviderClient.personCap`). */
  public personCap(): number | undefined {
    return this.transport.personCap()
  }
  public withScheduleAuthority(
    run: () => UnattendedRun | undefined,
    price?: ModelPricePolicy,
  ): CodecClient {
    return new CodecClient(this.deps, run, price)
  }
  public async listModels(signal?: AbortSignal): Promise<readonly string[]> {
    // No deadline of our own (owner 2026-10-16): the catalogue read ends at
    // the provider's answer, a network failure, or the caller's signal
    // (Stop owns the wait; PR #214 review).
    const result = await this.transport.request(
      this.deps.codec.models.path,
      {
        billingRoute: await resolveAttemptBillingRoute({
          feature: 'catalogue',
          isMetaDirect: false,
        }),
        method: 'GET',
        accept: 'application/json',
      },
      signal,
    )
    const models = await parseJsonResponse(result, (json) => this.deps.codec.models.parse(json))
    return models.map((model) => result.redact(model.id))
  }
  public async countInputTokens(
    body: Omit<CreateResponseBody, 'stream'>,
    signal?: AbortSignal,
  ): Promise<number> {
    const counter = this.deps.codec.countTokens
    if (counter === undefined) {
      throw new ModelApiError(
        fill(UI_TEXT.webFetchNetwork, { detail: 'token_count_unavailable' }),
        0,
        'token_count_unavailable',
        undefined,
      )
    }
    const request = counter.encode(body, this.deps.modelFor(body.model))
    const result = await this.transport.request(
      request.path,
      {
        billingRoute: await resolveAttemptBillingRoute({
          feature: 'tokenCount',
          isMetaDirect: false,
        }),
        method: 'POST',
        body: request.body,
        ...(request.headers !== undefined && { headers: request.headers }),
        accept: 'application/json',
      },
      // No deadline of our own (owner 2026-10-16): the caller's
      // signal, if any, ends it, else the provider's answer (see listModels).
      signal,
    )
    const count = await parseJsonResponse(result, (json) => counter.parse(json))
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new ModelApiError(
        fill(UI_TEXT.webFetchNetwork, { detail: 'invalid_token_count' }),
        0,
        'invalid_token_count',
        undefined,
      )
    }
    return count
  }
  public async *streamResponse(
    ...args: Parameters<ProviderClient['streamResponse']>
  ): AsyncGenerator<StreamEvent> {
    const [body, signal, onRetry, budget, admitAttempt, confirmed, replayOrigins] = args
    // The shared helper is the only confirmed-dispatch decision: an unset
    // provider or origin passes, like the transport fence, so a still-allowed
    // schedule or hook confirmation without one dispatches.
    assertConfirmedAllowed(body.model, confirmed, (confirmedModelId, requestModel) =>
      confirmed === undefined
        ? confirmedModelId === requestModel
        : confirmedModelId === requestModel &&
          (confirmed.providerId === undefined || confirmed.providerId === this.provider.id) &&
          (confirmed.origin === undefined || confirmed.origin === this.provider.origin),
    )
    const model = this.deps.modelFor(body.model)
    const request = this.deps.codec.encode(
      body,
      model,
      replayOrigins === undefined ? undefined : { replayOrigins },
    )
    // HTTP retries inside each request and the stream retries below draw on
    // one budget, as the turn's whole-stream retries do (the review of PR #28).
    const retries = budget ?? { retriesUsed: 0 }
    const run = this.scheduledRun?.()
    if (this.scheduledRun !== undefined && (run === undefined || this.scheduledPrice === undefined))
      throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
    const claim = await run?.reservePaidRequest(
      body,
      'scheduledPrompts',
      admitAttempt?.paidEstimatedInputTokens,
    )
    const paid = claim === undefined ? undefined : { claim, run, isSent: false }
    try {
      for (;;) {
        const { response, redact, redactContent, eventParsed } = await this.transport.streamRequest(
          request.path,
          {
            // C-M95-SUB: the attempt rides its frozen route, so billing and
            // credential checks see the same decision the turn was admitted
            // under.
            billingRoute: await resolveAttemptBillingRoute({
              feature: admitAttempt?.paidFeature ?? 'ordinary',
              isMetaDirect: false,
            }),
            body: request.body,
            ...(request.headers !== undefined && { headers: request.headers }),
            accept:
              this.provider.format === 'ollama' ? 'application/x-ndjson' : 'text/event-stream',
            // The pacing bucket's key: a configured provider's inference
            // joins it like Meta's, so learned quotas and 429 pauses
            // throttle its background fan-out too. Count and list calls
            // carry no model id and stay observation-only.
            modelId: body.model,
            ...(admitAttempt?.pacingClass !== undefined && {
              pacingClass: admitAttempt.pacingClass,
            }),
            estimatedTokens: estimatedStreamTokens(body, admitAttempt),
            // A scheduled run settles each terminal event at its pinned price.
            ...(paid !== undefined && { paid }),
          },
          signal,
          onRetry,
          retries,
          admitAttempt,
          confirmed,
          this.deps.streamIdleMs,
        )
        let hasContent = false
        try {
          for await (const event of this.deps.codec.decode(response, model)) {
            const parsed = parseCanonicalEvent(event)
            // Arguments are executable payloads, not diagnostic text. Retain
            // their bytes while keeping the codec's ordinary output redaction.
            const safe: unknown = JSON.parse(JSON.stringify(parsed), (key, value: unknown) => {
              if (typeof value !== 'string') return value
              const isExecutable =
                key === 'arguments' ||
                (key === 'delta' && parsed.type === 'response.function_call_arguments.delta')
              return isExecutable ? redactContent(value) : redact(value)
            })
            const validated = parseCanonicalEvent(safe)
            eventParsed(validated)
            if (validated.type !== 'response.created' && validated.type !== 'response.in_progress')
              hasContent = true
            // A scheduled run settles each terminal event at its pinned
            // price, so the run's own cap clamps a stream the transport
            // may send again mid-stream.
            if (
              claim !== undefined &&
              'response' in validated &&
              ['response.completed', 'response.failed', 'response.incomplete'].includes(
                validated.type,
              ) &&
              validated.response.usage != null
            ) {
              const usage = validated.response.usage
              const cost = this.scheduledPrice?.settle(
                { ...modelPricedUsage(usage), images: requestImageCount(body) },
                { cost: usage.provider_cost_usd },
              )
              if (cost !== undefined) await claim.settle(cost)
            }
            yield validated
          }
          return
        } catch (error: unknown) {
          const failure = redactModelApiError(error, redact, response.status)
          // A retryable error the provider ended its stream with before any
          // content (Anthropic's `overloaded_error`, "which would normally
          // correspond to an HTTP 529"; OpenRouter's mid-stream 429 or 503)
          // is sent again under the same policy as that status (lane
          // PROVERRORS, research anthropic.md AB3, openrouter.md "Mid-stream
          // 429"); so is a connection lost before any content, as a transient
          // send failure is. Once content has arrived the turn ends with it.
          // A per-call-billed (media) request is never sent again here, as the
          // transport retries it only on a 429.
          const isResendable =
            isRetryableStreamFailure(failure, this.deps.transport.retryTable) ||
            (failure.status === 0 && failure.code === PROVIDER_CONNECTION_LOST_CODE)
          // Lane PR225FIX2: a connection lost before any content is an
          // ambiguous send — the request may have arrived and executed — so
          // it is sent again only within an explicit bound (the person's
          // setting or the provider's documented maximum), never on the
          // unbounded default. A retryable error the provider ended its
          // stream with stays on the status policy above.
          const isAmbiguous = failure.status === 0 && failure.code === PROVIDER_CONNECTION_LOST_CODE
          const allowed = this.transport.maxRetries()
          if (
            !isResendable ||
            hasContent ||
            signal.aborted ||
            admitAttempt?.mediaAccounting !== undefined ||
            !canRetryWithinBudget(retries, retries.retriesUsed) ||
            (isAmbiguous && allowed === undefined) ||
            retries.retriesUsed >= (allowed ?? UNBOUNDED_RETRIES)
          )
            await rethrowStreamError(error, redact, response.status)
          const attempt = retries.retriesUsed
          retries.retriesUsed = attempt + 1
          const delayMs = this.retryDelayMs(attempt)
          onRetry?.({
            attempt: attempt + 1,
            maxAttempts: allowed === undefined ? undefined : allowed + 1,
            delayMs,
            reason: `${failure.code ?? ''}: ${failure.message}`,
          })
          await this.waitBeforeRetry(delayMs, signal)
          // Lane PR225W1: the person's limit is live — a change mid-wait
          // refuses the resend the pre-wait check accepted.
          if (attempt >= (this.transport.maxRetries() ?? UNBOUNDED_RETRIES)) throw failure
        } finally {
          if (response.body !== null && !response.body.locked) {
            void response.body.cancel().catch(ignoreClosingError)
          }
        }
      }
    } finally {
      // A stream that sent nothing leaves the held scheduled claim open,
      // so it settles at zero and the run's own cap is restored.
      if (paid?.isSent === false) await paid.claim.settle(Usd.from(0).toAmount())
    }
  }
}
