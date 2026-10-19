// M106, D86.6: one shared per-provider/key bucket. Only U12's captured
// Meta headers are interpreted here; another provider supplies its own
// captured interpreter through the client's capability port.
import * as z from 'zod/mini'
import {
  MILLISECONDS_PER_MINUTE,
  MILLISECONDS_PER_SECOND,
  MINUTES_PER_HOUR,
  PACING_WINDOW_MS,
} from '../../../shared/constants'

export type PacingClass = 'foreground' | 'subagent' | 'bestOfN' | 'team' | 'judge' | 'schedule'

const limitsSchema = z.strictObject({
  requests: z.int().check(z.gt(0)),
  remainingRequests: z.int().check(z.gte(0)),
  tokens: z.int().check(z.gt(0)),
  remainingTokens: z.int().check(z.gte(0)),
  requestWindowMs: z.optional(z.int().check(z.gt(0))),
  tokenWindowMs: z.optional(z.int().check(z.gt(0))),
})
export type PacingLimits = z.infer<typeof limitsSchema>

/** Decimal integers only: absent, blank, exponent and partial values are not limits. */
function headerCount(headers: Headers, name: string): number {
  const value = headers.get(name)
  return value !== null && /^\d+$/.test(value) ? Number(value) : NaN
}

/** A limit/remaining pair, both decimal integers with remaining at most the limit. */
function limitPair(
  headers: Headers,
  limitName: string,
  remainingName: string,
): { readonly limit: number; readonly remaining: number } | undefined {
  const limit = headerCount(headers, limitName)
  const remaining = headerCount(headers, remainingName)
  const isValid =
    Number.isSafeInteger(limit) && limit > 0 && Number.isSafeInteger(remaining) && remaining >= 0
  return isValid ? { limit, remaining: Math.min(remaining, limit) } : undefined
}

/** Reset-duration units in milliseconds: the units the captures show. */
const RESET_DURATION_UNIT_MS: Readonly<Record<string, number>> = {
  ms: 1,
  s: MILLISECONDS_PER_SECOND,
  m: MILLISECONDS_PER_MINUTE,
  h: MILLISECONDS_PER_MINUTE * MINUTES_PER_HOUR,
}

/**
 * A reset duration in milliseconds (`120ms`, `15.254s`, `1m26.4s`): the
 * time until the bucket resets, as OpenAI and Groq send it (captured
 * 2026-10-04: `docs/certification/m95-captures/{openai,groq}/*-stream.json`).
 * Anything else is not a duration: undefined, so the default window stands.
 */
export function resetDurationMs(header: string | null): number | undefined {
  if (header === null || header.trim() === '') {
    return undefined
  }
  const body = header.trim()
  let total = 0
  let consumed = ''
  for (const part of body.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) {
    const amount = Number(part[1])
    const unit = part[2] === undefined ? NaN : (RESET_DURATION_UNIT_MS[part[2]] ?? NaN)
    total += amount * unit
    consumed += part[0]
  }
  return consumed !== '' && consumed === body && Number.isFinite(total) ? total : undefined
}

function pacingLimits(
  requests: { readonly limit: number; readonly remaining: number },
  tokens: { readonly limit: number; readonly remaining: number },
  requestWindowMs: number | undefined,
  tokenWindowMs: number | undefined,
): PacingLimits | undefined {
  const parsed = limitsSchema.safeParse({
    requests: requests.limit,
    remainingRequests: requests.remaining,
    tokens: tokens.limit,
    remainingTokens: tokens.remaining,
    ...(requestWindowMs !== undefined &&
      requestWindowMs > 0 && { requestWindowMs: Math.floor(requestWindowMs) }),
    ...(tokenWindowMs !== undefined &&
      tokenWindowMs > 0 && { tokenWindowMs: Math.floor(tokenWindowMs) }),
  })
  return parsed.success
    ? {
        ...parsed.data,
        remainingRequests: Math.min(parsed.data.remainingRequests, parsed.data.requests),
        remainingTokens: Math.min(parsed.data.remainingTokens, parsed.data.tokens),
      }
    : undefined
}

