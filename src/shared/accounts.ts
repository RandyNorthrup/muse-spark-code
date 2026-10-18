import { legacyUsdSchema, type UsdAmount } from './usdSchema'
// M108's local contracts, shared by every editor and the runtime. No vendor
// response is parsed here; live wire shapes remain with their captured codecs.
import * as z from 'zod/mini'
import { ACCOUNT_LABEL_MAX_LENGTH } from './constants'
import { accountIdSchema } from './accountId'
export { accountIdSchema } from './accountId'
const opaqueId = /* @__PURE__ */ z
  .string()
  .check(z.minLength(1), z.maxLength(ACCOUNT_LABEL_MAX_LENGTH), z.regex(/^[A-Za-z0-9_-]+$/))
const count = /* @__PURE__ */ z.int().check(z.nonnegative())
// Spend caps, trigger spend and swap cold-cache estimates carry canonical
// decimal strings; numeric persisted forms normalize once at this boundary,
// the way the other ports do.
const money = legacyUsdSchema
const percent = /* @__PURE__ */ z.number().check(z.minimum(0), z.maximum(100))
export const accountPeriodSchema = /* @__PURE__ */ z.enum(['day', 'week', 'month'])
const periodAmounts = /* @__PURE__ */ z.strictObject({
  day: z.optional(money),
  week: z.optional(money),
  month: z.optional(money),
})
const periodCounts = /* @__PURE__ */ z.strictObject({
  day: z.optional(count),
  week: z.optional(count),
  month: z.optional(count),
})

export const accountThresholdsSchema = /* @__PURE__ */ z.strictObject({
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

export const accountSchema = /* @__PURE__ */ z.strictObject({
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

// D121: a pool holds any number of accounts — the removed 64-per-provider
// ceiling was invented — so only duplicate ids refuse.
export const accountPoolSchema = /* @__PURE__ */ z
  .array(accountSchema)
  .check(
    z.refine((accounts) => new Set(accounts.map((account) => account.id)).size === accounts.length),
  )

const spendCapTrigger = /* @__PURE__ */ z.strictObject({
  kind: z.literal('userCap'),
  metric: z.literal('spendUsd'),
  period: accountPeriodSchema,
  value: money,
  threshold: money,
  resetAt: z.iso.datetime(),
})
const countCapTrigger = /* @__PURE__ */ z.strictObject({
  kind: z.literal('userCap'),
  metric: z.enum(['inputTokens', 'outputTokens', 'requests']),
  period: accountPeriodSchema,
  value: count,
  threshold: count,
  resetAt: z.iso.datetime(),
})
export const accountTriggerSchema = /* @__PURE__ */ z.union([
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
export const accountEventSchema = /* @__PURE__ */ z.discriminatedUnion('type', [
  z.strictObject({
    ...eventFields,
    type: z.literal('swap'),
    previousAccount: accountIdSchema,
    trigger: accountTriggerSchema,
    coldCacheUsd: money,
  }),
  z.strictObject({ ...eventFields, type: z.literal('spread'), workerId: opaqueId }),
  z.strictObject({ ...eventFields, type: z.literal('stop'), trigger: accountTriggerSchema }),
])
export type AccountEvent = z.infer<typeof accountEventSchema>

export const accountConfirmationChoiceSchema = /* @__PURE__ */ z.enum([
  'confirm',
  'ownCapsOnly',
  'cancel',
])
export const accountConfirmationSchema = /* @__PURE__ */ z.strictObject({
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
