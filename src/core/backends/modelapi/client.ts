import { PaidAuthority } from '../../paid/paidAuthority'
// A thin, schema-validated Model API client (PLAN.md D2, M34, D86.6):
// models, token counts, streamed responses, generated/edited images and
// public service health.
// Errors follow the documented envelope and retry policy
// (PLAN.md D86.6): 429 / 500 / 502 / 503 / 504 are
// retried with exponential backoff and jitter, honouring `Retry-After`,
// before any of the response has been read; everything else surfaces as a
// `ModelApiError`. `fetch`, the clock and the key are injected.

import {
  RequestTransport,
  ignoreClosingError,
  ModelApiError,
  parseJsonResponse,
  readBoundedText,
  redactModelApiError,
  redactStreamDiagnostics,
  type ConfirmedModelRequest,
  type ResponseAttemptGuard,
  type RetryBudget,
  type RetryNotice,
  retryAfterMs,
} from './transport'
export {
  MissingApiKeyError,
  ModelApiError,
  isModelApiError,
  isMissingApiKeyError,
  retryAfterMs,
  type ConfirmedModelRequest,
  type ResponseAttemptGuard,
  type RetryBudget,
  type RetryNotice,
  type ResponseObservation,
  rateLimitHeaders,
} from './transport'
import type { ProviderClient as TransportProviderClient } from './providerClient'
import type { PlanUsageRow } from '../../../shared/usage'
import type { ModelResolver } from './modelPolicy'
import {
  type PaidFeature,
  MODEL_API_BASE_URL,
  IMAGE_REQUEST_TIMEOUT_MS,
  MODEL_API_REQUEST_TIMEOUT_MS,
  UI_TEXT,
} from '../../../shared/constants'
import { estimateInput, requestParts, searchAllowanceUsd } from './sessionBudget'

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
  modelApiStatusSchema,
  type StreamEvent,
  streamEventSchema,
} from './schemas'
import { parseSse } from './sse'
import { estimateCostUsd, formatUsd, type BillableUsage } from '../../usage/insights'
import { webSearchPriceUsd } from '../../paid/paidFeatures'
import { modelApiPaidTier, type PaidQuote, type SearchSettlement } from '../../../shared/paid'
import { Usd, sumUsd, multiplyUsd, usdAmountSchema, type UsdAmount } from '../../../shared/usd'

/** The client needs admission and settlement, not the ledger's internal totals. */
interface PaidRequestClaim {
  readonly reservedUsd: UsdAmount
  check(capUsd: UsdAmount): void
  settle(actualCostUsd: UsdAmount, hasUnknownCost?: boolean): Promise<unknown>
}

import { redactSecrets } from '../../redact'
import { fill } from '../../../shared/l10n/text'

import type { PacingProvider, RequestPacer } from './pacing'
import { fanOutPacingClass } from './subagentTools'

/** Public transport contract shared by Meta, plan clients and host adapters. */
export type ProviderClient = Pick<
  ModelApiClient,
  Exclude<
    keyof ModelApiClient,
    | 'provider'
    | 'capabilities'
    | 'providerId'
    | 'searchPriceUsd'
    | 'inheritSearchQuote'
    | 'releaseSearchQuotes'
    | 'readServiceStatus'
    | 'withScheduleAuthority'
    | 'requestFile'
  >
> & {
  readonly providerId?: ModelApiClient['providerId']
  readonly searchPriceUsd?: ModelApiClient['searchPriceUsd']
  readonly inheritSearchQuote?: ModelApiClient['inheritSearchQuote']
  readonly releaseSearchQuotes?: ModelApiClient['releaseSearchQuotes']
  readonly readServiceStatus?: ModelApiClient['readServiceStatus']
  readonly withScheduleAuthority?: (run: () => UnattendedRun | undefined) => ProviderClient
  readonly provider?: TransportProviderClient['provider']
  readonly models?: ModelResolver
  readonly modelContextLimit?: (model: string) => number | undefined
  readonly isPlanModel?: (model: string) => boolean
  readonly readPlanUsage?: () => readonly PlanUsageRow[]
}
import type { SecretScrubPort } from '../../../shared/redact'

