// M106, D86.6: one shared per-provider/key bucket. Only U12's captured
// Meta headers are interpreted here; another provider supplies its own
// captured interpreter through the client's capability port.
import * as z from 'zod/mini'
import {
  AZURE_BURST_WINDOW_LONG_MS,
  AZURE_BURST_WINDOW_SHORT_MS,
  DEEPSEEK_CONCURRENCY_DEEPSEEK_FLASH,
  DEEPSEEK_CONCURRENCY_DEEPSEEK_V4_PRO,
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
A reset duration in milliseconds (`120ms`, `15.254s`, `1m26.4s`): the
time until the bucket resets, as OpenAI and Groq send it (captured
2026-10-04: `docs/certification/m95-captures/{openai,groq}/*-stream.json`).
Anything else is not a duration: undefined, so the default window stands.
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
A bucket's window from its reset: the reset is the time until the bucket
is full again, so a continuously refilling bucket gives
window = reset * limit / (limit - remaining). The captures pin this
down exactly (Groq requests 1m26.4s at 999/1000 is one day, its tokens
15.254s at 5966/8000 one minute; OpenAI 120ms at 499/500 one minute).
A full bucket or a missing reset says nothing: undefined.
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
OpenAI and Groq (captured 2026-10-04): request/token buckets with
Go-duration resets until each bucket is full again. Each bucket keeps
its own derived window (Groq's requests are per day, its tokens per
minute), so the token bucket refills at its own rate instead of the
slower request one; no derivable window keeps the default.
*/
/**
The request/token header pairs the OpenAI-style readers share (captured
2026-10-04): both buckets must parse before either reader answers.
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
xAI (captured 2026-10-04; scopes from docs.x.ai/developers/rate-limits,
read 2026-10-22): request/token limits with no reset headers. Every team
holds per-model requests-per-second and tokens-per-minute budgets, so the
request bucket refills per second and the token bucket per minute.
*/
export function xaiPacingLimits(headers: Headers): PacingLimits | undefined {
  const pair = requestTokenPair(headers)
  return pair === undefined
    ? undefined
    : pacingLimits(pair.requests, pair.tokens, MILLISECONDS_PER_SECOND, MILLISECONDS_PER_MINUTE)
}

/**
Anthropic (captured 2026-10-04): request and total-token buckets across
four limit families, with absolute RFC 3339 resets. The token bucket is
the all-tokens total; the input/output splits ride the usage headers.
Every captured bucket resets at the same instant (a fixed window
boundary), so a reset names when the window ends, never its length:
the default window stands rather than shrinking to the time left in it.
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
Azure's 429 carries `retry-after-ms` (integer milliseconds; research
`docs/certification/m95-research.md` §1.2 [AZ5]), where other providers
send `retry-after` seconds. Anything else is not a wait: undefined.
*/
export function azureRetryAfterMs(headers: Headers): number | undefined {
  const value = headers.get('retry-after-ms')
  if (value === null || !/^\d+$/.test(value.trim())) return undefined
  const ms = Number(value.trim())
  return Number.isSafeInteger(ms) ? ms : undefined
}

/**
DeepSeek's documented account-level concurrency ceiling for one model
(api-docs.deepseek.com/quick_start/rate_limit, "Concurrency Limit", read
2026-10-23): 2500 for deepseek-flash, 500 for deepseek-v4-pro. DeepSeek
sends no limit headers (captured 2026-10-04:
`docs/certification/m95-captures/deepseek/02-tool-call-stream.json`), so
this table, not a header reader, paces it. A model the table does not
name has no documented ceiling: undefined, so only the live 429 pause
applies.
*/
/** DeepSeek's documented per-model concurrency table; a model missing here has no documented ceiling. */
const DEEPSEEK_CONCURRENCY_BY_MODEL: Readonly<Record<string, number>> = {
  'deepseek-flash': DEEPSEEK_CONCURRENCY_DEEPSEEK_FLASH,
  'deepseek-v4-pro': DEEPSEEK_CONCURRENCY_DEEPSEEK_V4_PRO,
}

export function deepseekConcurrencyLimit(model: string | undefined): number | undefined {
  return model === undefined ? undefined : DEEPSEEK_CONCURRENCY_BY_MODEL[model]
}

/**
Azure's documented burst share for one evaluation sub-window: the
observed per-minute request limit's expected share of the sub-window
(learn.microsoft.com/azure/foundry/openai/how-to/quota, read 2026-10-23:
600 RPM over 1-second windows allows 10 per window). Floored, since past
the expected share answers 429, and never below one: a lone request is
not a burst, and the per-minute bucket still caps the minute rate.
*/
export function azureBurstShare(
  perMinuteLimit: number,
  limitWindowMs: number,
  subWindowMs: number,
): number {
  return Math.max(1, Math.floor((perMinuteLimit * subWindowMs) / limitWindowMs))
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
  /** Held concurrency slots per model (DeepSeek's documented ceilings). */
  inflight: Map<string, number>
  /** Waiters per model for a freed concurrency slot. */
  waiters: Map<string, Set<() => void>>
  /** Admission times, pruned to the longest burst sub-window (Azure). */
  admissions: number[]
}

/** Cumulative local debits at dispatch, so late headers retain subsequent admissions. */
export interface PacingSnapshot {
  readonly requests: number
  readonly tokens: number
}

/** What the pacer knows about the request it admits: the codec-supplied native model id and the stable preset id, so provider-documented per-model ceilings (DeepSeek concurrency) and per-provider shaping (Azure bursts) apply. */
export interface PacingAcquireOptions {
  readonly model?: string | undefined
  readonly provider?: string | undefined
}

/** The provider-documented limit a pacing wait answers, so the wait names it in words. */
export type PacingWaitLimit =
  | { readonly kind: 'concurrency'; readonly limit: number }
  | { readonly kind: 'burst'; readonly windowMs: number }

/** A portable admission port for team pools, judges and scheduled dispatchers. */
export interface RequestPacer {
  /**
  Admits one request, waiting for provider headroom first. Where the
  provider documents a concurrency ceiling (DeepSeek), the admission
  holds a slot until the returned release runs: the transport runs it
  when the model response completes, so the slot spans send to
  completion exactly as documented. No ceiling means no slot: undefined.
  */
  acquire(
    account: string,
    kind: PacingClass,
    tokens: number,
    signal: AbortSignal,
    onWait?: (delayMs: number, limit?: PacingWaitLimit) => void,
    options?: PacingAcquireOptions,
  ): Promise<(() => void) | undefined>
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
        inflight: new Map(),
        waiters: new Map(),
        admissions: [],
      }
      this.buckets.set(account, bucket)
    }
    const now = this.deps.now()
    // Burst shaping only looks back over the longest documented
    // sub-window; older admissions are forgotten, never stored.
    if (bucket.admissions.length > 0)
      bucket.admissions = bucket.admissions.filter(
        (admittedAt) => admittedAt > now - AZURE_BURST_WINDOW_LONG_MS && admittedAt <= now,
      )
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

  /** Holds one concurrency slot for the model; the lease frees it exactly once. */
  private hold(account: string, model: string): () => void {
    const bucket = this.bucket(account)
    bucket.inflight.set(model, (bucket.inflight.get(model) ?? 0) + 1)
    let hasReleased = false
    return () => {
      if (hasReleased) return
      hasReleased = true
      const current = this.bucket(account)
      const held = current.inflight.get(model) ?? 0
      if (held > 1) current.inflight.set(model, held - 1)
      else current.inflight.delete(model)
      // A freed slot wakes every waiter for the model; each re-checks on
      // wake, so a slot taken in between waits again instead of overrunning.
      const waiters = current.waiters.get(model)
      if (waiters === undefined) return
      current.waiters.delete(model)
      for (const wake of waiters) wake()
    }
  }

  /** Sleeps until a slot for the model frees or Stop ends the wait; the loop re-checks after. */
  private untilReleased(bucket: Bucket, model: string, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      const existing = bucket.waiters.get(model)
      const waiters = existing ?? new Set<() => void>()
      if (existing === undefined) bucket.waiters.set(model, waiters)
      // The same wake answers a release and Stop: Stop resolves here and
      // the loop's re-check throws it. Whichever fires first drops the
      // abort listener, so a released wait leaves nothing behind.
      const cleanup = new AbortController()
      const wake = (): void => {
        cleanup.abort()
        waiters.delete(wake)
        if (waiters.size === 0) bucket.waiters.delete(model)
        resolve()
      }
      waiters.add(wake)
      signal.addEventListener('abort', wake, { signal: cleanup.signal })
    })
  }

  /**
  Azure's documented burst rule over the bucket's trailing admissions: at
  most the sub-window's expected share of the observed per-minute request
  limit in any trailing 1-second or 10-second window. Past a share, the
  wait lasts until the oldest in-window admission ages out.
  */
  private azureBurstDelay(bucket: Bucket, now: number): { delayMs: number; windowMs: number } {
    let delayMs = 0
    let windowMs = AZURE_BURST_WINDOW_SHORT_MS
    for (const window of [AZURE_BURST_WINDOW_SHORT_MS, AZURE_BURST_WINDOW_LONG_MS]) {
      const share = azureBurstShare(bucket.requests, bucket.requestWindowMs, window)
      let inWindow = 0
      let oldest = now
      for (const admittedAt of bucket.admissions) {
        if (admittedAt <= now - window || admittedAt > now) continue
        inWindow += 1
        if (admittedAt < oldest) oldest = admittedAt
      }
      if (inWindow < share) continue
      const wait = oldest + window - now
      if (wait <= delayMs) continue
      delayMs = wait
      windowMs = window
    }
    return { delayMs, windowMs }
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
    onWait?: (delayMs: number, limit?: PacingWaitLimit) => void,
    options?: PacingAcquireOptions,
  ): Promise<(() => void) | undefined> {
    if (!Number.isSafeInteger(tokens) || tokens < 0) {
      throw new RangeError('Invalid pacing token estimate')
    }
    const provider = options?.provider
    const model = options?.model
    // DeepSeek documents account-level concurrency per model, not a rate
    // window (api-docs.deepseek.com/quick_start/rate_limit, read
    // 2026-10-23): the ceiling gates background admission, and every
    // admission holds a slot until the model response completes. The
    // foreground holds a slot without waiting, as with 429 pauses: its
    // own retry loop answers the provider's 429. One account key may mix
    // models, so slots are counted per model; a second key on the same
    // account keeps its own bucket, and the live 429 pause covers the
    // remainder of the account-wide limit.
    const concurrency =
      provider === 'deepseek' && model !== undefined ? deepseekConcurrencyLimit(model) : undefined
    for (;;) {
      signal.throwIfAborted()
      const bucket = this.bucket(account)
      const now = this.deps.now()
      const pause = Math.max(0, bucket.pausedUntil - now)
      // Foreground never joins the fan-out queue. Otherwise only what the
      // provider reported shapes the wait (owner 2026-10-16): no observed
      // limits means no queue at all — the first requests go out freely —
      // but a 429 pause holds even before the first headers. Its own HTTP
      // retry loop honours Retry-After; a sibling's 429 cannot delay the
      // user's turn.
      if (kind === 'foreground' || (pause === 0 && !bucket.observed)) {
        this.charge(bucket, tokens)
        if (provider === 'azure') bucket.admissions.push(now)
        return concurrency !== undefined && model !== undefined
          ? this.hold(account, model)
          : undefined
      }
      // A concurrency ceiling gates admission before the headroom math: no
      // free slot waits for a release, saying which provider limit holds
      // it. The slot itself is held only at admission below, never across
      // a headroom wait: held slots with nothing sent would starve the
      // requests whose completions free them.
      if (
        concurrency !== undefined &&
        model !== undefined &&
        (bucket.inflight.get(model) ?? 0) >= concurrency
      ) {
        onWait?.(0, { kind: 'concurrency', limit: concurrency })
        await this.untilReleased(bucket, model, signal)
        continue
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
      // Azure evaluates the incoming request rate over short sub-windows
      // (learn.microsoft.com/azure/foundry/openai/how-to/quota, read
      // 2026-10-23), so observed Azure limits additionally spread
      // admissions across the trailing 1-second and 10-second windows.
      // Unobserved buckets have no per-minute limit to share out, so no
      // burst math runs before the first headers.
      const burst =
        provider === 'azure' && bucket.observed ? this.azureBurstDelay(bucket, now) : undefined
      const burstWait = burst?.delayMs ?? 0
      const delay = Math.ceil(Math.max(pause, requestWait, tokenWait, burstWait))
      if (delay === 0) {
        this.charge(bucket, tokens)
        if (provider === 'azure') bucket.admissions.push(now)
        return concurrency !== undefined && model !== undefined
          ? this.hold(account, model)
          : undefined
      }
      // The wait names the provider-documented limit when one binds it; a
      // headroom or 429 wait keeps the established reason.
      onWait?.(
        delay,
        burst !== undefined &&
          burstWait > 0 &&
          burstWait >= pause &&
          burstWait >= requestWait &&
          burstWait >= tokenWait
          ? { kind: 'burst', windowMs: burst.windowMs }
          : undefined,
      )
      await this.deps.wait(delay, signal)
    }
  }
}
