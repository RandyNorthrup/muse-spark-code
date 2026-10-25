// M102 / D82: the same page/service boundary in every editor and the CLI.
// These are our aggregate contracts, not guessed provider response shapes.
import * as z from 'zod/mini'
import { isUsageText } from './l10n/usageTable'
import type { UsageText } from './l10n/usageEn'
import { USAGE_DETAIL_DAYS, USAGE_HISTORY_DAY_MIN, USAGE_JOURNAL_VERSION } from './constants'
import {
  usageAmountSchema,
  usageCertaintySchema,
  usageCountSchema,
  usageDaySchema,
  usageIdSchema,
  usageKindSchema,
  usageLabelSchema,
  usageLimitSnapshotSchema,
  usageTokensSchema,
  usageUnitsSchema,
  usageUsdSchema,
} from './usageJournal'
import { resourceHistorySchema } from './resourceHistory'

export const usageGroupBySchema = /* @__PURE__ */ z.enum(['provider', 'model', 'kind', 'client'])
export const usageMetricSchema = /* @__PURE__ */ z.enum(['cost', 'tokens', 'requests', 'time'])
export const usageQuerySchema = /* @__PURE__ */ z
  .strictObject({
    range: z.enum(['today', '7d', '30d', '90d', 'custom']),
    // Inclusive local dates. Presets are resolved by the service's clock.
    from: z.optional(usageDaySchema),
    to: z.optional(usageDaySchema),
    groupBy: usageGroupBySchema,
    metric: usageMetricSchema,
  })
  .check(
    z.refine(
      (query) =>
        query.range !== 'custom' ||
        (query.from !== undefined && query.to !== undefined && query.from <= query.to),
    ),
  )
export type UsageQuery = z.infer<typeof usageQuerySchema>
export const usageExportFormatSchema = /* @__PURE__ */ z.enum(['callsCsv', 'summaryCsv', 'json'])

