// Retry classification per wire format (M101 BYO 5, Pi's
// `provider-retry`). Which failures are worth one more try, which never
// are (quota), and the `Retry-After` past which a request fails at once,
// naming the wait. Pure, and shared (not under `src/core/providers/`) so
// the activation and Model API bundles' Meta client reads the same table
// the providers bundle carries in `FormatQuirks`. `FormatQuirks` references
// these tables; it adds nothing of its own.

import { PROVIDER_RETRY_AFTER_CAP_MS, PROVIDER_RETRY_HTTP_STATUS } from './constants'

/** The wire formats with a retry table; mirrors `ProviderFormat`. */
export type RetryFormat = 'responses' | 'chat' | 'anthropic' | 'gemini' | 'ollama'

/** One format's retry classification as data. */
export interface RetryTables {
  /** HTTP statuses worth one more try. */
  readonly statuses: readonly number[]
  /** Envelope error type/code values worth one more try where the status is not. */
  readonly errorKinds: readonly string[]
  /** Envelope error type/code values never retried, whatever the status (quota). */
  readonly quotaKinds: readonly string[]
  /** A `Retry-After` past this fails at once, naming the wait. */
  readonly retryAfterCapMs: number
}

/** 402 means the account cannot pay: never retried on any format. */
const HTTP_PAYMENT_REQUIRED = PROVIDER_RETRY_HTTP_STATUS.paymentRequired

/** The research's cap: a `Retry-After` over 60 s fails at once. */
const RETRY_AFTER_CAP_MS = PROVIDER_RETRY_AFTER_CAP_MS

/** Normalized quota/spend-cap codes emitted by the existing provider parsers. */
const QUOTA_ERROR_KINDS: readonly string[] = [
  'insufficient_quota',
  'quota_exceeded',
  'enforced_spend_limit_reached',
]

/**
 * Per-format tables. `responses` is Meta's documented set (429 and the
 * server errors; dev.meta.ai/docs/error-handling), unchanged from the
 * constants this replaces; `chat` adds the compatible APIs' documented
 * timeout/conflict retries; `anthropic` adds its 529 overload and 504
 * gateway with `overloaded_error`; `gemini` and `ollama` keep the
 * conservative base set, nothing priced locally retries billing.
 */
export const RETRY_TABLES: Record<RetryFormat, RetryTables> = {
  responses: {
    statuses: [
      PROVIDER_RETRY_HTTP_STATUS.tooManyRequests,
      PROVIDER_RETRY_HTTP_STATUS.internalServerError,
      PROVIDER_RETRY_HTTP_STATUS.badGateway,
      PROVIDER_RETRY_HTTP_STATUS.serviceUnavailable,
    ],
    errorKinds: [],
    quotaKinds: QUOTA_ERROR_KINDS,
    retryAfterCapMs: RETRY_AFTER_CAP_MS,
  },
  chat: {
    statuses: [
      PROVIDER_RETRY_HTTP_STATUS.requestTimeout,
      PROVIDER_RETRY_HTTP_STATUS.conflict,
      PROVIDER_RETRY_HTTP_STATUS.tooManyRequests,
      PROVIDER_RETRY_HTTP_STATUS.internalServerError,
      PROVIDER_RETRY_HTTP_STATUS.badGateway,
      PROVIDER_RETRY_HTTP_STATUS.serviceUnavailable,
    ],
    errorKinds: [],
    quotaKinds: QUOTA_ERROR_KINDS,
    retryAfterCapMs: RETRY_AFTER_CAP_MS,
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
    retryAfterCapMs: RETRY_AFTER_CAP_MS,
  },
  gemini: {
    statuses: [
      PROVIDER_RETRY_HTTP_STATUS.tooManyRequests,
      PROVIDER_RETRY_HTTP_STATUS.internalServerError,
      PROVIDER_RETRY_HTTP_STATUS.badGateway,
      PROVIDER_RETRY_HTTP_STATUS.serviceUnavailable,
    ],
    errorKinds: [],
    quotaKinds: QUOTA_ERROR_KINDS,
    retryAfterCapMs: RETRY_AFTER_CAP_MS,
  },
  ollama: {
    statuses: [
      PROVIDER_RETRY_HTTP_STATUS.tooManyRequests,
      PROVIDER_RETRY_HTTP_STATUS.internalServerError,
      PROVIDER_RETRY_HTTP_STATUS.badGateway,
      PROVIDER_RETRY_HTTP_STATUS.serviceUnavailable,
    ],
    errorKinds: [],
    quotaKinds: QUOTA_ERROR_KINDS,
    retryAfterCapMs: RETRY_AFTER_CAP_MS,
  },
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
  /** The parsed `Retry-After`, when the answer carried one. */
  readonly retryAfterMs: number | undefined
}

/** Why a failure is not retried: spent quota, too long a wait, or neither table hit. */
export type RetryRefusalReason = 'quota' | 'retry-after-cap' | 'not-retryable'

/** Whether the failure is worth one more try, and why not when it is not. */
export type RetryDecision =
  { readonly retry: true } | { readonly retry: false; readonly reason: RetryRefusalReason }

/** Quota wording inside a message (`You exceeded your current quota, …`). */
const QUOTA_MESSAGE = /\bquota\b/i

function isMatchingKind(kinds: readonly string[], value: string | undefined): boolean {
  return value !== undefined && kinds.some((kind) => kind.toLowerCase() === value.toLowerCase())
}

/**
 * Whether to try again after `failure` under `tables`. Quota (402, a quota
 * kind or code, quota wording) never retries; a `Retry-After` past the cap
 * fails at once; otherwise a listed status, or a listed error kind where
 * the status is not listed, retries.
 */
export function classifyRetry(tables: RetryTables, failure: RetryFailure): RetryDecision {
  if (failure.status === HTTP_PAYMENT_REQUIRED) {
    return { retry: false, reason: 'quota' }
  }
  if (
    isMatchingKind(tables.quotaKinds, failure.kind) ||
    isMatchingKind(tables.quotaKinds, failure.code)
  ) {
    return { retry: false, reason: 'quota' }
  }
  if (QUOTA_MESSAGE.test(failure.message)) {
    return { retry: false, reason: 'quota' }
  }
  if (failure.retryAfterMs !== undefined && failure.retryAfterMs > tables.retryAfterCapMs) {
    return { retry: false, reason: 'retry-after-cap' }
  }
  if (tables.statuses.includes(failure.status)) {
    return { retry: true }
  }
  return isMatchingKind(tables.errorKinds, failure.kind) ||
    isMatchingKind(tables.errorKinds, failure.code)
    ? { retry: true }
    : { retry: false, reason: 'not-retryable' }
}