import type { UnattendedRun } from '../../schedules/unattended'

export interface ModelApiClientDeps {
  /** M109 T: broker-backed exact-value scrub, immediately before every send. */
  readonly vaultScrub?: SecretScrubPort
  readonly paidAuthority?: PaidAuthority
  /** Share across clients for one process; omitted clients own a bucket themselves. */
  readonly pacing?: RequestPacer
  /** One owner shares limits across its normal and best-of-N clients. */
  readonly pacingOwner?: object
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
    /** M106: tokens plus the verified hosted-call allowance, computed in this bundle. */
    reservationUsd?: UsdAmount,
  ) => Promise<PaidRequestClaim | undefined>
  /** M95 integration: a provider's verified hosted-search tariff, never a fallback estimate. */
  readonly providerId?: ((modelId: string) => string) | undefined
  readonly webSearchPriceUsd?: (modelId: string) => UsdAmount | undefined
  /** M95's verified token pricing; an unpriced provider cannot spend under a search cap. */
  readonly searchTokenCostUsd?: (usage: BillableUsage, modelId: string) => UsdAmount | undefined
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

const JSON_MEDIA_TYPE = 'application/json'
const EVENT_STREAM_MEDIA_TYPE = 'text/event-stream'
const SSE_DONE_SENTINEL = '[DONE]'

export class ModelApiClient implements TransportProviderClient {
  private searchClaimSequence = 0
  private readonly ignoredEventTypes = new Set<string>()
  private readonly transport: RequestTransport
  public readonly provider
  public readonly capabilities = () => ({
    toolCalling: true,
    vision: true,
    reasoning: true,
    parallelToolCalls: true,
  })
  public constructor(
    private readonly deps: ModelApiClientDeps,
    private readonly scheduledRun?: () => UnattendedRun | undefined,
  ) {
    this.transport = new RequestTransport({
      ...deps,
      ...(scheduledRun !== undefined && { scheduledRun }),
    })
    this.provider = {
      id: 'meta',
      label: 'Meta',
      origin: new URL(deps.baseUrl).origin,
      format: 'responses',
      auth: 'apiKey',
      isLocal: false,
    } as const
  }

  private async paidReservation(
    body: CreateResponseBody | CreateImageBody,
    feature: PaidFeature | undefined,
    signal: AbortSignal,
    guard?: ResponseAttemptGuard,
    reservationUsd?: UsdAmount,
  ) {
    const run = this.scheduledRun?.()
    if (run === undefined && this.scheduledRun !== undefined)
      throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
    const reserve =
      run === undefined
        ? (guard?.reservePaidRequest ?? this.deps.reservePaidRequest)
        : run.reservePaidRequest
    feature ??= run === undefined ? undefined : 'scheduledPrompts'
    const claim =
      feature === undefined
        ? undefined
        : await reserve?.(body, feature, guard?.paidEstimatedInputTokens, signal, reservationUsd)
    if (run !== undefined && claim === undefined)
      throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
    return claim === undefined ? undefined : { claim, isSent: false, run }
  }

  /** A billed image request: only a 429 is retried, with a deadline of its own. */
  private async imageRequest(
    path: string,
    body: CreateImageBody,
    signal: AbortSignal,
    admitAttempt?: ResponseAttemptGuard,
  ): Promise<ImagesResponse> {
    const active = AbortSignal.any([signal, AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS)])
    const paid = await this.paidReservation(body, 'imageGeneration', active, admitAttempt)
    const claim = paid?.claim
    try {
      const result = await this.transport.request(
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
      const parsed = await parseJsonResponse(result, (json) => imagesResponseSchema.parse(json))
      // The request asks for one image; ambiguous results retain their flat fee.
      if (claim !== undefined) {
        await claim.settle(Usd.from(parsed.data.length === 0 ? 0 : claim.reservedUsd).toAmount())
      }
      return parsed
    } finally {
      if (paid?.isSent === false) {
        await paid.claim.settle(Usd.from(0).toAmount())
      }
    }
  }