const certaintyTotalSchema = /* @__PURE__ */ z.strictObject({
  certainty: usageCertaintySchema,
  records: usageCountSchema,
  usd: z.optional(usageUsdSchema),
  apiEquivalentUsd: z.optional(usageUsdSchema),
  /**
  C-M95-SUB: set only on plan-certainty rows, naming the provider whose
  plan billed them, so a Meta plan row reads "Muse Code plan" while any
  other plan row keeps the shared "Plan". Absent on older rows, which
  keep the shared label.
  */
  provider: z.optional(usageLabelSchema),
})
export const usageTotalsSchema = /* @__PURE__ */ z.strictObject({
  records: usageCountSchema,
  tokens: usageTokensSchema,
  units: usageUnitsSchema,
  costs: z.array(certaintyTotalSchema),
  durationMs: z.optional(usageAmountSchema),
  firstTokenMs: z.optional(usageAmountSchema),
  p50Ms: z.optional(usageAmountSchema),
  p95Ms: z.optional(usageAmountSchema),
  retries: usageCountSchema,
  rateLimited: usageCountSchema,
  packedAvoided: z.optional(usageCountSchema),
  cacheHitPercent: z.optional(usageAmountSchema),
  tokensPerSecond: z.optional(usageAmountSchema),
})
export type UsageTotals = z.infer<typeof usageTotalsSchema>
const breakdownRowSchema = /* @__PURE__ */ z.strictObject({
  id: usageLabelSchema,
  label: usageLabelSchema,
  provider: z.optional(usageLabelSchema),
  model: z.optional(usageLabelSchema),
  totals: usageTotalsSchema,
})
const bucketSchema = /* @__PURE__ */ z.strictObject({
  at: usageCountSchema,
  day: usageDaySchema,
  // Date.getTimezoneOffset() of the records behind this bucket, so the hour
  // label keeps the timezone they were written in. Absent for rollup months.
  timezoneOffsetMins: z.optional(z.int()),
  totals: usageTotalsSchema,
  groups: z.array(breakdownRowSchema),
})
export const usageBudgetSchema = /* @__PURE__ */ z.strictObject({
  id: usageIdSchema,
  kind: z.enum(['paidDaily', 'tabDaily', 'vscodeChatDaily', 'conversation', 'headless']),
  spentUsd: usageUsdSchema,
  capUsd: z.optional(usageUsdSchema),
  uncertainUsd: z.optional(usageUsdSchema),
  reservedUsd: z.optional(usageUsdSchema),
  /** Calls that went out and reported no usage: counted, never costed. */
  unknownChargeCalls: z.optional(usageCountSchema),
  stopped: z.boolean(),
  raisedToday: z.optional(z.boolean()),
  projectedUsd: z.optional(usageUsdSchema),
  resetsAt: z.optional(usageCountSchema),
})
const modelDetailSchema = /* @__PURE__ */ z.strictObject({
  provider: usageLabelSchema,
  model: usageLabelSchema,
  totals: usageTotalsSchema,
  trend: z.array(bucketSchema),
  price: z.optional(
    z.strictObject({
      inputPerMillion: z.optional(usageAmountSchema),
      cachedPerMillion: z.optional(usageAmountSchema),
      cacheWritePerMillion: z.optional(usageAmountSchema),
      cacheWrite1hPerMillion: z.optional(usageAmountSchema),
      cacheWrite12hPerMillion: z.optional(usageAmountSchema),
      outputPerMillion: z.optional(usageAmountSchema),
      source: z.enum(['list', 'catalogue', 'user', 'meta-published']),
      date: usageDaySchema,
    }),
  ),
  pricedLater: z.boolean(),
})
export const usagePageStateSchema = /* @__PURE__ */ z.strictObject({
  v: z.literal(USAGE_JOURNAL_VERSION),
  query: usageQuerySchema,
  generatedAt: usageCountSchema,
  capabilities: z.optional(
    z.strictObject({
      settings: z.boolean(),
      folder: z.boolean(),
      models: z.boolean(),
      export: z.boolean(),
      deleteHistory: z.boolean(),
      setHistory: z.boolean(),
      external: z.boolean(),
      exportMaxBytes: z.optional(usageCountSchema),
    }),
  ),
  history: z.strictObject({
    enabled: z.boolean(),
    host: usageLabelSchema,
    detailDays: z.literal(USAGE_DETAIL_DAYS),
    // NOLIMITSSET (PLAN.md D121): null keeps every day — no day count of ours.
    historyDays: z.nullable(z.int().check(z.gte(USAGE_HISTORY_DAY_MIN))),
    recordCount: usageCountSchema,
    newerVersionRecords: usageCountSchema,
    tornLines: usageCountSchema,
    // M121: version 1 records whose written dollars a number cannot carry.
    inexactRecords: usageCountSchema,
    since: z.optional(usageDaySchema),
  }),
  totals: usageTotalsSchema,
  previousTotals: usageTotalsSchema,
  buckets: z.array(bucketSchema),
  breakdown: z.array(breakdownRowSchema),
  features: z.array(z.strictObject({ kind: usageKindSchema, totals: usageTotalsSchema })),
  limits: z.array(usageLimitSnapshotSchema),
  budgets: z.array(usageBudgetSchema),
  // Only providers lacking a captured limit get these honest unknown rows.
  unreportedLimits: z.array(
    z.strictObject({
      provider: usageLabelSchema,
      consoleUrl: z.optional(
        z.url().check(
          z.refine((value) => {
            if (!URL.canParse(value)) return false
            const url = new URL(value)
            return url.protocol === 'https:' && url.username === '' && url.password === ''
          }),
        ),
      ),
    }),
  ),
  attempts: z.array(
    z.strictObject({
      day: usageDaySchema,
      origin: z.enum(['turn', 'reminder', 'subagent']),
      attempts: usageCountSchema,
    }),
  ),
  // The trace-log read behind `attempts`: absent when fresh. `stale`: a log
  // kept changing while read, so the counts may be behind. `unavailable`:
  // the trace folder could not be read at all; the journal above stands.
  traceNotice: z.optional(z.enum(['stale', 'unavailable'])),
  // The cost-journal read behind the totals above: absent when it read.
  // `unavailable`: the journal could not be read, so the totals are empty
  // and only the trace attempts (with their own notice) stand.
  journalNotice: z.optional(z.enum(['unavailable'])),
  savings: z.strictObject({
    cachedTokens: z.optional(usageCountSchema),
    cacheUsd: z.optional(usageUsdSchema),
    packedAvoided: z.optional(usageCountSchema),
  }),
  modelDetail: z.optional(modelDetailSchema),
  // M107 J: the machine's resource history. Absent: this host reads no resource
  // journal. null: the journal could not be read, shown as unavailable.
  resources: z.optional(z.nullable(resourceHistorySchema)),
})
export type UsagePageState = z.infer<typeof usagePageStateSchema>

