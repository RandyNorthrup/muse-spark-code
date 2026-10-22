import { UserRefusalError } from '../../refusal'
import type { AttemptBillingRoute, BillingRoute } from './billingRoute'
import type { PaidUseRequest } from '../../../shared/paid'
import { notify } from '../../events/notify'
import type { PaidAuthority } from '../../paid/paidAuthority'
import type { PaidQuote, SearchSettlement } from '../../../shared/paid'
import {
  ModelApiPacing,
  metaPacingLimits,
  type PacingClass,
  type PacingProvider,
  type RequestPacer,
} from './pacing'
import {
  MODEL_API_BASE_URL,
  HTTP_TOO_MANY_REQUESTS,
  HTTP_STATUS,
  NON_BILLABLE_HTTP_REJECTIONS,
  PROVIDER_RETRY_HTTP_STATUS,
  MODEL_API_RETRY_BASE_MS,
  MODEL_API_RETRY_JITTER_MS,
  MODEL_API_RETRY_MAX_MS,
  MODEL_API_TIMER_MAX_MS,
  MILLISECONDS_PER_SECOND,
  UI_TEXT,
  PROVIDER_HTTP_BODY_MAX_BYTES,
  PROVIDER_REQUEST_ID_MAX_CHARS,
  type PaidFeature,
} from '../../../shared/constants'
// M95-T: the existing retry/admission loop, shared by Meta and injected codecs.
import { createHash } from 'node:crypto'

import type { SpendClaim } from '../../paid/spendClaim'
import type { MediaRequestAccounting } from '../../media/mediaCost'
import { fill, formatDateTime } from '../../../shared/l10n/text'
import {
  classifyRetry,
  effectiveMaxRetries,
  META_DOCUMENTED_RETRY_LIMITS,
  RETRY_TABLES,
  retryDelayMs,
  type RetryLimits,
  type RetryTables,
} from '../../../shared/retryPolicy'
import type { CoreLogger } from '../../logging'
import {
  describeNetworkFailure,
  isConnectionFailure,
  type NetworkAdvice,
  networkFailureMessage,
} from '../../networkFailure'
import { redactSecrets } from '../../redact'
import { scrubSecrets, secretRedactor, type SecretScrubPort } from '../../../shared/redact'
export { redactSecrets } from '../../redact'
import { errorBodySchema, type StreamEvent } from './schemas'
import { scrubRefusalLeak } from './providerRefusal'
import type { UnattendedRun } from '../../schedules/unattended'
import type { ModelApiClientDeps } from './client'

import {
  USAGE_HEADER_ALLOW_LIST,
  usageHeadersSchema,
  type UsageHeaders,
} from '../../../shared/usageJournal'
import type { AuthHeaders, AuthSource } from './authSource'
import { DeadlineError, startStillWaiting, stillWaitingText, withDeadline } from '../../timeouts'

export interface TransportDeps {
  readonly isCredentialCurrent?: () => boolean
  readonly vaultScrub?: SecretScrubPort
  readonly streamIdleMs?: number
  /**
  The still-waiting notice cadence for unnamed waits (a minute unless a
  test shortens it); the waits themselves never end at it.
  */
  readonly noticeMs?: number
  readonly pacing?: RequestPacer
  readonly pacingOwner?: object
  readonly pacingProvider?: (modelId: string | undefined) => PacingProvider
  readonly paidAuthority?: PaidAuthority
  readonly onServiceFailure?: (status: number, statusUrl: string) => void
  readonly isRetryableFailure?: (failure: ModelApiError) => boolean
  readonly scheduledRun?: () => UnattendedRun | undefined
  readonly fetch: typeof fetch
  readonly baseUrl: string
  readonly apiKey?: () => Promise<string | undefined>
  readonly auth?: AuthSource
  /** Required by CodecClient: resolve/recheck against the saved network on every attempt. */
  readonly verifyEndpoint?: (url: string) => Promise<void>
  readonly parseError?: (status: number, body: unknown, headers: Headers) => ModelApiError
  /** The preset's own retry table (OPENAI-G20); defaults to the Responses table. */
  readonly retryTable?: RetryTables
  /**
  The provider's documented retry bounds (lane RETRYLIMITS,
  `FormatQuirks.retryLimits`); the Model API transport defaults to Meta's
  own 3–5 attempts. Absent fields are values the provider does not
  document: the person's setting decides, and with none set the
  provider's own Retry-After (or stop answer) governs.
  */
  readonly retryLimits?: RetryLimits
  /**
  The person's `museSpark.modelApiMaxRetries` setting, read live so a
  change applies without a restart; undefined (or absent) leaves the
  provider's documented maximum in force.
  */
  readonly personCap?: (() => number | undefined) | undefined
  /**
  One timer chunk of a retry wait. A cooperating sleep clears its own
  timer when `signal` aborts (see `abortableSleep`); one that ignores
  the signal is abandoned by `pause`'s race exactly as before. Absent,
  the transport waits with `abortableSleep` (lane PR225W1: every
  production wait dies with Stop, with no per-client wiring to pay for
  in the activation bundle); tests keep injecting their own sleep.
  */
  readonly sleep?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined
  readonly now: () => number
  readonly random: () => number
  readonly log: CoreLogger
  readonly networkAdvice?: NetworkAdvice
  /**
  The sentence a send that produced no answer reads as: a configured
  provider names itself, the network failure and that whether the request
  arrived is unknown. Meta's network advice when absent.
  */
  readonly sendFailure?: (error: unknown) => string
}

