import { Usd, legacyUsdSchema, sumUsd as sumExactUsd } from '../../shared/usd'
// D88.3–4: local admission data, supplied by the journal and captured codecs.
// This module never parses a vendor frame or chooses another account.
import * as z from 'zod/mini'
import {
  accountIdSchema,
  accountThresholdsSchema,
  type Account,
  type AccountJournalReader,
  type AccountTrigger,
  type AccountUsageTotals,
} from '../../shared/accounts'
import { DAYS_PER_WEEK, UI_TEXT } from '../../shared/constants'
import { multiplyUsd, parseUsd, usdNumber } from '../../shared/accountUsd'

const amount = legacyUsdSchema
const count = z.int().check(z.nonnegative())
const totalsSchema = z.strictObject({
  settledUsd: amount,
  reservedUsd: amount,
  uncertainUsd: amount,
  inputTokens: count,
  outputTokens: count,
  requests: count,
})
const resetAt = z.nullable(z.iso.datetime())
const windowSchema = z.strictObject({
  usedPercent: z.number().check(z.minimum(0), z.maximum(100)),
  resetAt,
})
const bucketSchema = z.strictObject({
  limit: z.int().check(z.positive()),
  remaining: count,
  resetAt: z.iso.datetime(),
})
const limitsSchema = z.strictObject({
  planWindows: z.optional(z.record(accountIdSchema, windowSchema)),
  rateLimits: z.optional(
    z.strictObject({ requests: z.optional(bucketSchema), tokens: z.optional(bucketSchema) }),
  ),
  blocked: z.optional(
    z.strictObject({ reason: z.enum(['rateLimited', 'quota', 'usageLimit']), resetAt }),
  ),
})

/** Normalized local snapshots, produced only by each provider's captured codec. */
export type AccountLimitsSnapshot = z.infer<typeof limitsSchema>
export interface AccountLimitsReader {
  /** Must be scoped by both identities; an absent configured metric refuses admission. */
  read(provider: string, account: string): AccountLimitsSnapshot
}

/** A structured stop which P can route through its vendor policy before swapping. */
export class AccountThresholdExceededError extends Error {
  public constructor(public readonly trigger: AccountTrigger) {
    super(trigger.kind === 'vendorLimit' ? UI_TEXT.accounts.vendorLimit : UI_TEXT.accounts.userCap)
    this.name = 'AccountThresholdExceededError'
  }
}

function unavailable(): never {
  throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
}