/**
 * A bucket's window from its reset: the reset is the time until the bucket
 * is full again, so a continuously refilling bucket gives
 * window = reset * limit / (limit - remaining). The captures pin this
 * down exactly (Groq requests 1m26.4s at 999/1000 is one day, its tokens
 * 15.254s at 5966/8000 one minute; OpenAI 120ms at 499/500 one minute).
 * A full bucket or a missing reset says nothing: undefined.
 */
function derivedWindowMs(
  pair: { readonly limit: number; readonly remaining: number } | undefined,
  resetMs: number | undefined,
): number | undefined {
  if (pair === undefined || resetMs === undefined || resetMs <= 0) return undefined
  const used = pair.limit - pair.remaining
  return used > 0 ? (resetMs * pair.limit) / used : undefined
}

/**
 * OpenAI and Groq (captured 2026-10-04): request/token buckets with
 * Go-duration resets until each bucket is full again. Each bucket keeps
 * its own derived window (Groq's requests are per day, its tokens per
 * minute), so the token bucket refills at its own rate instead of the
 * slower request one; no derivable window keeps the default.
 */
/**
 * The request/token header pairs the OpenAI-style readers share (captured
 * 2026-10-04): both buckets must parse before either reader answers.
 */
function requestTokenPair(headers: Headers):
  | {
      readonly requests: { readonly limit: number; readonly remaining: number }
      readonly tokens: { readonly limit: number; readonly remaining: number }
    }
  | undefined {
  const requests = limitPair(
    headers,
    'x-ratelimit-limit-requests',
    'x-ratelimit-remaining-requests',
  )
  const tokens = limitPair(headers, 'x-ratelimit-limit-tokens', 'x-ratelimit-remaining-tokens')
  return requests === undefined || tokens === undefined ? undefined : { requests, tokens }
}

export function openaiPacingLimits(headers: Headers): PacingLimits | undefined {
  const pair = requestTokenPair(headers)
  return pair === undefined
    ? undefined
    : pacingLimits(
        pair.requests,
        pair.tokens,
        derivedWindowMs(pair.requests, resetDurationMs(headers.get('x-ratelimit-reset-requests'))),
        derivedWindowMs(pair.tokens, resetDurationMs(headers.get('x-ratelimit-reset-tokens'))),
      )
}

/**
 * xAI (captured 2026-10-04): request/token limits with no reset headers,
 * so the default window stands.
 */
export function xaiPacingLimits(headers: Headers): PacingLimits | undefined {
  const pair = requestTokenPair(headers)
  return pair === undefined
    ? undefined
    : pacingLimits(pair.requests, pair.tokens, undefined, undefined)
}

/**
 * Anthropic (captured 2026-10-04): request and total-token buckets across
 * four limit families, with absolute RFC 3339 resets. The token bucket is
 * the all-tokens total; the input/output splits ride the usage headers.
 * Every captured bucket resets at the same instant (a fixed window
 * boundary), so a reset names when the window ends, never its length:
 * the default window stands rather than shrinking to the time left in it.
 */
export function anthropicPacingLimits(headers: Headers): PacingLimits | undefined {
  const requests = limitPair(
    headers,
    'anthropic-ratelimit-requests-limit',
    'anthropic-ratelimit-requests-remaining',
  )
  const tokens = limitPair(
    headers,
    'anthropic-ratelimit-tokens-limit',
    'anthropic-ratelimit-tokens-remaining',
  )
  return requests === undefined || tokens === undefined
    ? undefined
    : pacingLimits(requests, tokens, undefined, undefined)
}

/**
 * Azure's 429 carries `retry-after-ms` (integer milliseconds; research
 * `docs/certification/m95-research.md` §1.2 [AZ5]), where other providers
 * send `retry-after` seconds. Anything else is not a wait: undefined.
 */
export function azureRetryAfterMs(headers: Headers): number | undefined {
  const value = headers.get('retry-after-ms')
  if (value === null || !/^\d+$/.test(value.trim())) return undefined
  const ms = Number(value.trim())
  return Number.isSafeInteger(ms) ? ms : undefined
}