  private searchTokenCostUsd(
    usage: BillableUsage,
    modelId: string,
    unknownChargeUsd?: UsdAmount,
  ): UsdAmount {
    const knownCost =
      modelApiPaidTier(modelId) === undefined ? undefined : estimateCostUsd(usage, modelId)
    const cost =
      this.deps.searchTokenCostUsd === undefined
        ? knownCost
        : this.deps.searchTokenCostUsd(usage, modelId)
    if (
      cost === undefined ||
      !usdAmountSchema.safeParse(cost).success ||
      Usd.from(cost).compare(Usd.from(0)) < 0
    ) {
      throw new Error(
        unknownChargeUsd === undefined
          ? fill(UI_TEXT.sessionBudgetUnpriced, { model: modelId })
          : fill(UI_TEXT.sessionBudgetUnknownCharge, { amount: formatUsd(unknownChargeUsd) }),
      )
    }
    return Usd.from(cost).toAmount()
  }

  /** Children inherit their parent's token through the same authority. */
  public inheritSearchQuote(parent: PaidQuote, quote: PaidQuote): boolean {
    return this.deps.paidAuthority?.inherit(parent, quote) ?? true
  }

  public releaseSearchQuotes(
    conversationId: string,
    retainedQuoteIds: readonly string[] = [],
  ): void {
    this.deps.paidAuthority?.releaseConversation(conversationId, retainedQuoteIds)
  }

  /** Each session owns its authority callback, even when hosts share transport. */
  public withScheduleAuthority(run: () => UnattendedRun | undefined): ModelApiClient {
    return new ModelApiClient(this.deps, run)
  }

  /** Whether interactive extras have a finite daily admission port (D78). */
  public get hasPaidDailyBudget(): boolean {
    return this.deps.reservePaidRequest !== undefined
  }

  public providerId(modelId: string): string {
    return this.deps.providerId?.(modelId) ?? new URL(this.deps.baseUrl).origin
  }

  public searchPriceUsd(modelId: string): UsdAmount | undefined {
    try {
      const price =
        this.deps.webSearchPriceUsd === undefined
          ? webSearchPriceUsd(modelId)
          : this.deps.webSearchPriceUsd(modelId)
      return price !== undefined &&
        usdAmountSchema.safeParse(price).success &&
        !price.startsWith('-')
        ? price
        : undefined
    } catch {
      return undefined
    }
  }

  /** Bind a one-use child consent to the stored key without retaining it. */
  public async currentKeyDigest(): Promise<string> {
    return await this.transport.currentKeyDigest()
  }

