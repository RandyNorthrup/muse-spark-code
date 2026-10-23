import { UserRefusalError } from '../../refusal'
import { uiLocale } from '../../../shared/l10n/text'
import { resolveAttemptBillingRoute, type BillingRoute } from './billingRoute'
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
  assertConfirmedAllowed,
  ignoreClosingError,
  ModelApiError,
  parseJsonResponse,
  readBoundedText,
  redactStreamDiagnostics,
  rethrowStreamError,
  type ConfirmedModelRequest,
  type ResponseAttemptGuard,
  type RetryBudget,
  type RetryNotice,
  providerWaitMs,
} from './transport'
import type { SpendClaim } from '../../paid/spendClaim'
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
} from './transport'
import type { ProviderClient as TransportProviderClient } from './providerClient'
import type { ContextModel } from '../../context/overflow'
import type { PlanUsageRow } from '../../../shared/usage'
import {
  estimatedStreamTokens,
  modelPolicyFor,
  modelPricedUsage,
  requestImageCount,
  type ModelResolver,
  type ModelPricePolicy,
} from './modelPolicy'
import {
  type PaidFeature,
  MODEL_API_BASE_URL,
  MODEL_API_MIN_OUTPUT_TOKENS,
  MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS,
  UI_TEXT,
} from '../../../shared/constants'
import { estimateInput, requestParts, searchAllowanceUsd } from './sessionBudget'

