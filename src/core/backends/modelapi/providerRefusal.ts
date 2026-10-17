// Lane PROVERR round 2: one typed value for "the provider answered and refused".
//
// Every wire format's error parser funnels through `parseRefusalError`: the
// provider's HTTP status, a closed kind, the provider's own message (bounded,
// already through the credential scrub before it reaches a parser), the
// provider's request id when it sends one, and `retryAfterMs` when it sends
// one (both attached by the transport, which owns the headers). No parser
// returns a product sentence in its place, and there is no `default:` branch
// left that can invent one: an unknown format cannot reach this point, and an
// unparsable body carries `parsed: false` with the status and the first
// bounded line of the body, classified by that status like any other answer.
import {
  HTTP_STATUS,
  MILLISECONDS_PER_SECOND,
  PROVIDER_REFUSAL_MESSAGE_MAX_CHARS,
  PROVIDER_RETRY_HTTP_STATUS,
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { classifyRetry, RETRY_TABLES, type RetryTables } from '../../../shared/retryPolicy'

/**
 * What a refusal-carrying `ModelApiError` holds: the provider's status and
 * bounded words with its envelope type/code. Structural on purpose, so this
 * module never imports the transport (which would cycle).
 */
export interface RefusalCarrier {
  readonly status: number
  readonly kind: string | undefined
  readonly code: string | undefined
  readonly message: string
  readonly requestId?: string | undefined
  readonly retryAfterMs?: number | undefined
  /** A documented reason or error code the extractor found (Google's
   * `details[].reason`, Anthropic's `details.error_code`): the classifier
   * reads it even when a parser did not promote it into `code`. */
  readonly reason?: string | undefined
  readonly errorCode?: string | undefined
}

/** The closed kinds of provider refusal. */
export type ProviderRefusalKind =
  | 'credit'
  | 'authentication'
  | 'permission'
  | 'notFound'
  | 'contentFilter'
  | 'rateLimited'
  | 'overloaded'
  | 'invalidRequest'
  | 'tooLarge'
  | 'serverError'
  | 'streamError'
  | 'unrecognised'

/** "The provider answered and refused": status, closed kind, the provider's
 * own bounded words, and the request id / retry wait when the provider sent
 * one. `refusalOf` builds it from the `ModelApiError` every parser returns.
 */
export interface ProviderRefusal {
  readonly status: number
  readonly kind: ProviderRefusalKind
  readonly providerMessage: string
  readonly requestId?: string | undefined
  readonly retryAfterMs?: number | undefined
}

export interface RefusalSignals {
  readonly status: number
  readonly type?: string | undefined
  readonly code?: string | number | undefined
  /** Google's `error.details[].reason` (e.g. `API_KEY_INVALID`). */
  readonly reason?: string | undefined
  /** Anthropic's `error.details.error_code` (e.g. `enforced_spend_limit_reached`). */
  readonly errorCode?: string | undefined
  readonly message?: string | undefined
}

// OpenAI's documented 429 codes (read 2026-10-13,
// https://developers.openai.com/api/docs/guides/error-codes): billing, spend
// and quota errors, which "won't restore API access" on retry.
const QUOTA_KINDS = new Set([
  'insufficient_quota',
  'quota_exceeded',
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
  'enforced_spend_limit_reached',
])
const AUTH_KINDS = new Set([
  'authentication_error',
  'invalid_api_key',
  'api_key_invalid',
  'incorrect_api_key',
  'invalid_key',
  'unauthorized',
  'unauthenticated',
])
const PERMISSION_KINDS = new Set(['permission_error', 'permission_denied', 'forbidden'])
// Provider-recorded not-found codes beside the documented ones. Sources:
// - 'not-found': recorded xAI unknown-model answer, 2026-10-12.
// - 'model_not_available': recorded Together unknown-model answer, 2026-10-12.
// - 'invalid_model' / '1500': recorded Mistral unknown-model answer, 2026-10-12.
// - '1211': recorded Z.ai unknown-model answer, 2026-10-12.
const NOT_FOUND_KINDS = new Set([
  'not_found_error',
  'model_not_found',
  'model_not_available',
  'not_found',
  'not-found',
  'invalid_model',
  '1500',
  '1211',
])
// Azure's documented prompt-filter code (read 2026-10-13,
// https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/content-filter);
// the chat codec already carries it from `finish_reason: "content_filter"`.
const CONTENT_FILTER_CODES = new Set(['content_filter'])
const OVERLOAD_KINDS = new Set(['overloaded_error', 'overloaded', 'server_overloaded'])
const RATE_KINDS = new Set(['rate_limit_error', 'rate_limit_exceeded', 'rate_limited'])
const TOO_LARGE_KINDS = new Set(['request_too_large', 'too_large', 'payload_too_large'])
const INVALID_KINDS = new Set([
  'invalid_request_error',
  'invalid_request',
  'bad_request',
  'validation_error',
])

/**
 * The only phrases the classifier reads, each scoped to the status where a
 * recorded answer shows its provider gives nothing else. A phrase is never a
 * substitute for a type, code or reason the provider documents. Sources:
 * - xAI's bad key (400, flat envelope, no type): recorded
 *   `test/fixtures/provider-refusals/xai/bad-key.json`, 2026-10-12.
 * - Anthropic's out-of-credit answer (400, generic type): measured in round 1
 *   (the `CREDIT_BODY` bytes the lead's drill replays).
 * - OpenRouter's unknown model (400, numeric echo code only): recorded
 *   `test/fixtures/provider-refusals/openrouter/unknown-model.json`, 2026-10-12.
 * - DeepSeek's unknown model (400, generic type and code): recorded
 *   `test/fixtures/provider-refusals/deepseek/unknown-model.json`, 2026-10-12.
 */
const RECORDED_PHRASES: readonly {
  readonly status: number
  readonly phrase: RegExp
  readonly kind: ProviderRefusalKind
}[] = [
  { status: 400, phrase: /incorrect api key provided/i, kind: 'authentication' },
  { status: 400, phrase: /credit balance is too low/i, kind: 'credit' },
  { status: 400, phrase: /is not a valid model id/i, kind: 'notFound' },
  { status: 400, phrase: /supported api model names are/i, kind: 'notFound' },
]
const OVERLOAD_MESSAGE = /overload/i

const norm = (value: string | number | undefined): string =>
  typeof value === 'number' ? String(value) : (value ?? '').toLowerCase()

const phraseKind = (status: number, message: string): ProviderRefusalKind | undefined => {
  for (const row of RECORDED_PHRASES) {
    if (row.status === status && row.phrase.test(message)) return row.kind
  }
  return undefined
}

/** The closed kind for an answered refusal. The status and the provider's
 * documented type, code or reason decide; a phrase from `RECORDED_PHRASES`
 * only covers the statuses where a recorded answer shows the provider gives
 * nothing else. Explicit money/identity signals win over the status: a 400
 * about credit is `credit`, not `invalidRequest`.
 */
export function classifyRefusalKind(signals: RefusalSignals): ProviderRefusalKind {
  const { status } = signals
  const type = norm(signals.type)
  const code = norm(signals.code)
  const reason = norm(signals.reason)
  const errorCode = norm(signals.errorCode)
  const message = signals.message ?? ''
  if (
    status === PROVIDER_RETRY_HTTP_STATUS.paymentRequired ||
    QUOTA_KINDS.has(type) ||
    QUOTA_KINDS.has(code) ||
    QUOTA_KINDS.has(reason) ||
    QUOTA_KINDS.has(errorCode) ||
    phraseKind(status, message) === 'credit'
  )
    return 'credit'
  if (
    status === HTTP_STATUS.unauthorized ||
    AUTH_KINDS.has(type) ||
    AUTH_KINDS.has(code) ||
    AUTH_KINDS.has(reason) ||
    phraseKind(status, message) === 'authentication'
  )
    return 'authentication'
  if (
    status === HTTP_STATUS.forbidden ||
    PERMISSION_KINDS.has(type) ||
    PERMISSION_KINDS.has(code) ||
    PERMISSION_KINDS.has(reason)
  )
    return 'permission'
  if (
    status === HTTP_STATUS.notFound ||
    NOT_FOUND_KINDS.has(type) ||
    NOT_FOUND_KINDS.has(code) ||
    phraseKind(status, message) === 'notFound'
  )
    return 'notFound'
  if (CONTENT_FILTER_CODES.has(code)) return 'contentFilter'
  if (
    status === PROVIDER_RETRY_HTTP_STATUS.overloaded ||
    OVERLOAD_KINDS.has(type) ||
    OVERLOAD_KINDS.has(code)
  )
    return 'overloaded'
  if (OVERLOAD_MESSAGE.test(message) && (status === 0 || status >= HTTP_STATUS.internalServerError))
    return 'overloaded'
  if (
    status === PROVIDER_RETRY_HTTP_STATUS.tooManyRequests ||
    RATE_KINDS.has(type) ||
    RATE_KINDS.has(code)
  )
    return 'rateLimited'
  if (
    status === HTTP_STATUS.requestTooLarge ||
    TOO_LARGE_KINDS.has(type) ||
    TOO_LARGE_KINDS.has(code)
  )
    return 'tooLarge'
  if (
    status === HTTP_STATUS.badRequest ||
    status === HTTP_STATUS.unprocessable ||
    INVALID_KINDS.has(type) ||
    INVALID_KINDS.has(code)
  )
    return 'invalidRequest'
  return status >= HTTP_STATUS.internalServerError ? 'serverError' : 'unrecognised'
}

/**
 * TEMPORARY (round 2, finding 4): whether an answered refusal is known to
 * have cost nothing. The spend-ledger branch (`fix/spend-ledger`) owns this
 * fact: its design note A already decides "an initial HTTP rejection before
 * any response/output is a known zero-cost outcome for
 * validation/authentication/authorization/quota refusals (4xx except 408 and
 * 499)". That branch has the decision but no code predicate yet (measured
 * 2026-10-13: no `isDefiniteRefusal` in its tree), so this predicate stays
 * until the ledger takes over these four `ModelApiHost.ts` call sites:
 * `noteRequestRefusal` (:4193), the `paidModelObservers` `isRefused`
 * (:6833), the auto-review observers' `isRefused` (:6953), and the image
 * generation catch (:8088). The ledger must receive the typed refusal
 * (status, kind, whether any output had begun) instead of this boolean.
 */
const DEFINITE_NOTHING_BILLED: ReadonlySet<number> = new Set([
  HTTP_STATUS.badRequest,
  HTTP_STATUS.unauthorized,
  PROVIDER_RETRY_HTTP_STATUS.paymentRequired,
  HTTP_STATUS.forbidden,
  HTTP_STATUS.notFound,
  HTTP_STATUS.requestTooLarge,
  HTTP_STATUS.unprocessable,
  PROVIDER_RETRY_HTTP_STATUS.tooManyRequests,
])

export function isDefiniteRefusal(status: number): boolean {
  return DEFINITE_NOTHING_BILLED.has(status)
}

/** Refusals that are never retried: asking again cannot help. */
const NEVER_RETRY: ReadonlySet<ProviderRefusalKind> = new Set([
  'credit',
  'authentication',
  'permission',
  'notFound',
  'contentFilter',
  'invalidRequest',
  'tooLarge',
])

export function isNeverRetryRefusal(status: number, kind: ProviderRefusalKind): boolean {
  return (
    status >= HTTP_STATUS.badRequest &&
    status < HTTP_STATUS.internalServerError &&
    NEVER_RETRY.has(kind)
  )
}

/**
 * Whether a refused provider answer is worth one more try: never for the
 * kinds asking again cannot help, otherwise the retry table that exists.
 * Wired as the codec client's `isRetryableFailure`, so the transport's own
 * decision stands everywhere else unchanged. `table` is the preset's own
 * retry table (OPENAI-G20); it defaults to the Responses table.
 */
export function isRefusalRetryable(
  failure: RefusalCarrier,
  table: RetryTables = RETRY_TABLES.responses,
): boolean {
  const kind = classifyRefusalKind({
    status: failure.status,
    type: failure.kind,
    code: failure.code,
    reason: failure.reason,
    errorCode: failure.errorCode,
    message: failure.message,
  })
  if (isNeverRetryRefusal(failure.status, kind)) return false
  // The message is not passed on: `classifyRetry` treats the bare word
  // "quota" in prose as a spent-quota veto, but a provider's per-minute
  // limit can say "quota" for a limit that resets (round 2, finding 3).
  // Credit here is decided above, from the documented type/code/reason and
  // the recorded phrases only, so prose must not veto a retry afterwards.
  return classifyRetry(table, {
    status: failure.status,
    kind: failure.kind,
    code: failure.code,
    message: '',
  }).retry
}

/** The typed view of a refusal-carrying `ModelApiError`. A `streamError`
 * keeps its kind: the provider ended its answer with an error, and only that
 * context says so. Anything else classifies from status, type, code, reason
 * and the provider's words; `parsed: false` ("the body could not be read")
 * travels beside the kind, never as one.
 */
export function refusalOf(error: RefusalCarrier & { readonly parsed?: boolean }): ProviderRefusal {
  const kind =
    error.kind === 'streamError'
      ? 'streamError'
      : classifyRefusalKind({
          status: error.status,
          type: error.kind,
          code: error.code,
          reason: error.reason,
          errorCode: error.errorCode,
          message: error.message,
        })
  return {
    status: error.status,
    kind,
    providerMessage: error.message,
    ...(error.requestId !== undefined && { requestId: error.requestId }),
    ...(error.retryAfterMs !== undefined && { retryAfterMs: error.retryAfterMs }),
  }
}

/** Bound the provider's own words; an over-long answer cannot flood the transcript. */
export function boundProviderMessage(message: string): string {
  const clean = message.replaceAll(/\s+/g, ' ').trim()
  return clean.length > PROVIDER_REFUSAL_MESSAGE_MAX_CHARS
    ? `${clean.slice(0, PROVIDER_REFUSAL_MESSAGE_MAX_CHARS)}…`
    : clean
}

/** The first bounded line of an unparsable answer, for an unread body. */
export function firstBodyLine(body: unknown): string {
  if (body === undefined || body === null) return ''
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return boundProviderMessage(text.split('\n', 1)[0] ?? '')
}

export interface RefusalEnvelope {
  readonly message: string
  readonly type?: string | undefined
  readonly code?: string | number | undefined
  readonly reason?: string | undefined
  readonly errorCode?: string | undefined
}

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  // The three checks rule out every non-record JSON shape, but the compiler
  // cannot narrow `unknown` to a record from them (PLAN.md §8).
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

const codeOf = (value: unknown): string | number | undefined =>
  typeof value === 'string' || typeof value === 'number' ? value : undefined

const googleReasonOf = (error: Record<string, unknown>): string | undefined => {
  const details = error['details']
  if (!Array.isArray(details)) return undefined
  for (const entry of details) {
    const reason = recordOf(entry)?.['reason']
    if (typeof reason === 'string' && reason !== '') return reason
  }
  return undefined
}

const anthropicErrorCodeOf = (error: Record<string, unknown>): string | undefined => {
  const code = recordOf(error['details'])?.['error_code']
  return typeof code === 'string' && code !== '' ? code : undefined
}

/**
 * One extractor that reads an error body by what it IS, used by every wire
 * format and never chosen by a vendor's name (round 2, finding 2):
 * an `error` object with a message; an `error` string (xAI's flat envelope,
 * Ollama); a top-level `message` with `type` and `code` beside it (Mistral's
 * unknown-model answer); a `detail` string (Mistral's bad-key answer);
 * Google's `status` and `details[].reason` ride along when present. A shape
 * none of them matches is `undefined`: unrecognised, with the status and the
 * first bounded line.
 */
export function extractRefusalEnvelope(body: unknown): RefusalEnvelope | undefined {
  const root = recordOf(body)
  if (root !== undefined) {
    const error = root['error']
    const nested = recordOf(error)
    if (nested !== undefined) {
      const message = textOf(nested['message'])
      if (message !== undefined) {
        const type = typeof nested['type'] === 'string' ? nested['type'] : undefined
        const status = typeof nested['status'] === 'string' ? nested['status'] : undefined
        return {
          message,
          ...(type !== undefined && { type }),
          ...(type === undefined && status !== undefined && { type: status }),
          ...(codeOf(nested['code']) !== undefined && { code: codeOf(nested['code']) }),
          ...(googleReasonOf(nested) !== undefined && { reason: googleReasonOf(nested) }),
          ...(anthropicErrorCodeOf(nested) !== undefined && {
            errorCode: anthropicErrorCodeOf(nested),
          }),
        }
      }
    }
    if (typeof error === 'string' && error !== '') {
      const envelope: RefusalEnvelope = { message: error }
      const code = codeOf(root['code'])
      return code === undefined ? envelope : { ...envelope, code }
    }
    const message = textOf(root['message'])
    if (message !== undefined) {
      const type = root['type']
      return {
        message,
        ...(typeof type === 'string' && { type }),
        ...(codeOf(root['code']) !== undefined && { code: codeOf(root['code']) }),
      }
    }
    const detail = textOf(root['detail'])
    if (detail !== undefined) return { message: detail }
  }
  return undefined
}

/**
 * Every wire format's HTTP error through one function: the provider's status
 * and bounded words with its envelope type/code/reason. An unknown shape
 * carries `parsed: false` with the status and the first bounded line of the
 * body, and classifies by that status like any other answer. Never a product
 * sentence. Each format's parser wraps the result in its own `ModelApiError`.
 */
export function parseRefusalError(
  status: number,
  body: unknown,
): Pick<RefusalCarrier, 'message' | 'kind' | 'code'> & {
  readonly kind: string | undefined
  readonly reason?: string | undefined
  readonly errorCode?: string | undefined
  readonly parsed: boolean
} {
  const envelope = extractRefusalEnvelope(body)
  if (envelope === undefined) {
    const first = firstBodyLine(body)
    return {
      message: first === '' ? `HTTP ${String(status)}` : `HTTP ${String(status)}: ${first}`,
      kind: undefined,
      code: undefined,
      parsed: false,
    }
  }
  return {
    message: boundProviderMessage(envelope.message),
    kind: envelope.type,
    code: envelope.code === undefined ? undefined : String(envelope.code),
    ...(envelope.reason !== undefined && { reason: envelope.reason }),
    ...(envelope.errorCode !== undefined && { errorCode: envelope.errorCode }),
    parsed: true,
  }
}

/**
 * A provider's sentence with the pieces that identify the person's account
 * removed (round 2, finding 5): a masked-key remnant (OpenAI repeats the
 * key's first 8 and last 4 characters, DeepSeek its last 4), a team id (xAI
 * names it) or a user id (OpenRouter sends one). Request ids are provider
 * support's handle and are kept. The person still reads their own provider's
 * full sentence on screen; the stored form (report bundles, and any later
 * sink beyond the screen) carries this instead.
 */
export function scrubRefusalLeak(text: string): string {
  return text
    .replaceAll(/[^\s]*\*{2,}[^\s]*/g, '[key]')
    .replaceAll(/\bteam\s+[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi, 'team [account]')
    .replaceAll(/\buser_id["']?\s*[:=]\s*["']?[A-Za-z0-9_-]+/g, 'user_id [account]')
}

/** One sentence built from the kind: the provider named, what to do, then
 * the provider's own words as theirs. Read when it runs, so the installed
 * language is the one shown.
 */
export function refusalSentence(refusal: ProviderRefusal, provider: string): string {
  const detail = refusal.providerMessage
  const wait =
    refusal.retryAfterMs === undefined || refusal.retryAfterMs <= 0
      ? ''
      : fill(UI_TEXT.providerRefusalWait, {
          seconds: String(Math.ceil(refusal.retryAfterMs / MILLISECONDS_PER_SECOND)),
        })
  switch (refusal.kind) {
    case 'credit': {
      return fill(UI_TEXT.providerRefusalCredit, { provider, detail })
    }
    case 'authentication': {
      return fill(UI_TEXT.providerRefusalAuthentication, { provider, detail })
    }
    case 'permission': {
      return fill(UI_TEXT.providerRefusalPermission, { provider, detail })
    }
    case 'notFound': {
      return fill(UI_TEXT.providerRefusalNotFound, { provider, detail })
    }
    case 'contentFilter': {
      return fill(UI_TEXT.providerRefusalContentFilter, { provider, detail })
    }
    case 'rateLimited': {
      return fill(UI_TEXT.providerRefusalRateLimited, { provider, detail, wait })
    }
    case 'overloaded': {
      return fill(UI_TEXT.providerRefusalOverloaded, { provider, detail, wait })
    }
    case 'invalidRequest': {
      return fill(UI_TEXT.providerRefusalInvalidRequest, { provider, detail })
    }
    case 'tooLarge': {
      return fill(UI_TEXT.providerRefusalTooLarge, { provider, detail })
    }
    case 'serverError': {
      return fill(UI_TEXT.providerRefusalServerError, { provider, detail })
    }
    case 'streamError': {
      return fill(UI_TEXT.providerRefusalStreamError, { provider, detail })
    }
    case 'unrecognised': {
      return fill(UI_TEXT.providerRefusalUnrecognised, {
        provider,
        detail,
        status: String(refusal.status),
      })
    }
  }
}
