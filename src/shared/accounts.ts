import { legacyUsdSchema, type UsdAmount } from './usdSchema'
// M108's local contracts, shared by every editor and the runtime. No vendor
// response is parsed here; live wire shapes remain with their captured codecs.
import * as z from 'zod/mini'
import { ACCOUNT_ID_PATTERN, ACCOUNT_LABEL_MAX_LENGTH, ACCOUNT_MAX_PER_PROVIDER } from './constants'

export const accountIdSchema = z.string().check(z.regex(ACCOUNT_ID_PATTERN))
const opaqueId = z
  .string()
  .check(z.minLength(1), z.maxLength(ACCOUNT_LABEL_MAX_LENGTH), z.regex(/^[A-Za-z0-9_-]+$/))
const count = z.int().check(z.nonnegative())
const amount = z.number().check(z.nonnegative())
// Spend caps and trigger spend carry canonical decimal strings; numeric
// persisted forms normalize once at this boundary, the way the other ports do.
const money = legacyUsdSchema
const percent = z.number().check(z.minimum(0), z.maximum(100))
export const accountPeriodSchema = z.enum(['day', 'week', 'month'])
const periodAmounts = z.strictObject({
  day: z.optional(money),
  week: z.optional(money),
  month: z.optional(money),
})
const periodCounts = z.strictObject({
  day: z.optional(count),
  week: z.optional(count),
  month: z.optional(count),
})

export const accountThresholdsSchema = z.strictObject({
  spendUsd: z.optional(periodAmounts),
  inputTokens: z.optional(periodCounts),
  outputTokens: z.optional(periodCounts),
  requests: z.optional(periodCounts),
  // Names identify captured windows locally, never a guessed vendor frame.
  planWindowPercent: z.optional(z.record(accountIdSchema, percent)),
  rateLimitHeadroomPercent: z.optional(
    z.strictObject({
      requests: z.optional(percent),
      tokens: z.optional(percent),
    }),
  ),
})
export type AccountThresholds = z.infer<typeof accountThresholdsSchema>

export const accountSchema = z.strictObject({
  id: accountIdSchema,
  label: z.string().check(
    z.minLength(1),
    z.maxLength(ACCOUNT_LABEL_MAX_LENGTH),
    z.refine((value) => value.trim().length > 0 && !/\p{Cc}/u.test(value)),
  ),
  order: count,
  limitGroup: z.optional(accountIdSchema),
  thresholds: accountThresholdsSchema,
})
export type Account = z.infer<typeof accountSchema>

export const accountPoolSchema = z.array(accountSchema).check(
  z.maxLength(ACCOUNT_MAX_PER_PROVIDER),
  z.refine((accounts) => new Set(accounts.map((account) => account.id)).size === accounts.length),
)

const spendCapTrigger = z.strictObject({
  kind: z.literal('userCap'),
  metric: z.literal('spendUsd'),
  period: accountPeriodSchema,
  value: money,
  threshold: money,
  resetAt: z.iso.datetime(),
})
const countCapTrigger = z.strictObject({
  kind: z.literal('userCap'),
  metric: z.enum(['inputTokens', 'outputTokens', 'requests']),
  period: accountPeriodSchema,
  value: count,
  threshold: count,
  resetAt: z.iso.datetime(),
})
export const accountTriggerSchema = z.union([
  spendCapTrigger,
  countCapTrigger,
  z.strictObject({
    kind: z.literal('vendorLimit'),
    reason: z.enum(['planWindow', 'rateLimitHeadroom', 'rateLimited', 'quota', 'usageLimit']),
    resetAt: z.nullable(z.iso.datetime()),
  }),
])
export type AccountTrigger = z.infer<typeof accountTriggerSchema>

// Persisted events hold opaque ids only. Labels are resolved by the local UI.
const eventFields = { provider: accountIdSchema, account: accountIdSchema, time: z.iso.datetime() }
export const accountEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...eventFields,
    type: z.literal('swap'),
    previousAccount: accountIdSchema,
    trigger: accountTriggerSchema,
    coldCacheUsd: amount,
  }),
  z.strictObject({ ...eventFields, type: z.literal('spread'), workerId: opaqueId }),
  z.strictObject({ ...eventFields, type: z.literal('stop'), trigger: accountTriggerSchema }),
])
export type AccountEvent = z.infer<typeof accountEventSchema>

export const accountConfirmationChoiceSchema = z.enum(['confirm', 'ownCapsOnly', 'cancel'])
export const accountConfirmationSchema = z.strictObject({
  machineId: opaqueId,
  provider: accountIdSchema,
  product: accountIdSchema,
  recordVersion: z.string().check(z.minLength(1), z.maxLength(ACCOUNT_LABEL_MAX_LENGTH)),
  recordCheckedAt: z.iso.date(),
  answeredAt: z.iso.datetime(),
  choice: accountConfirmationChoiceSchema,
})
export type AccountConfirmation = z.infer<typeof accountConfirmationSchema>

// Injected seams for T/P/J. Settled, reserved and uncertain liability remain
// attributed to the account that incurred them, across a pool change.
export interface AccountUsageQuery {
  readonly provider: string
  readonly account: string
  readonly start: string
  readonly end: string
}
export interface AccountUsageTotals {
  readonly settledUsd: UsdAmount
  readonly reservedUsd: UsdAmount
  readonly uncertainUsd: UsdAmount
  readonly inputTokens: number
  readonly outputTokens: number
  readonly requests: number
}
export interface AccountJournalReader {
  read(query: AccountUsageQuery): AccountUsageTotals
}