export const usagePageToServiceMessageSchema = /* @__PURE__ */ z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('usage/ready') }),
  z.strictObject({ type: z.literal('usage/query'), query: usageQuerySchema }),
  z.strictObject({ type: z.literal('usage/refresh') }),
  z.strictObject({
    type: z.literal('usage/export'),
    requestId: usageIdSchema,
    query: usageQuerySchema,
    format: usageExportFormatSchema,
  }),
  // The service's confirm port asks with the actual count. No page-supplied
  // path or approval can authorise deleting a spend ledger.
  z.strictObject({ type: z.literal('usage/deleteHistory'), requestId: usageIdSchema }),
  z.strictObject({ type: z.literal('usage/setHistory'), enabled: z.boolean() }),
  z.strictObject({ type: z.literal('usage/openSettings') }),
  z.strictObject({ type: z.literal('usage/revealFolder') }),
  z.strictObject({
    type: z.literal('usage/openModels'),
    provider: usageLabelSchema,
    model: z.optional(usageLabelSchema),
  }),
  z.strictObject({ type: z.literal('usage/openExternal'), url: z.url() }),
  z.strictObject({
    type: z.literal('usage/modelDetail'),
    provider: usageLabelSchema,
    model: usageLabelSchema,
  }),
])
export type UsagePageToServiceMessage = z.infer<typeof usagePageToServiceMessageSchema>
export const usageServiceToPageMessageSchema = /* @__PURE__ */ z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('usage/state'), state: usagePageStateSchema }),
  z.strictObject({
    type: z.literal('usage/result'),
    requestId: usageIdSchema,
    action: z.enum(['export', 'deleteHistory']),
    outcome: z.enum(['completed', 'cancelled']),
  }),
  z.strictObject({
    type: z.literal('usage/error'),
    requestId: z.optional(usageIdSchema),
    code: z.enum([
      'invalidMessage',
      'readFailed',
      'writeFailed',
      'exportRange',
      'exportTooLarge',
      'unsupported',
    ]),
  }),
  z.strictObject({
    type: z.literal('usage/table'),
    locale: usageLabelSchema,
    // The usage table loader validates its key/slot/plural shape separately.
    table: z.custom<UsageText>((value) => isUsageText(value, 'en')),
  }),
])
export type UsageServiceToPageMessage = z.infer<typeof usageServiceToPageMessageSchema>

export type UsagePageParseResult<T> =
  { readonly ok: true; readonly message: T } | { readonly ok: false; readonly error: string }
function parseWith<T>(schema: z.ZodMiniType<T>, input: unknown): UsagePageParseResult<T> {
  const result = schema.safeParse(input)
  return result.success
    ? { ok: true, message: result.data }
    : { ok: false, error: z.prettifyError(result.error) }
}
export function parseUsagePageToServiceMessage(
  input: unknown,
): UsagePageParseResult<UsagePageToServiceMessage> {
  return parseWith(usagePageToServiceMessageSchema, input)
}
export function parseUsageServiceToPageMessage(
  input: unknown,
): UsagePageParseResult<UsageServiceToPageMessage> {
  return parseWith(usageServiceToPageMessageSchema, input)
}