import type { CoreLogger } from '../../logging'
import type { NetworkAdvice } from '../../networkFailure'
import {
  type CreateImageBody,
  type EditImageBody,
  type CreateResponseBody,
  hasDeclaredTools,
  omitToolShape,
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
import { estimateCostUsd, type BillableUsage } from '../../usage/insights'
import { webSearchPriceUsd } from '../../paid/paidFeatures'
import { modelApiPaidTier, type PaidQuote, type SearchSettlement } from '../../../shared/paid'
import { Usd, sumUsd, multiplyUsd, usdAmountSchema, type UsdAmount } from '../../../shared/usd'

import { redactSecrets } from '../../redact'
import { fill } from '../../../shared/l10n/text'
import { startStillWaiting, stillWaitingText } from '../../timeouts'
import { outputTokenMinimumMessage } from '../../../shared/providerRouting'

import type { PacingProvider, RequestPacer } from './pacing'
import { fanOutPacingClass } from './subagentTools'
import type { ChatGptPlanFacts } from './planFacts'

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
    | 'withAccountKey'
    | 'withScheduleAuthority'
    | 'requestFile'
    | 'requestTranscription'
    // M94's record-maximum query is ModelApiClient-specific: only the key
    // client answers it, never a configured provider facade.
    | 'recordMaxOutputTokens'
  >
> & {
  readonly providerId?: ModelApiClient['providerId']
  readonly searchPriceUsd?: ModelApiClient['searchPriceUsd']
  readonly inheritSearchQuote?: ModelApiClient['inheritSearchQuote']
  readonly releaseSearchQuotes?: ModelApiClient['releaseSearchQuotes']
  readonly readServiceStatus?: ModelApiClient['readServiceStatus']
  readonly withAccountKey?: (
    apiKey: () => Promise<string>,
    isCurrent?: () => boolean,
  ) => ProviderClient
  readonly withScheduleAuthority?: (run: () => UnattendedRun | undefined) => ProviderClient
  readonly provider?: TransportProviderClient['provider']
  /** The Files transport rides along only when the wrapped client carries it. */
  readonly requestFile?: ModelApiClient['requestFile']
  /** So does the batch transcription POST (U18): only Meta's own client carries it. */
  readonly requestTranscription?: ModelApiClient['requestTranscription']
  readonly models?: ModelResolver
  readonly modelContextLimit?: (model: string) => number | undefined
  /**
  C-M95-4 R3: the registry's live window for a configured model, read
  synchronously from its last listing for compaction sizing. Undefined
  when the registry never listed the model (the previous fallback
  stands) or its window is unknown (the request refuses instead).
  */
  readonly peekContextModel?: (model: string) => ContextModel | undefined
  readonly isPlanModel?: (model: string) => boolean
  /**
  The plan models this client serves without any Meta request (the
  signed-in ChatGPT and Copilot plans), listed on a computer that stores
  no Meta key. Absent on clients without a plan route.
  */
  readonly listPlanModels?: () => Promise<string[]>
  /**
  The plan catalogue's facts for one model reference. Resolves them from
  the client's cache, fetching the catalogue when no listing warmed it;
  undefined where the catalogue names nothing. Absent on clients without
  a plan route, where the policy keeps today's behaviour.
  */
  readonly planModelFacts?: (model: string) => Promise<ChatGptPlanFacts | undefined>
  readonly readPlanUsage?: () => readonly PlanUsageRow[]
  /**
  EXECPROV round 6: an exact same-body input count where the provider
  documents one (type-only; implementations live in lazy bundles).
  */
  readonly countInputTokensDetailed?: (
    body: CreateResponseBody,
    signal?: AbortSignal,
  ) => Promise<{ readonly tokens: number; readonly costUsd?: UsdAmount | undefined }>
}
import type { SecretScrubPort } from '../../../shared/redact'

import type { UnattendedRun } from '../../schedules/unattended'

export interface ModelApiClientDeps {
  readonly isCredentialCurrent?: () => boolean
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
  readonly isRetryableFailure?: (failure: ModelApiError) => boolean
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
  ) => Promise<SpendClaim | undefined>
  /** M95 integration: a provider's verified hosted-search tariff, never a fallback estimate. */
  readonly providerId?: ((modelId: string) => string) | undefined
  readonly webSearchPriceUsd?: (modelId: string) => UsdAmount | undefined
  /** M95's verified token pricing; an unpriced provider cannot spend under a search cap. */
  readonly searchTokenCostUsd?: (usage: BillableUsage, modelId: string) => UsdAmount | undefined
  readonly fetch: typeof fetch
  readonly baseUrl: string
  /** Read per request so a key pasted later applies without a restart. */
  readonly apiKey: () => Promise<string | undefined>
  /**
  Lane RETRYLIMITS: the person's `museSpark.modelApiMaxRetries` setting,
  read live so a change applies without a restart; undefined (or absent)
  leaves Meta's documented 3–5 attempts in force.
  */
  readonly personCap?: (() => number | undefined) | undefined
  /**
  The stored pay-as-you-go key for paid extras (C-M95-SUB): while chat
  bills the subscription, a billed image POST still authenticates as the
  stored key. Undefined while no key is stored; image requests then
  refuse instead of charging the subscription.
  */
  readonly paidApiKey?: () => Promise<string | undefined>
  readonly getBillingRoute?: ((isPaid: boolean) => Promise<BillingRoute | undefined>) | undefined
  /** Absent, the transport waits with `abortableSleep` (see `TransportDeps.sleep`). */
  readonly sleep?: ((ms: number) => Promise<void>) | undefined
  /** Epoch ms, for a `Retry-After` given as a date. */
  readonly now: () => number
  /** 0 ≤ n < 1, for the retry jitter; injected so tests are deterministic. */
  readonly random: () => number
  readonly log: CoreLogger
  /** Idle limit for headers and all response-body reads; tests may shorten it. */
  readonly streamIdleMs?: number
  /**
  Whose settings a request that never reached Meta names (M56): VS Code's
  unless the ACP agent says its own (PLAN.md D62, Q66).
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
    private readonly scheduledPrice?: ModelPricePolicy,
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
    estimatedInputTokens = guard?.paidEstimatedInputTokens,
  ) {
    const run = this.scheduledRun?.()
    if (run === undefined && this.scheduledRun !== undefined)
      throw new UserRefusalError(UI_TEXT.paidDailyLedgerUnavailable, 'daily_ledger')
    const reserve =
      run === undefined
        ? (guard?.reservePaidRequest ?? this.deps.reservePaidRequest)
        : run.reservePaidRequest
    feature ??= run === undefined ? undefined : 'scheduledPrompts'
    const claim =
      feature === undefined
        ? undefined
        : await reserve?.(body, feature, estimatedInputTokens, signal, reservationUsd)
    if (run !== undefined && claim === undefined)
      throw new UserRefusalError(UI_TEXT.paidDailyLedgerUnavailable, 'daily_ledger')
    return claim === undefined ? undefined : { claim, isSent: false, run }
  }

  /** A billed image request: only a 429 is retried, with no deadline of its own. */
  private async imageRequest(
    path: string,
    body: CreateImageBody,
    signal: AbortSignal,
    admitAttempt?: ResponseAttemptGuard,
  ): Promise<ImagesResponse> {
    // Waited on until Meta answers or the turn stops it (owner 2026-10-16:
    // no arbitrary limits), saying so out loud while it waits.
    const stopNoticing = startStillWaiting((elapsedMs) => {
      this.deps.log.info(stillWaitingText({ key: 'imageRequest' }, elapsedMs))
    })
    // A paid extra never rides the subscription credential: while chat
    // bills the plan, the image POST authenticates as the stored
    // pay-as-you-go key, and refuses with the fix when none is stored.
    const paidKey =
      admitAttempt?.billingRoute?.credential ??
      (this.deps.getBillingRoute === undefined ? await this.deps.paidApiKey?.() : undefined)
    if (
      paidKey === undefined &&
      this.deps.getBillingRoute === undefined &&
      this.deps.paidApiKey !== undefined
    ) {
      throw new Error(UI_TEXT.subscriptionKey.paidNeedsKey)
    }
    // The reservation is inside the try: it can throw (consent denied, the
    // daily ledger unavailable), and the notice timer must still stop.
    let paid: Awaited<ReturnType<ModelApiClient['paidReservation']>>
    let hasOutcome = false
    try {
      paid = await this.paidReservation(body, 'imageGeneration', signal, admitAttempt)
      const claim = paid?.claim
      const result = await this.transport.request(
        path,
        {
          billingRoute: await resolveAttemptBillingRoute({
            feature: 'imageGeneration',
            isMetaDirect: true,
            snapshot: admitAttempt?.billingRoute,
            resolve: this.deps.getBillingRoute,
            readCredential: () =>
              Promise.resolve(
                paidKey ?? (this.deps.paidApiKey === undefined ? this.deps.apiKey() : undefined),
              ),
          }),
          method: 'POST',
          body,
          modelId: body.model,
          accept: JSON_MEDIA_TYPE,
          retries: 'rateLimitOnly',
          ...(paidKey !== undefined && { authKey: paidKey }),
          ...(paid !== undefined && { paid }),
        },
        signal,
        undefined,
        undefined,
        admitAttempt,
      )
      const parsed = await parseJsonResponse(result, (json) => imagesResponseSchema.parse(json))
      // Each returned image has the published flat fee, including an unexpected extra image.
      if (claim !== undefined) {
        await claim.settle(Usd.from(claim.estimateUsd).times(parsed.data.length).toAmount())
      }
      hasOutcome = true
      return parsed
    } finally {
      stopNoticing()
      // Unsent: nothing; sent with no answer: its cost is unknown, never its price (D208).
      if (paid?.isSent === false) {
        await paid.claim.settle(Usd.from(0).toAmount())
      } else if (paid !== undefined && !hasOutcome) {
        await paid.claim.settle(undefined)
      }
    }
  }

  /** The token cost a search request's usage prices at; `undefined` when unknown. */
  private knownSearchTokenCostUsd(usage: BillableUsage, modelId: string): UsdAmount | undefined {
    const knownCost =
      modelApiPaidTier(modelId) === undefined ? undefined : estimateCostUsd(usage, modelId)
    const cost =
      this.deps.searchTokenCostUsd === undefined
        ? knownCost
        : this.deps.searchTokenCostUsd(usage, modelId)
    return cost === undefined ||
      !usdAmountSchema.safeParse(cost).success ||
      Usd.from(cost).compare(Usd.from(0)) < 0
      ? undefined
      : Usd.from(cost).toAmount()
  }

  /** A search request's estimate needs a verified token price: unpriced, it is not sent. */
  private searchTokenCostUsd(usage: BillableUsage, modelId: string): UsdAmount {
    const cost = this.knownSearchTokenCostUsd(usage, modelId)
    if (cost === undefined)
      throw new UserRefusalError(fill(UI_TEXT.sessionBudgetUnpriced, { model: modelId }))
    return cost
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
  public withScheduleAuthority(
    run: () => UnattendedRun | undefined,
    price?: ModelPricePolicy,
  ): ModelApiClient {
    return new ModelApiClient(this.deps, run, price)
  }

  /** Request-owned credential source; every attempt still uses the shared transport gates. */
  public withAccountKey(apiKey: () => Promise<string>, isCurrent?: () => boolean): ModelApiClient {
    return new ModelApiClient(
      { ...this.deps, apiKey, ...(isCurrent !== undefined && { isCredentialCurrent: isCurrent }) },
      this.scheduledRun,
      this.scheduledPrice,
    )
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

  /** U18's batch transcription POST on this client's endpoint and key (D85.5). */
  public async requestTranscription(
    ...args: Parameters<RequestTransport['requestTranscription']>
  ): Promise<Response> {
    return await this.transport.requestTranscription(...args)
  }

  /** The wait before retry number `attempt` (0-based): the same backoff and jitter as a request's. */
  public retryDelayMs(attempt: number): number {
    return this.transport.backoffMs(attempt, undefined)
  }

  /**
  This client's effective retry limit (see `ProviderClient.maxRetries`).
  Meta serves its own models only, so the selected model does not change
  the answer; an aggregate client reads it instead (PR #225).
  */
  public maxRetries(_modelId?: string): number | undefined {
    return this.transport.maxRetries()
  }

  /** The person's live retry limit, uncapped (see `RequestTransport.personCap`). */
  public personCap(): number | undefined {
    return this.transport.personCap()
  }

  /** Waits `ms`, or rejects as soon as the turn's Stop aborts `signal`. */
  public async waitBeforeRetry(ms: number, signal: AbortSignal): Promise<void> {
    await this.transport.pause(ms, signal)
  }

  /** The chat model ids the key can use, as the catalogue lists them. */
  public async listModels(signal?: AbortSignal): Promise<readonly string[]> {
    // No deadline of our own (owner 2026-10-16): the catalogue read ends at
    // the provider's answer, a network failure, or the caller's signal
    // (Stop owns the wait; PR #214 review).
    const result = await this.transport.request(
      '/models',
      {
        billingRoute: await resolveAttemptBillingRoute({
          feature: 'catalogue',
          isMetaDirect: true,
          resolve: this.deps.getBillingRoute,
          readCredential: this.deps.apiKey,
        }),
        method: 'GET',
        accept: JSON_MEDIA_TYPE,
      },
      signal,
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
        // The caller's signal, if any; no deadline of our own (owner 2026-10-16).
        ...(signal !== undefined && { signal }),
      })
      status = response.status
      retryAfter = providerWaitMs(response.headers, this.deps.now())
      if (!response.ok) {
        void response.body?.cancel().catch(ignoreClosingError)
        throw new Error(UI_TEXT.modelApiStatusUnavailable)
      }
      // Bounded like every other Model API body: an oversized status page is
      // cancelled at the cap instead of being buffered whole before zod runs.
      return modelApiStatusSchema.parse(JSON.parse(await readBoundedText(response)))
    } catch (error: unknown) {
      // Shared scrubber plus an allowlist: provider prose, identifiers, stack and causes never cross.
      const failure = new ModelApiError(
        redactSecrets(UI_TEXT.modelApiStatusUnavailable),
        status,
        'service_status',
        undefined,
      )
      throw Object.assign(failure, { retryAfterMs: retryAfter, cause: error })
    }
  }

  /**
  M94 goal (D121): the provider's maximum output for a Tab model, from the
  model's policy (the same documented maximum the capability record
  carries for Meta models). The fallback repeats it, so a silent policy
  still answers it.
  */
  public recordMaxOutputTokens(model: string): number {
    return modelPolicyFor(model).output.maxTokens ?? MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS
  }

  /** Tokens the rendered input would occupy; not billed (dev.meta.ai/docs/token-counting). */
  public async countInputTokens(
    body: Omit<CreateResponseBody, 'stream'>,
    signal?: AbortSignal,
  ): Promise<number> {
    // No deadline of our own (owner 2026-10-16): the caller's signal, if
    // any, ends it, else the provider's answer or a network failure.
    const result = await this.transport.request(
      '/responses/input_tokens',
      {
        billingRoute: await resolveAttemptBillingRoute({
          feature: 'tokenCount',
          isMetaDirect: true,
          resolve: this.deps.getBillingRoute,
          readCredential: this.deps.apiKey,
        }),
        method: 'POST',
        body,
        modelId: body.model,
        accept: JSON_MEDIA_TYPE,
        countRequest: true,
      },
      signal,
    )
    return await parseJsonResponse(result, (json) => inputTokensSchema.parse(json).input_tokens)
  }

  /**
  One generated image (M34): `POST /images/generations`, validated. Billed
  per image returned; a failed or filtered one is not. The turn's Stop and
  a deadline of its own end the wait.
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
  The streamed response as validated events. Unknown event types are
  skipped; a malformed known one or a non-JSON frame ends the stream with
  an error, since the reply can no longer be trusted.
  M101-REPLAY-ORIGIN: Meta's own route sends replay items as produced and
  takes no provenance map; the parameter exists so every client shares one
  call shape, and only the configured Responses codec reads it.
  */
  public async *streamResponse(
    body: CreateResponseBody,
    signal: AbortSignal,
    onRetry?: (notice: RetryNotice) => void,
    budget?: RetryBudget,
    admitAttempt?: ResponseAttemptGuard,
    confirmed?: ConfirmedModelRequest,
    _replayOrigins?: Readonly<Record<string, string>>,
  ): AsyncGenerator<StreamEvent> {
    if (body.max_output_tokens < MODEL_API_MIN_OUTPUT_TOKENS) {
      await admitAttempt?.mediaAccounting?.finish()
      throw new RangeError(outputTokenMinimumMessage(MODEL_API_MIN_OUTPUT_TOKENS))
    }
    try {
      assertConfirmedAllowed(body.model, confirmed)
    } catch (error: unknown) {
      await admitAttempt?.mediaAccounting?.finish()
      throw error
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
    const authority = this.deps.paidAuthority ?? new PaidAuthority(UI_TEXT, uiLocale())
    const claimId =
      searchQuote === undefined
        ? undefined
        : `${searchQuote.id}:${String(this.searchClaimSequence++)}`
    const searchItems = new Set<string>()
    let returnedSearches = 0
    let searchCharge: SearchSettlement | undefined
    const returnedFees = () =>
      searchCharge?.costUsd ?? multiplyUsd(searchPrice ?? Usd.from(0).toAmount(), returnedSearches)
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
      let reservationUsd = media?.estimateUsd
      // A scheduled fire is always checked against its own finite ledger.
      if (hasSearch && (this.hasPaidDailyBudget || this.scheduledRun !== undefined)) {
        if (body.max_tool_calls === undefined)
          throw new UserRefusalError(UI_TEXT.sessionBudgetSearchUnavailable, 'search_unbounded')
        const inputTokens =
          admitAttempt?.paidEstimatedInputTokens ??
          estimateInput(requestParts(body), undefined).inputTokens
        reservationUsd = sumUsd(
          media?.estimateUsd ??
            this.searchTokenCostUsd(
              { inputTokens, outputTokens: body.max_output_tokens, cachedTokens: 0 },
              body.model,
            ),
          searchAllowanceUsd(body.max_tool_calls, searchPrice),
        )
      }
      if (media !== undefined && this.scheduledRun !== undefined) {
        await media.rebindDaily(async () => {
          paid = await this.paidReservation(
            body,
            feature,
            signal,
            admitAttempt,
            reservationUsd,
            media.inputTokens,
          )
          if (paid === undefined)
            throw new UserRefusalError(UI_TEXT.paidDailyLedgerUnavailable, 'daily_ledger')
          const claim = paid.claim
          return {
            check: () => {
              claim.check()
            },
            settle: (costUsd) =>
              claim.settle(costUsd === undefined ? undefined : sumUsd(costUsd, returnedFees())),
          }
        })
      } else if (media === undefined) {
        paid = await this.paidReservation(body, feature, signal, admitAttempt, reservationUsd)
      }
      const claim = paid?.claim
      if (searchQuote !== undefined && claimId !== undefined) {
        if (this.deps.paidAuthority === undefined) {
          const grant = { quote: searchQuote, generation: 'caller' }
          authority.dispatch({ type: 'quote', ...grant, ask: true })
          authority.dispatch({ type: 'answer', grant, answer: 'once' })
        } else if (!authority.canSpend(searchQuote))
          throw new UserRefusalError(UI_TEXT.sessionBudgetSearchUnavailable, 'search_unbounded')
        authority.dispatch({
          type: 'reserve',
          claimId,
          quote: searchQuote,
          reservedUsd: claim?.estimateUsd ?? searchAllowanceUsd(body.max_tool_calls, searchPrice),
        })
      }
      admitAttempt?.check?.()
      // The Meta-direct wire exit: a tool-less request omits tools and tool
      // choice alike (see `hasDeclaredTools`), the same omitted shape the
      // Responses codec sends configured providers. Estimates above keep
      // reading the canonical body; only these sent bytes change.
      const wireBody = hasDeclaredTools(body.tools) ? body : omitToolShape(body)
      const { response, redact, redactContent, eventParsed } = await this.transport.streamRequest(
        '/responses',
        {
          billingRoute: await resolveAttemptBillingRoute({
            feature: feature ?? 'ordinary',
            paidFeature: admitAttempt?.paidFeature,
            isMetaDirect: true,
            snapshot: admitAttempt?.billingRoute,
            resolve: this.deps.getBillingRoute,
            readCredential: (isPaid) =>
              isPaid && this.deps.paidApiKey !== undefined
                ? this.deps.paidApiKey()
                : this.deps.apiKey(),
          }),
          body: wireBody,
          accept: EVENT_STREAM_MEDIA_TYPE,
          modelId: body.model,
          pacingClass: admitAttempt?.pacingClass ?? fanOutPacingClass(feature),
          estimatedTokens: estimatedStreamTokens(body, admitAttempt),
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
          } catch (error: unknown) {
            if (!(error instanceof SyntaxError)) throw error
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
              if (isCountedUsage) await media?.settle(usage)
              // After the call: its reported cost, or cost unknown when the
              // usage is missing or unpriced; never its estimate (D208).
              if (claim !== undefined && media === undefined) {
                let tokenCostUsd: UsdAmount | undefined
                if (isCountedUsage) {
                  const billable = {
                    inputTokens: usage.input_tokens,
                    outputTokens: usage.output_tokens,
                    cachedTokens: cached,
                  }
                  // A schedule's price policy settles its own reported cost;
                  // without one the reported cost is estimated as usual, and
                  // an unsettled policy leaves the cost unknown (D208).
                  const scheduled =
                    this.scheduledPrice === undefined
                      ? undefined
                      : this.scheduledPrice.settle(
                          { ...modelPricedUsage(usage), images: requestImageCount(body) },
                          { cost: usage.provider_cost_usd },
                        )
                  if (this.scheduledPrice !== undefined) tokenCostUsd = scheduled
                  else if (hasSearch)
                    tokenCostUsd = this.knownSearchTokenCostUsd(billable, body.model)
                  else tokenCostUsd = estimateCostUsd(billable, body.model)
                }
                // A scheduled run settles at its pinned price even when the
                // usage is uncounted; otherwise the reported cost settles,
                // or cost unknown when unpriced — never the estimate (D208).
                // Without a usage object there is nothing to price.
                const providerCost =
                  usage === null || usage === undefined
                    ? undefined
                    : this.scheduledPrice?.settle(
                        { ...modelPricedUsage(usage), images: requestImageCount(body) },
                        { cost: usage.provider_cost_usd },
                      )
                await claim.settle(
                  providerCost ??
                    (tokenCostUsd === undefined ? undefined : sumUsd(tokenCostUsd, returnedFees())),
                )
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
        // The stream ended in an error; the redacted failure keeps its cause below.
        this.deps.log.warn('A Model API stream ended before its terminal event')
        await rethrowStreamError(error, redact, response.status)
      } finally {
        // An early end (a malformed frame, a stall, the caller stopping)
        // closes the parser, which releases the response body (the review of
        // PR #20). Not awaited: after a stall its last read may never settle.
        void frames.return(undefined).catch(ignoreClosingError)
      }
    } finally {
      try {
        if (!hasTerminal) noteSearchAnomaly()
        // A claim settles once: unsent, nothing; sent with no terminal usage,
        // its cost is unknown (D208). A terminal frame settled it already.
        if (paid !== undefined && admitAttempt?.mediaAccounting === undefined)
          await paid.claim.settle(paid.isSent ? undefined : Usd.from(0).toAmount())
      } finally {
        await admitAttempt?.mediaAccounting?.finish()
      }
    }
  }
}
