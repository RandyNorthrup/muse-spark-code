// Translators consume the existing captured/normalized owner contracts.
import type { SubscriptionUsage } from '../../shared/usage'
import { subscriptionUsageSchema } from '../../shared/usage'
import { usageLimitSnapshotSchema, type UsageLimitSnapshot } from '../../shared/usageJournal'
import { accountLimitsSnapshotSchema, type AccountLimitsSnapshot } from '../accounts/thresholds'
import { SECONDS_PER_MINUTE } from '../../shared/constants'
import {
  estimateLimitFactSchema,
  type EstimateLimitFact,
  type EstimateAccountOwner,
} from '../../shared/estimateFacts'

export class EstimateFactSourceError extends Error {
  constructor(readonly source: string) {
    super(source)
    this.name = 'EstimateFactSourceError'
  }
}
function refuse(source: string): never {
  throw new EstimateFactSourceError(source)
}
function instant(value: number, source: string): string {
  if (value < 0 || !Number.isFinite(new Date(value).getTime())) refuse(source)
  return new Date(value).toISOString()
}
function checked(fact: EstimateLimitFact, source: string): EstimateLimitFact {
  const result = estimateLimitFactSchema.safeParse(fact)
  if (!result.success) refuse(source)
  return result.data
}
interface AccountInput {
  readonly owner: EstimateAccountOwner
  readonly observedAt: number
}
function fact(
  input: AccountInput,
  metric: string,
  source: EstimateLimitFact['observedBy'],
): EstimateLimitFact {
  return {
    owner: input.owner,
    metric,
    unit: 'percent',
    used: null,
    limit: null,
    remaining: null,
    window: { startsAt: null, resetsAt: null, periodSeconds: null },
    observedAt: instant(input.observedAt, source),
    observedBy: source,
  }
}
function limits(input: AccountInput & { snapshot: AccountLimitsSnapshot }): EstimateLimitFact[] {
  const source = 'account-limits'
  const result = accountLimitsSnapshotSchema.safeParse(input.snapshot)
  if (!result.success) refuse(source)
  const rows: EstimateLimitFact[] = []
  for (const unit of ['requests', 'tokens'] as const) {
    const bucket = result.data.rateLimits?.[unit]
    if (bucket !== undefined)
      rows.push(
        checked(
          {
            ...fact(input, unit, source),
            unit,
            used: bucket.limit - bucket.remaining,
            limit: bucket.limit,
            remaining: bucket.remaining,
            window: { startsAt: null, resetsAt: bucket.resetAt, periodSeconds: null },
          },
          source,
        ),
      )
  }
  const windows = Object.entries(result.data.planWindows ?? {})
  for (const [metric, window] of windows)
    rows.push(
      checked(
        {
          ...fact(input, metric, source),
          used: window.usedPercent,
          limit: 100,
          remaining: 100 - window.usedPercent,
          window: {
            startsAt: null,
            resetsAt: window.resetAt,
            periodSeconds:
              window.windowDurationMins === undefined
                ? null
                : window.windowDurationMins * SECONDS_PER_MINUTE,
          },
        },
        source,
      ),
    )
  if (result.data.blocked !== undefined)
    rows.push(
      checked(
        {
          ...fact(input, 'blocked', source),
          remaining: 0,
          window: { startsAt: null, resetsAt: result.data.blocked.resetAt, periodSeconds: null },
        },
        source,
      ),
    )
  return rows
}
function observation(input: AccountInput & { snapshot: UsageLimitSnapshot }): EstimateLimitFact[] {
  const source = 'usage-changed'
  const result = usageLimitSnapshotSchema.safeParse(input.snapshot)
  if (!result.success) refuse(source)
  // Validate every timestamp, including metadata and fields not used for admission.
  instant(result.data.at, source)
  instant(result.data.observedAt, source)
  const rows = result.data.windows.map((window) =>
    checked(
      {
        ...fact({ ...input, observedAt: result.data.observedAt }, window.id, source),
        used: window.usedPercent,
        limit: 100,
        remaining: Math.max(0, 100 - window.usedPercent),
        window: {
          startsAt: null,
          resetsAt: window.resetsAt === undefined ? null : instant(window.resetsAt, source),
          periodSeconds:
            window.windowMins === undefined ? null : window.windowMins * SECONDS_PER_MINUTE,
        },
      },
      source,
    ),
  )
  const account = result.data.account
  if (account !== undefined)
    rows.push(
      checked(
        {
          ...fact({ ...input, observedAt: result.data.observedAt }, 'balance', source),
          unit: 'usd',
          used: account.usedUsd ?? null,
          limit: account.limitUsd ?? null,
          remaining: account.remainingUsd ?? null,
        },
        source,
      ),
    )
  return rows
}
function usage(input: AccountInput & { snapshot: SubscriptionUsage }): EstimateLimitFact[] {
  const source = 'usage-read'
  const result = subscriptionUsageSchema.safeParse(input.snapshot)
  if (!result.success) refuse(source)
  const value = result.data
  return usageWindows(input, value)
}
function usageWindows(input: AccountInput, value: SubscriptionUsage): EstimateLimitFact[] {
  const windows: readonly [
    string,
    { usedPercent: number; resetsAtMs: number; windowDurationMins?: number },
  ][] = [
    ['window', value.window],
    ['weekly', value.weekly],
  ]
  return windows.map(([metric, window]) =>
    checked(
      {
        ...fact({ ...input, observedAt: value.observedAtMs }, metric, 'usage-read'),
        used: window.usedPercent,
        limit: 100,
        remaining: Math.max(0, 100 - window.usedPercent),
        window: {
          startsAt: null,
          resetsAt: instant(window.resetsAtMs, 'usage-read'),
          periodSeconds:
            window.windowDurationMins === undefined
              ? null
              : window.windowDurationMins * SECONDS_PER_MINUTE,
        },
      },
      'usage-read',
    ),
  )
}
function machine(input: {
  id: string
  observedAt: number
  cpuMaxPercent: number
  memoryMaxPercent: number
}): EstimateLimitFact[] {
  return (['cpu', 'memory'] as const).map((metric) =>
    checked(
      {
        owner: { kind: 'machine', id: input.id, providerId: null, generation: null },
        metric,
        unit: 'percent',
        used: null,
        remaining: null,
        limit: metric === 'cpu' ? input.cpuMaxPercent : input.memoryMaxPercent,
        window: { startsAt: null, resetsAt: null, periodSeconds: null },
        observedAt: instant(input.observedAt, 'configuration'),
        observedBy: 'configuration',
      },
      'configuration',
    ),
  )
}
/** One translator table; observation handles every normalized vendor/source by fields. */
export const ESTIMATE_FACT_TRANSLATORS = { limits, observation, usage, machine }