/** U12, sequences 34/35/37/39/40. No reset header was captured. */
export function metaPacingLimits(headers: Headers): PacingLimits | undefined {
  const parsed = limitsSchema.safeParse({
    requests: headerCount(headers, 'x-ratelimit-limit-requests'),
    remainingRequests: headerCount(headers, 'x-ratelimit-remaining-requests'),
    tokens: headerCount(headers, 'x-ratelimit-limit-tokens'),
    remainingTokens: headerCount(headers, 'x-ratelimit-remaining-tokens'),
  })
  if (!parsed.success) return undefined
  const limits = parsed.data
  return {
    ...limits,
    remainingRequests: Math.min(limits.remainingRequests, limits.requests),
    remainingTokens: Math.min(limits.remainingTokens, limits.tokens),
  }
}

/** Projected from the selected provider's capability evidence, never from its wire format. */
export interface PacingProvider {
  readonly identity: { readonly provider: string }
  /** Undefined until this provider has its own header capture. */
  readonly readLimits?: (headers: Headers) => PacingLimits | undefined
}

export interface PacingDeps {
  readonly now: () => number
  /** Must reject promptly on Stop; the Model API client's abortable pause supplies this. */
  readonly wait: (ms: number, signal: AbortSignal) => Promise<void>
}

interface Bucket {
  requestWindowMs: number
  tokenWindowMs: number
  requests: number
  remainingRequests: number
  tokens: number | undefined
  remainingTokens: number | undefined
  updatedAt: number
  pausedUntil: number
  observed: boolean
  admittedRequests: number
  admittedTokens: number
}

/** Cumulative local debits at dispatch, so late headers retain subsequent admissions. */
export interface PacingSnapshot {
  readonly requests: number
  readonly tokens: number
}

/** A portable admission port for team pools, judges and scheduled dispatchers. */
export interface RequestPacer {
  acquire(
    account: string,
    kind: PacingClass,
    tokens: number,
    signal: AbortSignal,
    onWait?: (delayMs: number) => void,
  ): Promise<void>
  snapshot(account: string): PacingSnapshot
  observe(
    account: string,
    limits: PacingLimits | undefined,
    retryAfterMs?: number,
    sent?: PacingSnapshot,
  ): void
}

export class ModelApiPacing implements RequestPacer {
  private readonly buckets = new Map<string, Bucket>()

  public constructor(private readonly deps: PacingDeps) {}

  private bucket(account: string): Bucket {
    let bucket = this.buckets.get(account)
    if (bucket === undefined) {
      bucket = {
        requestWindowMs: PACING_WINDOW_MS,
        tokenWindowMs: PACING_WINDOW_MS,
        // No shape of our own (owner 2026-10-16): an empty bucket admits
        // freely until the first capture replaces every number here.
        requests: 0,
        remainingRequests: 0,
        tokens: undefined,
        remainingTokens: undefined,
        updatedAt: this.deps.now(),
        pausedUntil: 0,
        observed: false,
        admittedRequests: 0,
        admittedTokens: 0,
      }
      this.buckets.set(account, bucket)
    }
    const now = this.deps.now()
    const elapsed = Math.max(0, now - bucket.updatedAt)
    bucket.remainingRequests = Math.min(
      bucket.requests,
      bucket.remainingRequests + (elapsed * bucket.requests) / bucket.requestWindowMs,
    )
    if (bucket.tokens !== undefined && bucket.remainingTokens !== undefined) {
      bucket.remainingTokens = Math.min(
        bucket.tokens,
        bucket.remainingTokens + (elapsed * bucket.tokens) / bucket.tokenWindowMs,
      )
    }
    bucket.updatedAt = now
    return bucket
  }

  private charge(bucket: Bucket, tokens: number): void {
    bucket.admittedRequests += 1
    bucket.admittedTokens += tokens
    bucket.remainingRequests = Math.max(0, bucket.remainingRequests - 1)
    if (bucket.remainingTokens !== undefined) {
      bucket.remainingTokens = Math.max(0, bucket.remainingTokens - tokens)
    }
  }

  public snapshot(account: string): PacingSnapshot {
    const bucket = this.bucket(account)
    return { requests: bucket.admittedRequests, tokens: bucket.admittedTokens }
  }

