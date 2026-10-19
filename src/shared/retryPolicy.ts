// Retry classification per wire format (M101 BYO 5, Pi's
// `provider-retry`). Which failures are worth one more try and which never
// are (quota). A provider's `Retry-After` is honoured as given: no wait of
// ours refuses it (lane PROVERRORS, research AB13/OD3/ZB5/GD4: every
// provider documents its wait as the minimum to honour, none a maximum).
// Pure, and shared (not under `src/core/providers/`) so
// the activation and Model API bundles' Meta client reads the same table
// the providers bundle carries in `FormatQuirks`. `FormatQuirks` references
// these tables; it adds nothing of its own.

import { MODEL_API_RETRY_BASE_MS, PROVIDER_RETRY_HTTP_STATUS } from './constants'

/** The wire formats with a retry table; mirrors `ProviderFormat`. */
export type RetryFormat = 'responses' | 'chat' | 'anthropic' | 'gemini' | 'ollama'

/** One format's retry classification as data. */
export interface RetryTables {
  /** HTTP statuses worth one more try. */
  readonly statuses: readonly number[]
  /**
  Envelope error type/code values the provider documents as worth one
  more try, whatever the status (OpenRouter's in-flight-budget 402).
  */
  readonly errorKinds: readonly string[]
  /** Envelope error type/code values never retried, whatever the status (quota). */
  readonly quotaKinds: readonly string[]
}

/** 402 means the account cannot pay: never retried, unless the provider
documents that very code as worth asking again (`errorKinds`). */
const HTTP_PAYMENT_REQUIRED = PROVIDER_RETRY_HTTP_STATUS.paymentRequired

/**
Normalized quota/spend-cap codes emitted by the existing provider parsers.
The OpenAI rows are its documented 429 codes (read 2026-10-13,
https://developers.openai.com/api/docs/guides/error-codes): "Retrying
billing, spend, or quota errors won't restore API access."
*/
const QUOTA_ERROR_KINDS: readonly string[] = [
  'insufficient_quota',
  'quota_exceeded',
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
  'enforced_spend_limit_reached',
]

/**
Per-format tables. `responses` is Meta's documented set (429 and the
server errors; dev.meta.ai/docs/error-handling), unchanged from the
constants this replaces; `chat` adds the compatible APIs' documented
timeout/conflict retries; `anthropic` adds its 529 overload and 504
gateway with `overloaded_error`; `gemini` retries what Google lists as
transient ("429, 408, or 5xx"; ai.google.dev/gemini-api/docs/
troubleshooting, read 2026-10-17, lane PROVERRORS); `ollama` keeps the
conservative base set; nothing priced locally retries billing.
*/
export const RETRY_TABLES: Record<RetryFormat, RetryTables> = {
  responses: {
    statuses: [
      PROVIDER_RETRY_HTTP_STATUS.tooManyRequests,
      PROVIDER_RETRY_HTTP_STATUS.internalServerError,
      PROVIDER_RETRY_HTTP_STATUS.badGateway,
      PROVIDER_RETRY_HTTP_STATUS.serviceUnavailable,
      PROVIDER_RETRY_HTTP_STATUS.gatewayTimeout,
    ],
    errorKinds: [],
    quotaKinds: QUOTA_ERROR_KINDS,
  },
  chat: {
    statuses: [
      PROVIDER_RETRY_HTTP_STATUS.requestTimeout,
      PROVIDER_RETRY_HTTP_STATUS.conflict,
      PROVIDER_RETRY_HTTP_STATUS.tooManyRequests,
      PROVIDER_RETRY_HTTP_STATUS.internalServerError,
      PROVIDER_RETRY_HTTP_STATUS.badGateway,
      PROVIDER_RETRY_HTTP_STATUS.serviceUnavailable,
      PROVIDER_RETRY_HTTP_STATUS.gatewayTimeout,
    ],
    errorKinds: [],
    quotaKinds: QUOTA_ERROR_KINDS,
  },
  anthropic: {
    statuses: [
      PROVIDER_RETRY_HTTP_STATUS.requestTimeout,
      PROVIDER_RETRY_HTTP_STATUS.conflict,
      PROVIDER_RETRY_HTTP_STATUS.tooManyRequests,
      PROVIDER_RETRY_HTTP_STATUS.internalServerError,
      PROVIDER_RETRY_HTTP_STATUS.badGateway,
      PROVIDER_RETRY_HTTP_STATUS.serviceUnavailable,
      PROVIDER_RETRY_HTTP_STATUS.gatewayTimeout,
      PROVIDER_RETRY_HTTP_STATUS.overloaded,
    ],
    errorKinds: ['overloaded_error'],
    quotaKinds: QUOTA_ERROR_KINDS,
  },
  gemini: {
    statuses: [
      PROVIDER_RETRY_HTTP_STATUS.requestTimeout,
      PROVIDER_RETRY_HTTP_STATUS.tooManyRequests,
      PROVIDER_RETRY_HTTP_STATUS.internalServerError,
      PROVIDER_RETRY_HTTP_STATUS.badGateway,
      PROVIDER_RETRY_HTTP_STATUS.serviceUnavailable,
      PROVIDER_RETRY_HTTP_STATUS.gatewayTimeout,
    ],
    errorKinds: [],
    quotaKinds: QUOTA_ERROR_KINDS,
  },
  ollama: {
    statuses: [
      PROVIDER_RETRY_HTTP_STATUS.tooManyRequests,
      PROVIDER_RETRY_HTTP_STATUS.internalServerError,
      PROVIDER_RETRY_HTTP_STATUS.badGateway,
      PROVIDER_RETRY_HTTP_STATUS.serviceUnavailable,
      PROVIDER_RETRY_HTTP_STATUS.gatewayTimeout,
    ],
    errorKinds: [],
    quotaKinds: QUOTA_ERROR_KINDS,
  },
}