  public async requestFile(
    ...args: Parameters<RequestTransport['requestFile']>
  ): Promise<Response> {
    return await this.transport.requestFile(...args)
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

  /** Public, non-inference health read. The status capture required no authentication. */
  public async readServiceStatus(
    signal?: AbortSignal,
  ): Promise<ReturnType<typeof modelApiStatusSchema.parse>> {
    if ((this.deps.pacingProvider?.(undefined).identity.provider ?? 'meta') !== 'meta') {
      throw new Error(UI_TEXT.modelApiStatusUnavailable)
    }
    let status = 0
    let retryAfter: number | undefined
    try {
      const response = await this.transport.fetchWithIdleDeadline(`${MODEL_API_BASE_URL}/status`, {
        method: 'GET',
        headers: { Accept: JSON_MEDIA_TYPE },
        signal: AbortSignal.any([
          AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),
          ...(signal === undefined ? [] : [signal]),
        ]),
      })
      status = response.status
      retryAfter = retryAfterMs(response.headers.get('retry-after'), this.deps.now())
      if (!response.ok) {
        void response.body?.cancel().catch(ignoreClosingError)
        throw new Error(UI_TEXT.modelApiStatusUnavailable)
      }
      // Bounded like every other Model API body: an oversized status page is
      // cancelled at the cap instead of being buffered whole before zod runs.
      return modelApiStatusSchema.parse(JSON.parse(await readBoundedText(response)))
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
  public async countInputTokens(
    body: Omit<CreateResponseBody, 'stream'>,
    signal?: AbortSignal,
  ): Promise<number> {
    const deadline = AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS)
    const result = await this.transport.request(
      '/responses/input_tokens',
      { method: 'POST', body, modelId: body.model, accept: JSON_MEDIA_TYPE },
      signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
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
      await admitAttempt?.mediaAccounting?.finish()
      throw new Error(UI_TEXT.scheduleConfirmationExpired)
    }
    let feature = admitAttempt?.paidFeature
    if (feature === undefined && confirmed !== undefined) {
      feature = 'scheduledPrompts'
    }
    if (feature === undefined && body.tools.some((tool) => tool.type === 'web_search')) {
      feature = 'webSearch'
    }
    const hasSearch = body.tools.some((tool) => tool.type === 'web_search')
    const searchQuote = admitAttempt?.searchQuote
    const searchPrice =
      searchQuote?.tariffUsd ?? (hasSearch ? this.searchPriceUsd(body.model) : undefined)
    let paid: Awaited<ReturnType<ModelApiClient['paidReservation']>>
    const authority = this.deps.paidAuthority ?? new PaidAuthority()
    const claimId =
      searchQuote === undefined
        ? undefined
        : `${searchQuote.id}:${String(this.searchClaimSequence++)}`
    const searchItems = new Set<string>()
    let returnedSearches = 0
    let searchCharge: SearchSettlement | undefined
    const returnedFees = () =>
      searchCharge?.costUsd ?? multiplyUsd(searchPrice ?? Usd.from(0).toAmount(), returnedSearches)
    const returnedLiability = (reservedUsd: UsdAmount, shouldKeepAllowance: boolean) =>
      sumUsd(
        reservedUsd,
        shouldKeepAllowance && returnedSearches <= (body.max_tool_calls ?? 0)
          ? Usd.from(0).toAmount()
          : Usd.from(returnedFees())
              .subtract(
                Usd.from(
                  multiplyUsd(searchPrice ?? Usd.from(0).toAmount(), body.max_tool_calls ?? 0),
                ),
              )
              .toAmount(),
      )
    const noteReturned = (isTerminal: boolean) => {
      if (searchQuote === undefined || claimId === undefined) return
      const effects = authority.dispatch({
        type: 'settle',
        claimId,
        returnedCalls: returnedSearches,
        isTerminal,
      })
      for (const effect of effects) {
        if (effect.type === 'settled') searchCharge = effect.settlement
      }
      if (searchCharge !== undefined) admitAttempt?.onSearchesReturned?.(searchCharge)
    }
    let hasTerminal = false
    let hasTerminalSearchCount = false
    const noteSearchAnomaly = () => {
      if (body.max_tool_calls !== undefined && returnedSearches > body.max_tool_calls) {
        this.deps.log.warn(
          `Hosted search returned ${String(returnedSearches)} calls above its bound of ${String(body.max_tool_calls)}; all calls are charged`,
        )
      }
    }
    try {
      const media = admitAttempt?.mediaAccounting
      if (
        media !== undefined &&
        (body.model !== media.modelId || body.max_output_tokens > media.maxOutputTokens)
      )
        throw new Error('Media reservation does not match this request')
      let reservationUsd: UsdAmount | undefined
      // A scheduled fire always reserves against its own finite ledger.
      if (hasSearch && (this.hasPaidDailyBudget || this.scheduledRun !== undefined)) {
        if (body.max_tool_calls === undefined)
          throw new Error(UI_TEXT.sessionBudgetSearchUnavailable)
        const inputTokens =
          admitAttempt?.paidEstimatedInputTokens ??
          estimateInput(requestParts(body), undefined).inputTokens
        reservationUsd = sumUsd(
          this.searchTokenCostUsd(
            { inputTokens, outputTokens: body.max_output_tokens, cachedTokens: 0 },
            body.model,
          ),
          searchAllowanceUsd(body.max_tool_calls, searchPrice),
        )
      }
      // M105 media holds its own session and daily claims; everything else
      // keeps paidReservation, so a scheduled run is held to its own caps.
      paid =
        media === undefined
          ? await this.paidReservation(body, feature, signal, admitAttempt, reservationUsd)
          : undefined
      const claim = paid?.claim
      if (searchQuote !== undefined && claimId !== undefined) {
        if (this.deps.paidAuthority === undefined) {
          const grant = { quote: searchQuote, generation: 'caller' }
          authority.dispatch({ type: 'quote', ...grant, ask: true })
          authority.dispatch({ type: 'answer', grant, answer: 'once' })
        } else if (!authority.canSpend(searchQuote))
          throw new Error(UI_TEXT.sessionBudgetSearchUnavailable)
        authority.dispatch({
          type: 'reserve',
          claimId,
          quote: searchQuote,
          reservedUsd: claim?.reservedUsd ?? searchAllowanceUsd(body.max_tool_calls, searchPrice),
        })
      }
      const { response, redact, redactContent, eventParsed } = await this.transport.streamRequest(
        '/responses',
        {
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
            typeof value === 'string' ? redactContent(value) : value,
          )
          const known = streamEventSchema.safeParse(json)
          if (known.success) {
            eventParsed(known.data)
            const event = redactStreamDiagnostics(known.data, redact)
            if (
              known.data.type === 'response.output_item.done' &&
              known.data.item.type === 'web_search_call'
            ) {
              searchItems.add(
                known.data.item.id ??
                  (known.data.output_index === undefined
                    ? `unidentified:${String(searchItems.size)}`
                    : `index:${String(known.data.output_index)}`),
              )
              returnedSearches = searchItems.size
              noteReturned(false)
            }
            if (
              ['response.completed', 'response.incomplete', 'response.failed'].includes(
                known.data.type,
              ) &&
              'response' in known.data
            ) {
              returnedSearches = Math.max(
                returnedSearches,
                known.data.response.output.filter((item) => item.type === 'web_search_call').length,
              )
              hasTerminalSearchCount = true
              noteReturned(true)
              noteSearchAnomaly()
              const usage = known.data.response.usage
              const cached = usage?.input_tokens_details?.cached_tokens ?? 0
              const isCountedUsage =
                usage !== null &&
                usage !== undefined &&
                Number.isSafeInteger(usage.input_tokens) &&
                usage.input_tokens >= 0 &&
                Number.isSafeInteger(usage.output_tokens) &&
                usage.output_tokens >= 0 &&
                Number.isSafeInteger(cached) &&
                cached >= 0 &&
                cached <= usage.input_tokens
              // M105 media settles its own claims on counted usage, with or without a token claim.
              if (isCountedUsage) await admitAttempt?.mediaAccounting?.settle(usage)
              if (claim !== undefined && isCountedUsage) {
                const billable = {
                  inputTokens: usage.input_tokens,
                  outputTokens: usage.output_tokens,
                  cachedTokens: cached,
                }
                await claim.settle(
                  sumUsd(
                    hasSearch
                      ? this.searchTokenCostUsd(
                          billable,
                          body.model,
                          returnedLiability(claim.reservedUsd, false),
                        )
                      : estimateCostUsd(billable, body.model),
                    returnedFees(),
                  ),
                )
              } else if (claim !== undefined && hasSearch && body.max_tool_calls !== undefined) {
                await claim.settle(returnedLiability(claim.reservedUsd, false))
              }
              hasTerminal = true
            }
            yield event
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
      try {
        if (!hasTerminal) noteSearchAnomaly()
        if (paid?.isSent === false) await paid.claim.settle(Usd.from(0).toAmount())
        else if (paid !== undefined && hasSearch && !hasTerminal) {
          await paid.claim.settle(
            returnedLiability(paid.claim.reservedUsd, !hasTerminalSearchCount),
            !hasTerminalSearchCount,
          )
        }
      } finally {
        await admitAttempt?.mediaAccounting?.finish()
      }
    }
  }
}