  /** Local debits are authoritative; a stale response can only reduce headroom. */
  public observe(
    account: string,
    limits: PacingLimits | undefined,
    retryAfterMs = 0,
    sent?: PacingSnapshot,
  ): void {
    const bucket = this.bucket(account)
    if (limits !== undefined) {
      const checked = limitsSchema.parse(limits)
      const laterRequests = sent === undefined ? 0 : bucket.admittedRequests - sent.requests
      const laterTokens = sent === undefined ? 0 : bucket.admittedTokens - sent.tokens
      // The first capture establishes the real capacity, retaining all startup debits.
      const localRequests = bucket.observed
        ? bucket.remainingRequests
        : Math.max(0, checked.requests - bucket.admittedRequests)
      const localTokens =
        bucket.remainingTokens ?? Math.max(0, checked.tokens - bucket.admittedTokens)
      bucket.requestWindowMs = checked.requestWindowMs ?? PACING_WINDOW_MS
      bucket.tokenWindowMs = checked.tokenWindowMs ?? PACING_WINDOW_MS
      bucket.requests = checked.requests
      bucket.remainingRequests = Math.max(
        0,
        Math.min(localRequests, checked.remainingRequests - laterRequests, checked.requests),
      )
      bucket.tokens = checked.tokens
      bucket.remainingTokens = Math.max(
        0,
        Math.min(localTokens, checked.remainingTokens - laterTokens, checked.tokens),
      )
      bucket.observed = true
    }
    if (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return
    // The provider's own wait is honoured whole: no ceiling of ours applies
    // to a value the provider sent (the owner's limits rule). The wait stays
    // Stop-abortable, and only background dispatch pauses here; the user's
    // turn never waits on a sibling's pause.
    bucket.pausedUntil = Math.max(bucket.pausedUntil, this.deps.now() + retryAfterMs)
  }

  /** M107/M108 can read headroom without reading a credential or initiating a request. */
  public headroom(account: string): Readonly<Bucket> {
    return { ...this.bucket(account) }
  }

  public async acquire(
    account: string,
    kind: PacingClass,
    tokens: number,
    signal: AbortSignal,
    onWait?: (delayMs: number) => void,
  ): Promise<void> {
    if (!Number.isSafeInteger(tokens) || tokens < 0) {
      throw new RangeError('Invalid pacing token estimate')
    }
    for (;;) {
      signal.throwIfAborted()
      const bucket = this.bucket(account)
      const pause = Math.max(0, bucket.pausedUntil - this.deps.now())
      // Foreground never joins the fan-out queue. Otherwise only what the
      // provider reported shapes the wait (owner 2026-10-16): no observed
      // limits means no queue at all — the first requests go out freely —
      // but a 429 pause holds even before the first headers. Its own HTTP
      // retry loop honours Retry-After; a sibling's 429 cannot delay the
      // user's turn.
      if (kind === 'foreground' || (pause === 0 && !bucket.observed)) {
        this.charge(bucket, tokens)
        return
      }
      // Keep one request for the foreground. A one-RPM key can still run
      // background work once full; foreground always bypasses this check.
      // Only what the provider reported shapes the wait (owner 2026-10-16):
      // its request and token headroom, and its Retry-After pauses. No
      // request is reserved for the foreground and no fraction held back.
      // Unobserved buckets have no headroom math yet; a pause still holds.
      // An estimate larger than the whole observed bucket waits only for a
      // full bucket, then goes to the provider to judge: headroom past the
      // bucket never comes, and waiting for it would never end.
      const remainingRequests = bucket.remainingRequests
      const requestWait = bucket.observed
        ? (Math.max(0, 1 - remainingRequests) * bucket.requestWindowMs) / bucket.requests
        : 0
      const tokenWait =
        !bucket.observed || bucket.tokens === undefined || bucket.remainingTokens === undefined
          ? 0
          : (Math.max(0, Math.min(tokens, bucket.tokens) - bucket.remainingTokens) *
              bucket.tokenWindowMs) /
            bucket.tokens
      const delay = Math.ceil(Math.max(pause, requestWait, tokenWait))
      if (delay === 0) {
        this.charge(bucket, tokens)
        return
      }
      onWait?.(delay)
      await this.deps.wait(delay, signal)
    }
  }
}