/**
One provider's documented retry bounds (lane RETRYLIMITS, owner's binding
rule: the only hard-coded limits are each provider's own). Every field a
provider does not document stays absent: no limit of ours applies, the
person's `museSpark.modelApiMaxRetries` setting decides, and with none
set the provider's own Retry-After (or stop answer) governs.
*/
export interface RetryLimits {
  /** Documented maximum retries after the first try (attempts minus one). */
  readonly maxRetries?: number | undefined
  /** Documented initial wait between tries in milliseconds. */
  readonly baseMs?: number | undefined
  /** Documented longest wait between tries in milliseconds. */
  readonly maxMs?: number | undefined
}

/**
Each format's documented bounds (read 2026-10-17; the per-provider table
is `docs/certification/provider-refusals.md`, "Lane RETRYLIMITS").
`responses` and `chat` carry none at the format level: OpenAI's API docs
say only "limit retries" (openai.md §4; its SDK's documented 2 retries
ride on the OpenAI preset's own override in `presets.ts`) and the other
chat providers name no count or bounds, so presets on those formats
retry unbounded unless the person sets a limit or the preset documents
one of its own.
`anthropic` retries twice (the official SDK default, "twice by default";
its backoff has no documented bounds). `gemini` retries four times from
~1 s up to 60 s (the official SDK default). `ollama` serves local models
that document no retry bounds at all.
*/
export const PROVIDER_RETRY_LIMITS: Record<RetryFormat, RetryLimits> = {
  responses: {},
  chat: {},
  anthropic: { maxRetries: 2 },
  gemini: { maxRetries: 4, baseMs: 1000, maxMs: 60_000 },
  ollama: {},
}

/**
Meta's own documented bounds (dev.meta.ai/docs/error-handling: 429 and
the server errors are retryable with exponential backoff and jitter,
honouring Retry-After; 3–5 attempts, so 4 retries; no documented backoff
bounds). The Model API transport's default; configured providers use
their preset's quirks instead.
*/
export const META_DOCUMENTED_RETRY_LIMITS: RetryLimits = { maxRetries: 4 }