function periodRange(period: 'day' | 'week' | 'month', now: number) {
  const start = new Date(now)
  if (period === 'month') start.setDate(1)
  // ISO week, in local calendar time. Calendar arithmetic keeps DST days intact.
  else if (period === 'week')
    start.setDate(start.getDate() - ((start.getDay() + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK))
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  if (period === 'month') end.setMonth(end.getMonth() + 1)
  else end.setDate(end.getDate() + (period === 'week' ? DAYS_PER_WEEK : 1))
  // A skipped midnight normalizes to 01:00; do not carry it to another date.
  end.setHours(0, 0, 0, 0)
  return { start: start.toISOString(), end: end.toISOString() }
}

/** Every reached threshold, vendor limits first so a user cap cannot hide one. */
export function evaluateAccountThresholds(deps: {
  readonly provider: string
  readonly account: Pick<Account, 'id' | 'thresholds'>
  readonly now: number
  readonly journal: AccountJournalReader
  readonly limits?: AccountLimitsReader
  /** Not yet in the reader's totals (or exclude this request's owned claim).
   * Equality may admit the last request; a reached cap cannot admit another. */
  readonly request?: AccountUsageTotals
}): readonly AccountTrigger[] {
  if (
    !accountIdSchema.safeParse(deps.provider).success ||
    !accountIdSchema.safeParse(deps.account.id).success ||
    !Number.isFinite(new Date(deps.now).getTime())
  )
    unavailable()
  const parsed = accountThresholdsSchema.safeParse(deps.account.thresholds)
  if (!parsed.success) unavailable()
  const thresholds = parsed.data
  const request = totalsSchema.safeParse(
    deps.request ?? {
      settledUsd: '0',
      reservedUsd: '0',
      uncertainUsd: '0',
      inputTokens: 0,
      outputTokens: 0,
      requests: 0,
    },
  )
  if (!request.success) unavailable()
  const triggers: AccountTrigger[] = []
  const requiresLimits =
    Object.keys(thresholds.planWindowPercent ?? {}).length > 0 ||
    Object.values(thresholds.rateLimitHeadroomPercent ?? {}).some((value) => value !== undefined)
  if (requiresLimits && deps.limits === undefined) unavailable()
  if (deps.limits !== undefined) {
    const result = limitsSchema.safeParse(deps.limits.read(deps.provider, deps.account.id))
    if (!result.success) unavailable()
    const snapshot = result.data
    const isActive = (reset: string | null) => reset === null || Date.parse(reset) > deps.now
    if (snapshot.blocked !== undefined && isActive(snapshot.blocked.resetAt)) {
      triggers.push({ kind: 'vendorLimit', ...snapshot.blocked })
    }
    const windows = Object.entries(thresholds.planWindowPercent ?? {})
    for (const [name, threshold] of windows) {
      const window = snapshot.planWindows?.[name]
      if (window === undefined) unavailable()
      if (isActive(window.resetAt) && window.usedPercent >= threshold)
        triggers.push({ kind: 'vendorLimit', reason: 'planWindow', resetAt: window.resetAt })
    }
    for (const metric of ['requests', 'tokens'] as const) {
      const threshold = thresholds.rateLimitHeadroomPercent?.[metric]
      if (threshold === undefined) continue
      const bucket = snapshot.rateLimits?.[metric]
      if (bucket === undefined || bucket.remaining > bucket.limit) unavailable()
      const percent = parseUsd(threshold)
      if (usdNumber(percent) !== threshold) unavailable()
      if (
        isActive(bucket.resetAt) &&
        multiplyUsd(parseUsd(100), BigInt(bucket.remaining)) <=
          multiplyUsd(percent, BigInt(bucket.limit))
      )
        triggers.push({ kind: 'vendorLimit', reason: 'rateLimitHeadroom', resetAt: bucket.resetAt })
    }
  }
  for (const period of ['day', 'week', 'month'] as const) {
    const metrics = ['spendUsd', 'inputTokens', 'outputTokens', 'requests'] as const
    if (metrics.every((metric) => thresholds[metric]?.[period] === undefined)) continue
    const range = periodRange(period, deps.now)
    const result = totalsSchema.safeParse(
      deps.journal.read({
        provider: deps.provider,
        account: deps.account.id,
        ...range,
      }),
    )
    if (!result.success) unavailable()
    const totals = result.data
    const spend = Usd.from(sumExactUsd(totals.settledUsd, totals.reservedUsd, totals.uncertainUsd))
    const pendingSpend = Usd.from(
      sumExactUsd(request.data.settledUsd, request.data.reservedUsd, request.data.uncertainUsd),
    )
    for (const metric of metrics) {
      const threshold = thresholds[metric]?.[period]
      if (threshold === undefined) continue
      const isReached =
        metric === 'spendUsd'
          ? spend.compare(Usd.from(threshold)) >= 0 ||
            spend.add(pendingSpend).compare(Usd.from(threshold)) > 0
          : totals[metric] >= threshold || totals[metric] + request.data[metric] > threshold
      const projected =
        metric === 'spendUsd'
          ? spend.add(pendingSpend).toAmount()
          : totals[metric] + request.data[metric]
      if (metric !== 'spendUsd' && !Number.isSafeInteger(projected)) unavailable()
      if (isReached && !Number.isFinite(Number(projected))) unavailable()
      if (isReached)
        triggers.push({
          kind: 'userCap',
          metric,
          period,
          // Trigger values are the existing numeric reporting projection, never admission input.
          value: Number(projected),
          threshold,
          resetAt: range.end,
        })
    }
  }
  return triggers
}