/** U18's captured route: one fresh lowercase session UUID per POST, nothing else. */
const TRANSCRIPTION_ROUTE =
  /^\/asr\/transcribe\?sessionId=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const MULTIPART_PREFIX = 'multipart/form-data; boundary='

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
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
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
  /** The provider's request id, when its answer carried one (lane PROVERR). */
  public requestId: string | undefined
  /** The answer's parsed `Retry-After`, when it carried one (lane PROVERR). */
  public retryAfterMs: number | undefined
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
  const out = new ModelApiError(
    error instanceof SyntaxError
      ? fill(UI_TEXT.webFetchNetwork, { detail: 'malformed_json' })
      : redact(error instanceof Error ? error.message : String(error)),
    isModelApiError(error) ? error.status : fallbackStatus,
    isModelApiError(error) && error.kind !== undefined ? redact(error.kind) : undefined,
    isModelApiError(error) && error.code !== undefined ? redact(error.code) : undefined,
  )
  // Lane PROVERR: a refusal keeps its request id and wait across the privacy
  // boundary (both are provider-chosen, never credentials).
  if (isModelApiError(error)) {
    out.requestId = error.requestId
    out.retryAfterMs = error.retryAfterMs
  }
  return out
}

/**
Local refusals keep their own sentence; the classifier rides the lazy
provider bundle, keeping this bundle on its pin. Everything else leaves
redacted, at the response's status.
*/
export async function rethrowStreamError(
  error: unknown,
  redact: (text: string) => string,
  status: number,
): Promise<never> {
  const { isUserRefusal } = await import('../../refusal')
  if (isUserRefusal(error) && !isModelApiError(error) && redact(error.message) === error.message)
    throw error
  throw redactModelApiError(error, redact, status)
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
// Azure OpenAI's 429 wait in milliseconds (research azure-openai.md ZB2,
// https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/quota, read
// 2026-10-17): read before `Retry-After`, which Azure adds only on PTU.
const RETRY_AFTER_MS_HEADER = 'retry-after-ms'
const NETWORK_FAILURE_STATUS = 0

/** The documented error envelope, or the status text when the body is not one. */
async function describeFailure(
  response: Response,
  parseError: TransportDeps['parseError'],
  redact: (text: string) => string,
  now: number,
): Promise<ModelApiError> {
  let body: unknown
  let text = ''
  try {
    text = await readBoundedText(response)
    body = JSON.parse(text, (_key, value: unknown) =>
      typeof value === 'string' ? redact(value) : value,
    )
  } catch (error: unknown) {
    if (error instanceof ModelApiError && error.status === NETWORK_FAILURE_STATUS) throw error
    body = undefined
  }
  // Lane PROVERR: a refusal carries the provider's request id and wait, both
  // provider-chosen and never credentials.
  const attach = (failure: ModelApiError): ModelApiError => {
    const requestId = response.headers.get('request-id') ?? response.headers.get('x-request-id')
    if (requestId !== null && requestId.trim() !== '')
      failure.requestId = requestId.trim().slice(0, PROVIDER_REQUEST_ID_MAX_CHARS)
    failure.retryAfterMs = providerWaitMs(response.headers, now)
    return failure
  }
  if (parseError !== undefined) {
    try {
      return attach(
        redactModelApiError(
          parseError(response.status, body ?? text, response.headers),
          redact,
          response.status,
        ),
      )
    } catch (error: unknown) {
      return attach(redactModelApiError(error, redact, response.status))
    }
  }
  const parsed = errorBodySchema.safeParse(body)
  if (!parsed.success) {
    return attach(
      new ModelApiError(
        redact(`HTTP ${String(response.status)} ${response.statusText}`.trim()),
        response.status,
        undefined,
        undefined,
      ),
    )
  }
  const { error } = parsed.data
  return attach(
    new ModelApiError(
      redact(error.message),
      response.status,
      error.type == null ? undefined : redact(error.type),
      error.code == null ? undefined : redact(error.code),
    ),
  )
}

/**
`Retry-After` in milliseconds: a delay in seconds, or an HTTP date (RFC
9110 §10.2.3 allows both; PLAN.md D25), measured from `now`.
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

/**
The wait an answer names, in every form a provider uses: `retry-after-ms`
(milliseconds; Azure OpenAI, read before `Retry-After` per research
azure-openai.md ZB2), then `Retry-After` (seconds or an HTTP date).
Read whole here; the retry loop honours it whole, tells the person when it
ends, and the turn's Stop ends it at once.
*/
export function providerWaitMs(headers: Headers, now: number): number | undefined {
  const milliseconds = headers.get(RETRY_AFTER_MS_HEADER)
  if (milliseconds !== null && milliseconds.trim() !== '') {
    const value = Number(milliseconds)
    if (Number.isFinite(value) && value >= 0) return value
  }
  return retryAfterMs(headers.get(RETRY_AFTER_HEADER), now)
}

/** One transport's documented retry bounds: Meta's own when unset. */
function documentedLimits(deps: TransportDeps): RetryLimits {
  return deps.retryLimits ?? META_DOCUMENTED_RETRY_LIMITS
}

/**
What one retry tells the person: the plain `HTTP …` reason, or, for a
wait the provider named, that wait's sentence with when it ends in
absolute time and plain words. Pure — the request loop calls this per
retry — so the telling is provable with header values as plain input
and no provider answering.
*/
export function providerRetryReason(
  status: number,
  message: string,
  delayMs: number | undefined,
  now: number,
): string {
  const reason = `HTTP ${String(status)}: ${message}`
  if (delayMs === undefined) return reason
  return fill(UI_TEXT.modelApiProviderRetryWait, {
    reason,
    time: formatDateTime(now + delayMs),
  })
}

/**
Which requests join the pacing bucket. Meta governs only its inference
path with a model id; a configured provider's inference travels a native
path (never `/responses`) with the codec-supplied model id, so any of its
model-carrying requests joins the same bucket its rate-limit observations
feed. Count and list calls carry no model id and stay observation-only.
*/
export function isPacingGoverned(
  path: string,
  modelId: string | undefined,
  provider: string,
): boolean {
  return modelId !== undefined && (path === '/responses' || provider !== 'meta')
}

/** One retry the client is about to make, for the transcript's notice. */
export interface RetryNotice {
  readonly phase?: 'pacing'
  readonly attempt: number
  /**
  The retries allowed, absent when neither the provider nor the person
  sets one: the provider's own Retry-After (or stop answer) governs.
  */
  readonly maxAttempts: number | undefined
  readonly delayMs: number
  readonly reason: string
}

/**
The retries one model call has used (the review of PR #28): a stream sent
again whole and the HTTP retries inside each of its requests draw on the
same count. No ceiling of our own (owner 2026-10-16): a call that names
same per-provider budget (lane RETRYLIMITS).
*/
export interface RetryBudget {
  retriesUsed: number
  /** A ceiling this call names; absent, retries end at Stop, never at a count. */
  readonly maxRetries?: number
}

/** Whether `budget` still allows the retry numbered `attempt` (0-based). */
export function canRetryWithinBudget(budget: RetryBudget | undefined, attempt: number): boolean {
  return attempt < (budget?.maxRetries ?? Infinity)
}

/**
Loop bound when no retry limit applies: the largest count, so only the
provider's own stop answers end the loop. A budget starting here refuses
every retry (see `noRetryBudget`).
*/
export const UNBOUNDED_RETRIES = Number.MAX_SAFE_INTEGER

/**
A budget that refuses every retry before the first try: key checks and
other single-attempt paths spend it, so their loop bound is already met.
*/
export function noRetryBudget(): RetryBudget {
  return { retriesUsed: UNBOUNDED_RETRIES }
}

/** In-memory identity of an explicitly confirmed scheduled Model API run. */
export interface ConfirmedModelRequest {
  readonly paidRequest?: PaidUseRequest
  readonly modelId: string
  readonly keyDigest: string
  readonly providerId?: string | undefined
  readonly origin?: string | undefined
  /**
  Which confirmed run this identity belongs to. Stale-identity refusals
  keep the schedule guidance for scheduled prompts and name the hook call
  for model-hook runs.
  */
  readonly runKind?: 'scheduled' | 'review' | 'hookModel' | undefined
  /** The paid gate and session model must still match before every HTTP try. */
  readonly isStillAllowed: () => boolean
  /** Only after identity and gate checks, immediately before the first HTTP try. */
  readonly onRequestStarted: () => void
}

/**
A stale-identity refusal that names the confirmed run: scheduled prompts
keep the schedule guidance, model-hook runs name the hook call.
*/
export function staleConfirmedError(confirmed: ConfirmedModelRequest): Error {
  return new UserRefusalError(
    confirmed.runKind === 'hookModel'
      ? UI_TEXT.requestStaleHookModel
      : UI_TEXT.scheduleConfirmationExpired,
    'confirmation_stale',
  )
}

/**
Whether an error is a lapsed-confirmation refusal carrying the run's own
guidance. Branches whose catch maps failures to branch text (the plan
retry sentence, the adapter's failure text) let these through unchanged,
so a lapsed hook, schedule or review says what lapsed.
*/
export function isStaleConfirmedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === UI_TEXT.requestStaleHookModel ||
      error.message === UI_TEXT.scheduleConfirmationExpired)
  )
}

