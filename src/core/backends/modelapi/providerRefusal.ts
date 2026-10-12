// Lane PROVERR: one typed value for "the provider answered and refused".
//
// Every wire format's error parser funnels through `parseRefusalError`: the
// provider's HTTP status, a closed kind, the provider's own message (bounded,
// already through the credential scrub before it reaches a parser), the
// provider's request id when it sends one, and `retryAfterMs` when it sends
// one (both attached by the transport, which owns the headers). No parser
// returns a product sentence in its place, and there is no `default:` branch
// left that can invent one: an unknown format cannot reach this point, and an
// unparsable body is `unrecognised` with the status and the first bounded
// line of the body.
import {
  HTTP_STATUS,
  MILLISECONDS_PER_SECOND,
  PROVIDER_REFUSAL_MESSAGE_MAX_CHARS,
  PROVIDER_RETRY_HTTP_STATUS,
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { classifyRetry, RETRY_TABLES } from '../../../shared/retryPolicy'

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
}

/** The closed kinds of provider refusal. */
export type ProviderRefusalKind =
  | 'credit'
  | 'authentication'
  | 'permission'
  | 'notFound'
  | 'rateLimited'
  | 'overloaded'
  | 'invalidRequest'
  | 'tooLarge'
  | 'serverError'
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
  readonly message?: string | undefined
}

const QUOTA_KINDS = new Set([
  'insufficient_quota',
  'quota_exceeded',
  'enforced_spend_limit_reached',
])
const AUTH_KINDS = new Set([
  'authentication_error',
  'invalid_api_key',
  'incorrect_api_key',
  'invalid_key',
  'unauthorized',
  'unauthenticated',
])
const PERMISSION_KINDS = new Set(['permission_error', 'permission_denied', 'forbidden'])
const NOT_FOUND_KINDS = new Set(['not_found_error', 'model_not_found', 'not_found'])
const OVERLOAD_KINDS = new Set(['overloaded_error', 'overloaded', 'server_overloaded'])
const RATE_KINDS = new Set(['rate_limit_error', 'rate_limit_exceeded', 'rate_limited'])
const TOO_LARGE_KINDS = new Set(['request_too_large', 'too_large', 'payload_too_large'])
const INVALID_KINDS = new Set([
  'invalid_request_error',
  'invalid_request',
  'bad_request',
  'validation_error',
])

const CREDIT_MESSAGE =
  /credit|billing|balance|payment|purchase|quota|spend limit|out of funds|insufficient funds/i
const AUTH_MESSAGE =
  /invalid api key|incorrect api key|api key.*invalid|api key.*missing|unauthorized|unauthenticated|authentication|api key required|must provide/i
const PERMISSION_MESSAGE = /permission|forbidden|not allowed|access denied/i
const NOT_FOUND_MESSAGE = /not[ _]found|no such model|unknown model|does not exist/i
const OVERLOAD_MESSAGE = /overload/i

const norm = (value: string | number | undefined): string =>
  typeof value === 'number' ? String(value) : (value ?? '').toLowerCase()

/** The closed kind for an answered refusal, from status, envelope type/code
 * and the provider's own words. Explicit money/identity signals win over the
 * status: a 400 about credit is `credit`, not `invalidRequest`.
 */