/**
The retries one call may use: the person's setting caps the provider's
documented maximum (it reduces that provider-defined limit but never
raises it), the person's value decides alone where the provider
documents none, and undefined (unbounded: the provider's own Retry-After
waits and stop answers govern the loop) where neither sets one.
*/
export function effectiveMaxRetries(
  personCap: number | undefined,
  documented: RetryLimits | undefined,
): number | undefined {
  const providerMaxRetries = documented?.maxRetries
  return personCap !== undefined && providerMaxRetries !== undefined
    ? Math.min(personCap, providerMaxRetries)
    : (personCap ?? providerMaxRetries)
}

/**
Whether an exhausted retry budget is the person's own cap rather than a
provider maximum (lane PR225W1): the effective limit equals the person's
setting, which only happens when the person set one at or under the
provider's documented maximum. The turn loop reports exactly this case on
the orchestrator's feed, so an orchestrated run can tell a cap stop from
a provider refusal.
*/
export function isPersonRetryCap(
  personCap: number | undefined,
  allowed: number | undefined,
): boolean {
  return personCap !== undefined && allowed === personCap
}

/**
The wait before try number `attempt` (0-based): the provider's own wait
whole when it named one (never shortened to our backoff), else
exponential from the documented base (1 s is the only documented initial
wait: Gemini's SDK and xAI's examples) doubling per try, up to the
documented maximum when the provider sets one and uncapped otherwise.
`jitterSample` is the transport's 0 ≤ n < 1 draw, added whole.
*/
export function retryDelayMs(
  attempt: number,
  documented: RetryLimits | undefined,
  suggestedMs: number | undefined,
  jitterSample: number,
  jitterMs: number,
): number {
  const jitter = Math.floor(jitterSample * jitterMs)
  if (suggestedMs !== undefined) return suggestedMs + jitter
  const baseMs = documented?.baseMs ?? MODEL_API_RETRY_BASE_MS
  const maxMs = documented?.maxMs ?? Infinity
  const exponential = Math.min(baseMs * 2 ** attempt, maxMs)
  return Math.min(exponential + jitter, maxMs)
}

/** One failed HTTP answer, as the envelope parser reports it. */
export interface RetryFailure {
  readonly status: number
  /** The envelope's `error.type`, when any. */
  readonly kind: string | undefined
  /** The envelope's `error.code`, when any. */
  readonly code: string | undefined
  /** The envelope's message, for quota texts no kind or code names. */
  readonly message: string
}

/** Why a failure is not retried: spent quota, or neither table hit. */
export type RetryRefusalReason = 'quota' | 'not-retryable'

/** Whether the failure is worth one more try, and why not when it is not. */
export type RetryDecision =
  { readonly retry: true } | { readonly retry: false; readonly reason: RetryRefusalReason }

/** Quota wording inside a message (`You exceeded your current quota, …`). */
const QUOTA_MESSAGE = /\bquota\b/i

function isMatchingKind(kinds: readonly string[], value: string | undefined): boolean {
  return value !== undefined && kinds.some((kind) => kind.toLowerCase() === value.toLowerCase())
}

/**
Whether to try again after `failure` under `tables`. A quota kind or code
never retries; a code the provider documents as worth asking again does,
whatever its status; otherwise 402 and quota wording never retry, and a
listed status does.
*/
export function classifyRetry(tables: RetryTables, failure: RetryFailure): RetryDecision {
  if (
    isMatchingKind(tables.quotaKinds, failure.kind) ||
    isMatchingKind(tables.quotaKinds, failure.code)
  ) {
    return { retry: false, reason: 'quota' }
  }
  if (
    isMatchingKind(tables.errorKinds, failure.kind) ||
    isMatchingKind(tables.errorKinds, failure.code)
  ) {
    return { retry: true }
  }
  if (failure.status === HTTP_PAYMENT_REQUIRED) {
    return { retry: false, reason: 'quota' }
  }
  if (QUOTA_MESSAGE.test(failure.message)) {
    return { retry: false, reason: 'quota' }
  }
  return tables.statuses.includes(failure.status)
    ? { retry: true }
    : { retry: false, reason: 'not-retryable' }
}
