// M106, D86.6: one shared per-provider/key bucket. Only U12's captured
// Meta headers are interpreted here; another provider supplies its own
// captured interpreter through the client's capability port.
import * as z from 'zod/mini'
import { PACING_START_REQUESTS_PER_MINUTE, PACING_WINDOW_MS } from '../../../shared/constants'

export type PacingClass = 'foreground' | 'subagent' | 'bestOfN' | 'team' | 'judge' | 'schedule'

const limitsSchema = z.strictObject({
  requests: z.int().check(z.gt(0)),
  remainingRequests: z.int().check(z.gte(0)),
  tokens: z.int().check(z.gt(0)),
  remainingTokens: z.int().check(z.gte(0)),
  windowMs: z.optional(z.int().check(z.gt(0))),
})
export type PacingLimits = z.infer<typeof limitsSchema>

/** Decimal integers only: absent, blank, exponent and partial values are not limits. */
function headerCount(headers: Headers, name: string): number {
  const value = headers.get(name)
  return value !== null && /^\d+$/.test(value) ? Number(value) : NaN
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
  windowMs: number
  requests: number
  remainingRequests: number
  tokens: number | undefined
  remainingTokens: number | undefined
  updatedAt: number
  pausedUntil: number
}

/** A portable admission port for team pools, judges and scheduled dispatchers. */
export interface RequestPacer {
  acquire(account: string, kind: PacingClass, tokens: number, signal: AbortSignal): Promise<void>
  observe(account: string, limits: PacingLimits | undefined, retryAfterMs?: number): void
}

export class ModelApiPacing implements RequestPacer {
  private readonly buckets = new Map<string, Bucket>()

  public constructor(private readonly deps: PacingDeps) {}

  private bucket(account: string): Bucket {
    let bucket = this.buckets.get(account)
    if (bucket === undefined) {
      bucket = {
        windowMs: PACING_WINDOW_MS,
        requests: PACING_START_REQUESTS_PER_MINUTE,
        remainingRequests: PACING_START_REQUESTS_PER_MINUTE,
        tokens: undefined,
        remainingTokens: undefined,
        updatedAt: this.deps.now(),
        pausedUntil: 0,
      }
      this.buckets.set(account, bucket)
    }
    const now = this.deps.now()
    const elapsed = Math.max(0, now - bucket.updatedAt)
    bucket.remainingRequests = Math.min(
      bucket.requests,
      bucket.remainingRequests + (elapsed * bucket.requests) / bucket.windowMs,
    )
    if (bucket.tokens !== undefined && bucket.remainingTokens !== undefined) {
      bucket.remainingTokens = Math.min(
        bucket.tokens,
        bucket.remainingTokens + (elapsed * bucket.tokens) / bucket.windowMs,
      )
    }
    bucket.updatedAt = now
    return bucket
  }

  private charge(bucket: Bucket, tokens: number): void {
    bucket.remainingRequests = Math.max(0, bucket.remainingRequests - 1)
    if (bucket.remainingTokens !== undefined) {
      bucket.remainingTokens = Math.max(0, bucket.remainingTokens - tokens)
    }
  }

  /** Header snapshots replace both limits live. A 429 pauses even when its headers are absent. */
  public observe(account: string, limits: PacingLimits | undefined, retryAfterMs = 0): void {
    const bucket = this.bucket(account)
    if (limits !== undefined) {
      const checked = limitsSchema.parse(limits)
      bucket.windowMs = checked.windowMs ?? PACING_WINDOW_MS
      bucket.requests = checked.requests
      bucket.remainingRequests = Math.min(checked.remainingRequests, checked.requests)
      bucket.tokens = checked.tokens
      bucket.remainingTokens = Math.min(checked.remainingTokens, checked.tokens)
    }
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      bucket.pausedUntil = Math.max(bucket.pausedUntil, this.deps.now() + retryAfterMs)
    }
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
  ): Promise<void> {
    if (!Number.isSafeInteger(tokens) || tokens < 0) {
      throw new RangeError('Invalid pacing token estimate')
    }
    for (;;) {
      signal.throwIfAborted()
      const bucket = this.bucket(account)
      const pause = Math.max(0, bucket.pausedUntil - this.deps.now())
      // Foreground never joins the fan-out queue. Its own HTTP retry loop
      // honours Retry-After; a sibling's 429 cannot delay the user's turn.
      if (kind === 'foreground') {
        this.charge(bucket, tokens)
        return
      }
      if (bucket.tokens !== undefined && tokens > bucket.tokens) {
        throw new RangeError('Fan-out request exceeds the observed token limit')
      }
      // Keep one request for the foreground. A one-RPM key can still run
      // background work once full; foreground always bypasses this check.
      const requiredRequests = Math.min(2, bucket.requests)
      const requestWait =
        (Math.max(0, requiredRequests - bucket.remainingRequests) * bucket.windowMs) /
        bucket.requests
      const tokenWait =
        bucket.tokens === undefined || bucket.remainingTokens === undefined
          ? 0
          : (Math.max(0, tokens - bucket.remainingTokens) * bucket.windowMs) / bucket.tokens
      const delay = Math.ceil(Math.max(pause, requestWait, tokenWait))
      if (delay === 0) {
        this.charge(bucket, tokens)
        return
      }
      await this.deps.wait(delay, signal)
    }
  }
}