/**
The one confirmed-dispatch gate every provider branch runs: proceed while
the confirmation names this model and is still allowed, and refuse with
the run's own guidance otherwise. Branches that accept more than the bare
session model id (a catalogue id, a provider, an origin) check those
fields themselves and pass `isSameModel` for the model half, so a future
branch cannot miss a step by hand-copying the condition.
*/
export function assertConfirmedAllowed(
  requestModel: string,
  confirmed: ConfirmedModelRequest | undefined,
  isSameModel: (confirmedModelId: string, requestModel: string) => boolean = (left, right) =>
    left === right,
): void {
  if (
    confirmed !== undefined &&
    (!isSameModel(confirmed.modelId, requestModel) || !confirmed.isStillAllowed())
  ) {
    throw staleConfirmedError(confirmed)
  }
}

/**
Mark a confirmed dispatch started: the start receipt and the
scheduled-prompt use tally run exactly once, adjacent to the send, with
the admission observer right after. Call sites invoke this once per
dispatch, after the final gate re-check.
*/
export function noteConfirmedRequestStarted(
  confirmed: ConfirmedModelRequest | undefined,
  admitAttempt: Pick<ResponseAttemptGuard, 'onRequestStarted'> | undefined,
): void {
  confirmed?.onRequestStarted()
  admitAttempt?.onRequestStarted?.()
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
  /** After retry accounting/backoff, allow the owner to rebuild the next request. */
  readonly beforeRetry?: () => void
  /** Frozen Meta auth/pricing snapshot; never forwarded to another provider's auth. */
  readonly billingRoute?: BillingRoute | undefined
  /** Compare-only after admission: a fresh route may refuse, never replace auth. */
  readonly confirmBillingRoute?: (() => Promise<void>) | undefined
  /** The account lease's before-send fence (D88.7): runs adjacent to the send. */
  readonly beforeRequestStarted?: () => void
  readonly paidRequest?: PaidUseRequest
  readonly mediaAccounting?: MediaRequestAccounting
  readonly pacingClass?: PacingClass
  readonly searchQuote?: PaidQuote
  readonly onSearchesReturned?: (settlement: SearchSettlement) => void
  readonly prepareRetry?: (keyDigest: string, signal: AbortSignal) => Promise<void>
  /** Durable admission before the synchronous credential/gate fence. */
  readonly prepare?: () => Promise<void>
  readonly reservePaidRequest?: ModelApiClientDeps['reservePaidRequest']
  readonly paidFeature?: PaidFeature
  readonly paidEstimatedInputTokens?: number
  (keyDigest: string | undefined): void
  /** Pure request-policy fence after admission waits and last before dispatch; never reserves. */
  readonly check?: () => void
  /** After every final fence and request build, adjacent to the actual fetch call. */
  readonly onRequestStarted?: () => void
  readonly observe?: (observation: ResponseObservation) => void
  /**
  The provider refused this attempt before generating anything (a status
  in `NON_BILLABLE_HTTP_REJECTIONS`), told before the error is thrown, so a
  caller still knows nothing was billed when a wrapper rethrows the error
  without its status (D208).
  */
  readonly onRefused?: (status: number) => void
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

/** Rejects as soon as `signal` aborts, instead of sleeping the retry delay out. */
export function whenAborted(signal: AbortSignal): {
  readonly promise: Promise<never>
  dispose(): void
} {
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

/**
Production `TransportDeps.sleep` (lane PR225FIX2): a real timer cleared
the moment `signal` aborts, so a retry wait a Stop abandons leaves no
timer behind (deliberately still referenced while it runs: an unaborted
wait holds the process exactly as before, only an abandoned one is
gone). Resolves early on abort; the caller observes the abort itself
(`pause`'s race rejects with the turn's cancellation, registered before
this listener).
*/
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((done) => {
    if (signal?.aborted === true) {
      done()
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      done()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      done()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

const ownerPacers = new WeakMap<object, RequestPacer>()

export class RequestTransport {
  private static hasLoggedObservationFailure = false
  private readonly pacing: RequestPacer
  /** The chunk sleep, defaulting to the production one (see `TransportDeps.sleep`). */
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  public constructor(private readonly deps: TransportDeps) {
    this.sleep = deps.sleep ?? abortableSleep
    this.pacing =
      deps.pacing ??
      (deps.pacingOwner === undefined ? undefined : ownerPacers.get(deps.pacingOwner)) ??
      new ModelApiPacing({ now: deps.now, wait: (ms, signal) => this.pause(ms, signal) })
    if (deps.pacingOwner !== undefined) ownerPacers.set(deps.pacingOwner, this.pacing)
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
  private async headers(url: string, authKey?: string): Promise<AuthHeaders> {
    if (authKey === undefined && this.deps.auth !== undefined) {
      return await this.deps.auth.headers(url)
    }
    const key = authKey ?? (await this.deps.apiKey?.())
    if (key === undefined) {
      throw new MissingApiKeyError()
    }
    return {
      redact: (text) => redactSecrets(text, [key]),
      values: { Authorization: `Bearer ${key}`, 'Content-Type': JSON_MEDIA_TYPE },
      keyDigest: createHash('sha256').update(key).digest('hex'),
    }
  }

  /** One direct request on the configured endpoint and key: no retry, no redirect. */
  private async sendDirect(
    route: string,
    method: 'GET' | 'POST' | 'DELETE',
    // No deadline of our own (owner 2026-10-16): the caller's signal, if
    // any, ends it, else the provider's answer or a network failure.
    signal: AbortSignal | undefined,
    multipart:
      { readonly body: ReadableStream<Uint8Array>; readonly contentType: string } | undefined,
    expectedAccountId: string | undefined,
    beforeFetch?: () => void,
  ): Promise<{ readonly response: Response; readonly redact: (text: string) => string }> {
    const credentials = await this.headers(this.deps.baseUrl)
    signal?.throwIfAborted()
    if (expectedAccountId !== undefined && credentials.keyDigest !== expectedAccountId)
      throw new Error(UI_TEXT.media.filesReadOnly)
    const init: RequestInit & { readonly duplex?: 'half' } = {
      method,
      headers: {
        Authorization: credentials.values['Authorization'] ?? '',
        Accept: JSON_MEDIA_TYPE,
        ...(multipart !== undefined && { 'Content-Type': multipart.contentType }),
      },
      redirect: 'error',
      signal: signal ?? null,
      ...(multipart !== undefined && { body: multipart.body, duplex: 'half' }),
    }
    await this.deps.verifyEndpoint?.(`${this.deps.baseUrl}${route}`)
    signal?.throwIfAborted()
    // The caller's final admission, in the same tick as the fetch.
    beforeFetch?.()
    const response = await this.deps.fetch(`${this.deps.baseUrl}${route}`, init)
    return { response, redact: credentials.redact }
  }

  /**
  Headers and every body read, without timing local admission, backoff or
  consumers. A provider-named idle (`streamIdleMs`) still ends silence at
  it; unnamed, the fetch runs until it answers or Stop ends it, saying so
  out loud while waiting for the first bytes (owner 2026-10-16).
  */
  public async fetchWithIdleDeadline(url: string, init: RequestInit): Promise<Response> {
    const idleMs = this.deps.streamIdleMs
    // The named idle's sentence; unnamed waits never stall, so never say it.
    const stalled =
      idleMs === undefined
        ? undefined
        : fill(UI_TEXT.modelApiStalled, {
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
      // No deadline of our own unless the provider names one.
      if (idleMs === undefined) {
        try {
          return await Promise.race([waiting, aborted.promise])
        } finally {
          aborted.dispose()
        }
      }
      try {
        return await withDeadline(
          Promise.race([waiting, aborted.promise]),
          idleMs,
          stalled ?? 'cancelled',
        )
      } catch (error: unknown) {
        if (error instanceof DeadlineError) {
          stall.abort()
          throw new ModelApiError(
            stalled ?? 'cancelled',
            NETWORK_FAILURE_STATUS,
            undefined,
            undefined,
          )
        }
        throw error
      } finally {
        aborted.dispose()
      }
    }
    // The wait for the first bytes says so while it lasts.
    const stopNoticing = startStillWaiting((elapsedMs) => {
      this.deps.log.info(stillWaitingText({ key: 'providerAnswer' }, elapsedMs))
    }, this.deps.noticeMs)
    let response: Response
    try {
      response = await within(this.deps.fetch(url, { ...init, signal: active }))
    } finally {
      stopNoticing()
    }
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

  /** The retry delay, cut short by the turn's Stop. */
  /** Files share this client's configured endpoint and key; uploads are never retried ambiguously. */
  public async requestFile(
    route: string,
    method: 'GET' | 'POST' | 'DELETE',
    // No deadline of our own (owner 2026-10-16): the caller's signal, if
    // any, ends it, else the provider's answer or a network failure.
    signal: AbortSignal | undefined,
    multipart?: { readonly body: ReadableStream<Uint8Array>; readonly contentType: string },
    expectedAccountId?: string,
  ): Promise<Response> {
    if (!/^\/files(?:\?after=file-[A-Za-z0-9_-]+|\/file-[A-Za-z0-9_-]+)?$/u.test(route))
      throw new Error('Invalid Files route')
    const sent = await this.sendDirect(route, method, signal, multipart, expectedAccountId)
    if (!sent.response.ok)
      throw await describeFailure(sent.response, this.deps.parseError, sent.redact, this.deps.now())
    return sent.response
  }

  /**
  U18 / D85.5: the batch transcription POST, and nothing else. The route is
  the captured `/asr/transcribe?sessionId=<uuid>`; the body is the
  adapter's multipart. Unlike Files, a refusal is not thrown: the adapter
  reads the captured 400 body ("The 'audio' part must be…"). The body is
  read bounded and the key redacted before it is handed back. One attempt:
  a charged POST is never retried here. `dispatch` is the paid admission,
  run after the key and endpoint checks, immediately before the fetch.
  */
  public async requestTranscription(
    route: string,
    signal: AbortSignal,
    multipart: { readonly body: ReadableStream<Uint8Array>; readonly contentType: string },
    expectedAccountId: string | undefined,
    dispatch: () => void,
  ): Promise<Response> {
    if (!TRANSCRIPTION_ROUTE.test(route) || !multipart.contentType.startsWith(MULTIPART_PREFIX))
      throw new Error('Invalid transcription route')
    const sent = await this.sendDirect(
      route,
      'POST',
      signal,
      multipart,
      expectedAccountId,
      dispatch,
    )
    const text = sent.redact(await readBoundedText(sent.response))
    return new Response(text, {
      status: sent.response.status,
      statusText: sent.response.statusText,
      headers: { 'Content-Type': sent.response.headers.get('Content-Type') ?? JSON_MEDIA_TYPE },
    })
  }

  /**
  Waits `ms` whole, or rejects as soon as `signal` aborts. A timer holds
  at most `MODEL_API_TIMER_MAX_MS` and a longer delay fires after 1 ms, so
  a longer wait is slept in pieces no larger than that (PR #225): the
  provider is never asked again before the wait it named or the backoff
  it was given.
  */
  public async pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted === true) {
      throw new ModelApiError('cancelled', NETWORK_FAILURE_STATUS, undefined, undefined)
    }
    const aborted = signal === undefined ? undefined : whenAborted(signal)
    try {
      let remaining = ms
      do {
        const piece = Math.min(remaining, MODEL_API_TIMER_MAX_MS)
        // The stop reaches the chunk's own timer through the injected
        // sleep: a cooperating sleep clears it, so no timer outlives the
        // stop. The race stays, so a sleep that ignores the signal is
        // abandoned exactly as before and Stop stays prompt.
        const slept = this.sleep(piece, signal)
        await (aborted === undefined ? slept : Promise.race([slept, aborted.promise]))
        remaining -= piece
      } while (remaining > 0)
    } finally {
      aborted?.dispose()
    }
  }

  public async currentKeyDigest(): Promise<string> {
    const credentials = await this.headers(this.deps.baseUrl)
    return credentials.keyDigest
  }

  /**
  Headers and parsed-event progress have an idle deadline only when the
  provider names one (`idleMs`); unnamed, the stream runs until it
  finishes or Stop ends it, saying so out loud while silent (owner
  2026-10-16). Cancellation owns the reader.
  */
  public async streamRequest(
    path: string,
    init: {
      readonly billingRoute: AttemptBillingRoute
      readonly body: unknown
      readonly headers?: Readonly<Record<string, string>>
      readonly modelId?: string
      readonly pacingClass?: PacingClass
      readonly estimatedTokens?: number
      readonly accept: string
      readonly paid?: {
        readonly claim: SpendClaim
        readonly run?: UnattendedRun | undefined
        isSent: boolean
      }
    },
    signal: AbortSignal,
    onRetry?: (notice: RetryNotice) => void,
    budget?: RetryBudget,
    admitAttempt?: ResponseAttemptGuard,
    confirmed?: ConfirmedModelRequest,
    idleMs?: number,
  ): Promise<TransportStreamResponse> {
    const startedAt = this.deps.now()
    const stall = new AbortController()
    const combined = AbortSignal.any([signal, stall.signal])
    // The named idle's sentence; unnamed waits never stall, so never say it.
    const message =
      idleMs === undefined
        ? undefined
        : fill(UI_TEXT.modelApiStalled, {
            seconds: Math.round(idleMs / MILLISECONDS_PER_SECOND),
          })
    const result = await this.request(
      path,
      { method: 'POST', ...init },
      combined,
      onRetry,
      budget,
      admitAttempt,
      confirmed,
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
    // An unnamed wait says so while silent (owner 2026-10-16): each parsed
    // event restarts the notice, so only true silence is announced.
    let stopNoticing: (() => void) | undefined
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
      stopNoticing?.()
      stopNoticing = undefined
      if (isClosed) return
      if (idleMs === undefined) {
        stopNoticing = startStillWaiting((elapsedMs) => {
          this.deps.log.info(stillWaitingText({ key: 'modelReply' }, elapsedMs))
        }, this.deps.noticeMs)
      } else {
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
      stopNoticing?.()
      stopNoticing = undefined
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
            throw new ModelApiError(
              signal.aborted ? 'cancelled' : (message ?? 'cancelled'),
              0,
              undefined,
              undefined,
            )
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
              ? new ModelApiError(
                  // Unnamed waits never stall: anything else here is the
                  // consumer going away, which reads as cancelled.
                  signal.aborted ? 'cancelled' : (message ?? 'cancelled'),
                  0,
                  undefined,
                  undefined,
                )
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

  /**
  The retries one call may use (lane RETRYLIMITS): the person's
  `museSpark.modelApiMaxRetries` setting when set, else the provider's
  documented maximum, else undefined (unbounded: the provider's own
  Retry-After waits and stop answers govern the loop).
  */
  public maxRetries(): number | undefined {
    return effectiveMaxRetries(this.deps.personCap?.(), documentedLimits(this.deps))
  }

  /**
  The person's live retry limit, before any provider maximum caps it
  (lane PR225W1): the turn loop reads it to tell a person-set cap stop
  from a provider refusal on the orchestrator's feed.
  */
  public personCap(): number | undefined {
    return this.deps.personCap?.()
  }

  public backoffMs(attempt: number, suggestedMs?: number): number {
    // The provider's own wait is the least it asks for (every provider
    // documents it so): waited out whole, never shortened to our backoff.
    return retryDelayMs(
      attempt,
      documentedLimits(this.deps),
      suggestedMs,
      this.deps.random(),
      MODEL_API_RETRY_JITTER_MS,
    )
  }

  /**
  One request with the documented retry policy. The response is handed
  back unread on success; a non-2xx status becomes a `ModelApiError`.
  */
  public async request(
    path: string,
    init: {
      readonly billingRoute: AttemptBillingRoute
      readonly method: 'GET' | 'POST'
      readonly body?: unknown
      readonly modelId?: string
      readonly pacingClass?: PacingClass
      readonly estimatedTokens?: number
      readonly accept: string
      /**
      `rateLimitOnly` for a request that bills per call (M34, the review
      of PR #27): a 429 was refused before any work and is retried; a
      lost connection or a server error may have been done and billed,
      so it is not.
      */
      readonly headers?: Readonly<Record<string, string>>
      /**
      An explicit credential for this request (a paid image on the
      stored key while chat bills the subscription): exact redaction and
      the digest follow the override, never the default key.
      */
      readonly authKey?: string
      readonly retries?: 'all' | 'rateLimitOnly'
      readonly paid?: {
        readonly claim: SpendClaim
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
    const provider = this.deps.pacingProvider?.(init.modelId) ?? {
      identity: { provider: 'meta' },
      readLimits: metaPacingLimits,
    }
    const isGoverned = isPacingGoverned(path, init.modelId, provider.identity.provider)
    // Meta observes only its governed paths; a configured provider observes
    // every answer through its own header reader (undefined where the
    // provider sends no limit headers, so only a 429 pause applies).
    const shouldObserveLimits =
      isGoverned || path === '/responses/input_tokens' || provider.identity.provider !== 'meta'
    const isRateLimitOnly =
      init.retries === 'rateLimitOnly' ||
      init.paid !== undefined ||
      admitAttempt?.mediaAccounting !== undefined
    const url = `${this.deps.baseUrl}${path}`
    if (!path.startsWith('/') || new URL(url).origin !== new URL(this.deps.baseUrl).origin) {
      throw new ModelApiError(
        fill(UI_TEXT.webFetchNetwork, { detail: 'origin_mismatch' }),
        0,
        'origin_mismatch',
        undefined,
      )
    }
    const retry = async (
      attempt: number,
      delay: number,
      reason: string,
      refused: ModelApiError,
    ) => {
      if (budget !== undefined) {
        budget.retriesUsed = attempt + 1
      }
      this.observe(admitAttempt, { retries: attempt + 1 })
      const allowed = this.maxRetries()
      onRetry?.({
        attempt: attempt + 1,
        maxAttempts: allowed === undefined ? undefined : allowed + 1,
        delayMs: delay,
        reason,
      })
      await this.pause(delay, signal)
      admitAttempt?.beforeRetry?.()
      // Lane PR225W1: the person's limit is live — a change mid-wait (to 0
      // during a long Retry-After) refuses the dispatch the pre-wait check
      // accepted, instead of sending one request past the new ceiling.
      if (attempt >= (this.maxRetries() ?? UNBOUNDED_RETRIES)) throw refused
    }
    // How long the answer took, retries included, at trace level (M39).
    const startedAt = this.deps.now()
    for (let attempt = budget?.retriesUsed ?? 0; ; attempt += 1) {
      // Rebuild on every retry: rotation may change the vault while we wait.
      // Outside the transport retry catch: a scrub failure must never send.
      const scrubGeneration = this.deps.vaultScrub?.generation
      const wireBody =
        this.deps.vaultScrub === undefined || init.body === undefined
          ? undefined
          : await scrubSecrets(JSON.stringify(init.body), this.deps.vaultScrub)
      if (wireBody !== undefined && this.deps.vaultScrub !== undefined) {
        // Exact-value replacement must still leave valid JSON. No raw body
        // can be sent if an unusual value matched protocol syntax.
        JSON.parse(wireBody)
      }
      let credentials: Awaited<ReturnType<RequestTransport['headers']>>
      try {
        credentials = await this.headers(
          url,
          this.deps.auth === undefined
            ? (init.billingRoute.billing?.credential ?? init.authKey)
            : undefined,
        )
      } catch (error: unknown) {
        // Same test as isAborted(signal): a stop cancels the attempt.
        if (signal?.aborted) {
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
        attempt > 0 &&
        init.billingRoute.billing !== undefined &&
        init.authKey === undefined &&
        init.billingRoute.requiresCredentialCheck &&
        credentials.keyDigest !== (await this.currentKeyDigest())
      )
        throw new Error(
          confirmed === undefined
            ? UI_TEXT.subscriptionKey.billingChanged
            : UI_TEXT.scheduleConfirmationExpired,
        )
      admitAttempt?.check?.()
      await this.deps.verifyEndpoint?.(url)
      if (isAborted(signal)) {
        throw new ModelApiError('cancelled', NETWORK_FAILURE_STATUS, undefined, undefined)
      }
      admitAttempt?.check?.()
      if (
        confirmed !== undefined &&
        (credentials.keyDigest !== confirmed.keyDigest ||
          (confirmed.origin !== undefined && confirmed.origin !== new URL(url).origin) ||
          !confirmed.isStillAllowed())
      ) {
        // P3-2: a changed key is a rotation, not a changed mind; only a
        // moved origin or a withdrawn confirmation keeps the run's own guidance.
        assertConfirmedAllowed(init.modelId ?? '', confirmed)
        if (credentials.keyDigest !== confirmed.keyDigest)
          throw new UserRefusalError(UI_TEXT.execKeyRotated, 'key_rotated')
        throw staleConfirmedError(confirmed)
      }
      // A scheduled fire's authority is live: checked before pacing and again
      // after it, since revocation or a key change can land during the wait.
      const assertScheduleAuthority = () => {
        if (
          init.method !== 'POST' ||
          (path !== '/responses' && init.paid === undefined && !path.startsWith('/images/'))
        )
          return
        const run = this.deps.scheduledRun?.()
        if (
          (run !== init.paid?.run && (run !== undefined || init.paid?.run !== undefined)) ||
          (run !== undefined && (!run.isActive() || credentials.keyDigest !== run.paid?.accountId))
        )
          throw new UserRefusalError(UI_TEXT.paidDailyLedgerUnavailable, 'daily_ledger')
      }
      assertScheduleAuthority()
      const account = `${provider.identity.provider}:${this.deps.baseUrl}:${credentials.keyDigest}`
      const kind = init.pacingClass ?? 'foreground'
      if (isGoverned) {
        // No admission deadline of our own (owner 2026-10-16): the wait
        // ends at headroom, a 429 pause, or Stop, saying so while it lasts.
        await this.pacing.acquire(
          account,
          kind,
          init.estimatedTokens ?? 0,
          signal ?? new AbortController().signal,
          (delayMs) => {
            const allowed = this.maxRetries()
            onRetry?.({
              phase: 'pacing',
              attempt,
              maxAttempts: allowed === undefined ? undefined : allowed + 1,
              delayMs,
              reason: UI_TEXT.modelApiPacingWaiting,
            })
          },
        )
        admitAttempt?.check?.()
        if (kind !== 'foreground' && credentials.keyDigest !== (await this.currentKeyDigest()))
          throw new Error(UI_TEXT.notSignedInReason)
      }
      if (isAborted(signal))
        throw new ModelApiError('cancelled', NETWORK_FAILURE_STATUS, undefined, undefined)
      assertScheduleAuthority()
      // Local consent refusal is outside the transport retry catch: it never
      // becomes another billable attempt.
      await admitAttempt?.prepare?.()
      admitAttempt?.check?.()
      await admitAttempt?.confirmBillingRoute?.()
      if (init.paid !== undefined) {
        if (init.paid.isSent) {
          throw new UserRefusalError(UI_TEXT.sessionBudgetRetryUnavailable, 'retry_unbounded')
        }
        init.paid.claim.check()
      }
      if (
        admitAttempt?.searchQuote !== undefined &&
        this.deps.paidAuthority !== undefined &&
        !this.deps.paidAuthority.canSpend(admitAttempt.searchQuote)
      )
        throw new UserRefusalError(UI_TEXT.sessionBudgetSearchUnavailable, 'search_unbounded')
      admitAttempt?.mediaAccounting?.check()
      if (this.deps.isCredentialCurrent?.() === false) throw new MissingApiKeyError()
      admitAttempt?.(credentials.keyDigest)
      if (isAborted(signal)) {
        throw new ModelApiError('cancelled', NETWORK_FAILURE_STATUS, undefined, undefined)
      }
      if (confirmed !== undefined && !confirmed.isStillAllowed()) {
        throw staleConfirmedError(confirmed)
      }
      if (
        wireBody !== undefined &&
        scrubGeneration !== undefined &&
        this.deps.vaultScrub?.generation !== scrubGeneration
      ) {
        // The vault rotated during admission: the scrubbed body is
        // older than the values, so rebuild it instead of sending. A Lock in
        // the same window fails the rebuild, which never sends either.
        continue
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
        ...(init.body !== undefined && { body: wireBody ?? JSON.stringify(init.body) }),
        ...(signal !== undefined && { signal }),
      }
      const dispatchState = { isStarted: false }
      const dispatch = () => {
        admitAttempt?.check?.()
        assertScheduleAuthority()
        // The account lease's before-send fence (D88.7) runs adjacent to the
        // send with the admission observer, exactly as before the consolidation.
        admitAttempt?.beforeRequestStarted?.()
        noteConfirmedRequestStarted(confirmed, admitAttempt)
        if (init.paid !== undefined) {
          init.paid.isSent = true
        }
        admitAttempt?.mediaAccounting?.started()
        dispatchState.isStarted = true
        return this.fetchWithIdleDeadline(url, requestInit)
      }
      const sent = this.pacing.snapshot(account)
      let response: Response
      try {
        const run = this.deps.scheduledRun?.()
        response = await (run === undefined ? dispatch() : run.dispatch(dispatch))
      } catch (error: unknown) {
        // A scheduled run that refused before dispatch never started: its
        // error passes on raw, before any send-failure handling.
        if (!dispatchState.isStarted) throw error
        if (
          error instanceof Error &&
          error.name === 'UserRefusalError' &&
          'code' in error &&
          error.code === 'not_sent'
        ) {
          if (init.paid !== undefined) {
            init.paid.isSent = false
          }
          admitAttempt?.mediaAccounting?.refused()
          throw error
        }
        // P2-3/D1: a dispatch-time paid stop (a daily limit's check runs
        // inside the pinned fetch) is never a send failure: no log line, no
        // retry, and never a network-failure replacement. The classifier
        // rides the lazy provider bundle, keeping this bundle on its pin.
        const { isUserRefusal } = await import('../../refusal')
        if (isUserRefusal(error) && !isModelApiError(error)) throw error
        if (isModelApiError(error) || signal?.aborted === true) {
          throw isModelApiError(error)
            ? redactModelApiError(error, credentials.redact, NETWORK_FAILURE_STATUS)
            : new ModelApiError(
                credentials.redact(error instanceof Error ? error.message : String(error)),
                NETWORK_FAILURE_STATUS,
                undefined,
                undefined,
              )
        }
        // A refusal the product raised inside the send (an endpoint pin, a
        // budget or ledger stop) is no connection failure: it passes on with
        // its own message and type and is never retried (lane PROVERRORS).
        if (!isConnectionFailure(error)) throw error
        // No answer came: its causes say why, and the message names the
        // setting or store to check (M56, PLAN.md D43), or the provider and
        // the unknown fate of the send (lane PROVERRORS). A transient send
        // failure is retried below, as Anthropic documents its SDK doing
        // ("automatically retries transient failures (such as connection
        // errors …) with exponential backoff", platform.claude.com/docs/en/
        // api/errors, read 2026-10-17); the retry notice marks the attempt
        // ambiguous, since the send may have arrived.
        const reason = credentials.redact(
          this.deps.sendFailure?.(error) ?? networkFailureMessage(error, this.deps.networkAdvice),
        )
        // Lane PR225FIX2: an unanswered send is ambiguous — the request may
        // have arrived and executed — so it is sent again only within an
        // explicit bound (the person's setting or the provider's documented
        // maximum). With neither, the failure ends the request here instead
        // of replaying a possibly-executed paid send without end.
        const allowed = this.maxRetries()
        const refused = new ModelApiError(reason, NETWORK_FAILURE_STATUS, undefined, undefined)
        if (
          isRateLimitOnly ||
          allowed === undefined ||
          attempt >= allowed ||
          !canRetryWithinBudget(budget, attempt)
        ) {
          throw refused
        }
        const delay = this.backoffMs(attempt, undefined)
        this.deps.log.warn(
          `Model API request failed to send (${credentials.redact(describeNetworkFailure(error).detail)}); retrying in ${String(delay)} ms`,
        )
        await retry(attempt, delay, reason, refused)
        continue
      }
      if (shouldObserveLimits)
        this.pacing.observe(
          account,
          provider.readLimits?.(response.headers),
          response.status === HTTP_TOO_MANY_REQUESTS
            ? (providerWaitMs(response.headers, this.deps.now()) ??
                Math.min(MODEL_API_RETRY_BASE_MS * 2 ** attempt, MODEL_API_RETRY_MAX_MS))
            : undefined,
          sent,
        )
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
          redactContent: secretRedactor(secrets, false),
        }
      }
      const failure = await describeFailure(
        response,
        this.deps.parseError,
        credentials.redact,
        this.deps.now(),
      )
      if (NON_BILLABLE_HTTP_REJECTIONS.has(response.status)) {
        admitAttempt?.mediaAccounting?.refused()
        admitAttempt?.onRefused?.(response.status)
      }
      if (init.paid !== undefined && NON_BILLABLE_HTTP_REJECTIONS.has(response.status)) {
        init.paid.isSent = false
      }
      // The wait the provider named, in whichever form it used, is waited
      // out whole before the next try (lane PROVERRORS).
      const waitMs = failure.retryAfterMs
      // OPENAI-G20: the preset's own retry table decides, so its override
      // (e.g. OpenAI's documented retryable `server_error`) is read, not
      // skipped. The envelope kind/code the parsers carry is what lets a
      // quota 429 refuse while a bare one retries.
      const decision = classifyRetry(this.deps.retryTable ?? RETRY_TABLES.responses, {
        status: response.status,
        kind: failure.kind,
        code: failure.code,
        message: failure.message,
      })
      const isRetryable =
        (this.deps.isRetryableFailure?.(failure) ?? decision.retry) &&
        (!isRateLimitOnly || response.status === HTTP_TOO_MANY_REQUESTS)
      if (
        !isRetryable ||
        !canRetryWithinBudget(budget, attempt) ||
        attempt >= (this.maxRetries() ?? UNBOUNDED_RETRIES)
      ) {
        if (
          response.status >= HTTP_STATUS.internalServerError &&
          provider.identity.provider === 'meta'
        )
          notify(
            [() => this.deps.onServiceFailure?.(response.status, `${MODEL_API_BASE_URL}/status`)],
            undefined,
            this.deps.log,
            'modelApi.serviceFailure',
          )
        throw failure
      }
      const delay = this.backoffMs(attempt, waitMs)
      // The provider's words can carry a masked-key remnant or an account
      // id (PLAN.md D118): the log file keeps the scrubbed form only.
      this.deps.log.warn(
        `Model API answered ${String(response.status)} (${scrubRefusalLeak(failure.message)}); retrying in ${String(delay)} ms`,
      )
      // A wait the provider named is told at once with when it ends, in
      // absolute time and plain words, so a long provider wait never stalls
      // silently; the pause after it stays Stop-abortable. The `HTTP …`
      // prefix stays first, as the rate-limited retry readers match on it.
      const reason = providerRetryReason(
        response.status,
        failure.message,
        waitMs === undefined ? undefined : delay,
        this.deps.now(),
      )
      if (
        response.status === PROVIDER_RETRY_HTTP_STATUS.gatewayTimeout &&
        admitAttempt?.prepareRetry !== undefined
      )
        await admitAttempt.prepareRetry(
          credentials.keyDigest,
          signal ?? new AbortController().signal,
        )
      await retry(attempt, delay, reason, failure)
    }
  }
}