export function classifyRefusalKind(signals: RefusalSignals): ProviderRefusalKind {
  const { status } = signals
  const type = norm(signals.type)
  const code = norm(signals.code)
  const message = signals.message ?? ''
  if (
    status === PROVIDER_RETRY_HTTP_STATUS.paymentRequired ||
    QUOTA_KINDS.has(type) ||
    QUOTA_KINDS.has(code) ||
    CREDIT_MESSAGE.test(message)
  )
    return 'credit'
  if (
    status === HTTP_STATUS.unauthorized ||
    AUTH_KINDS.has(type) ||
    AUTH_KINDS.has(code) ||
    AUTH_MESSAGE.test(message)
  )
    return 'authentication'
  if (
    status === HTTP_STATUS.forbidden ||
    PERMISSION_KINDS.has(type) ||
    PERMISSION_KINDS.has(code) ||
    PERMISSION_MESSAGE.test(message)
  )
    return 'permission'
  if (
    status === HTTP_STATUS.notFound ||
    NOT_FOUND_KINDS.has(type) ||
    NOT_FOUND_KINDS.has(code) ||
    NOT_FOUND_MESSAGE.test(message)
  )
    return 'notFound'
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
 * Statuses the providers document as answered before any processing, so
 * nothing was billed: the reservation is released in full. Anything else
 * (5xx, 408/409, an unanswered send) keeps its uncertain liability.
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
 * decision stands everywhere else unchanged.
 */
export function isRefusalRetryable(
  failure: RefusalCarrier,
  retryAfterMs: number | undefined,
): boolean {
  const kind = classifyRefusalKind({
    status: failure.status,
    type: failure.kind,
    code: failure.code,
    message: failure.message,
  })
  if (isNeverRetryRefusal(failure.status, kind)) return false
  return classifyRetry(RETRY_TABLES.responses, {
    status: failure.status,
    kind: failure.kind,
    code: failure.code,
    message: failure.message,
    retryAfterMs,
  }).retry
}

/** The typed view of a refusal-carrying `ModelApiError`. */
export function refusalOf(error: RefusalCarrier): ProviderRefusal {
  // `unrecognised` is this module's own marker from an unparsable body: it
  // survives classification, so the sentence quotes the body's first line
  // instead of claiming a server error.
  const kind =
    error.kind === 'unrecognised'
      ? 'unrecognised'
      : classifyRefusalKind({
          status: error.status,
          type: error.kind,
          code: error.code,
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

/** The first bounded line of an unparsable answer, for `unrecognised`. */
export function firstBodyLine(body: unknown): string {
  if (body === undefined || body === null) return ''
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return boundProviderMessage(text.split('\n', 1)[0] ?? '')
}

interface RefusalEnvelope {
  readonly type?: string | undefined
  readonly code?: string | number | undefined
  readonly message: string
}

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

/** OpenAI-style `{ error: { message, type, code } }` (chat, Responses and
 * every chat-format quirk, the ChatGPT-plan and Copilot routes). */
export function openAiEnvelope(body: unknown): RefusalEnvelope | undefined {
  const error = recordOf(recordOf(body)?.['error'])
  const message = textOf(error?.['message'])
  if (error === undefined || message === undefined) return undefined
  const type = error['type']
  const code = error['code']
  return {
    message,
    ...(typeof type === 'string' && { type }),
    ...((typeof code === 'string' || typeof code === 'number') && { code }),
  }
}

/** Anthropic-style `{ error: { type, message } }`. */
export function anthropicEnvelope(body: unknown): RefusalEnvelope | undefined {
  return openAiEnvelope(body)
}

/** Gemini-style `{ error: { code, message, status } }`. */
export function geminiEnvelope(body: unknown): RefusalEnvelope | undefined {
  const error = recordOf(recordOf(body)?.['error'])
  const message = textOf(error?.['message'])
  if (error === undefined || message === undefined) return undefined
  const status = error['status']
  const code = error['code']
  return {
    message,
    ...(typeof status === 'string' && { type: status }),
    ...((typeof code === 'string' || typeof code === 'number') && { code }),
  }
}

/** Ollama-style `{ error: "<message>" }`. */
export function ollamaEnvelope(body: unknown): RefusalEnvelope | undefined {
  const message = textOf(recordOf(body)?.['error'])
  return message === undefined ? undefined : { message }
}

/**
 * Every wire format's HTTP error through one function: the provider's status
 * and bounded words with its envelope type/code. `extract` reads the
 * format's envelope; an unknown shape is `unrecognised` with the status and
 * the first bounded line of the body. Never a product sentence. Each
 * format's parser wraps the result in its own `ModelApiError`.
 */
export function parseRefusalError(
  status: number,
  body: unknown,
  extract: (body: unknown) => RefusalEnvelope | undefined,
): Pick<RefusalCarrier, 'message' | 'kind' | 'code'> & { readonly kind: string } {
  const envelope = extract(body)
  if (envelope === undefined) {
    const first = firstBodyLine(body)
    return {
      message: first === '' ? `HTTP ${String(status)}` : `HTTP ${String(status)}: ${first}`,
      kind: 'unrecognised',
      code: undefined,
    }
  }
  return {
    message: boundProviderMessage(envelope.message),
    kind: envelope.type ?? 'unrecognised',
    code: envelope.code === undefined ? undefined : String(envelope.code),
  }
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
    case 'unrecognised': {
      return fill(UI_TEXT.providerRefusalUnrecognised, {
        provider,
        detail,
        status: String(refusal.status),
      })
    }
  }
}
