// M102 / D82: our private on-disk format, not a provider wire parser.
// Canonical Usage already includes cached/write input and reasoning output.
// Optional counters remain absent when unknown. Strict objects reject content,
// paths, credentials and account identifiers rather than silently storing them.
import * as z from 'zod/mini'
import { nonnegativeUsdSchema, type legacyUsdSchema } from './usdSchema'
import { accountIdSchema } from './accountId'
import {
  USAGE_HEADER_MAX_CHARS,
  USAGE_ID_MAX_CHARS,
  USAGE_JOURNAL_VERSION,
  USAGE_LABEL_MAX_CHARS,
  USAGE_RECORD_MAX_BYTES,
} from './constants'

export const USAGE_KINDS = [
  'turn',
  'compaction',
  'sideChat',
  'subagent',
  'worker',
  'reviewer',
  'bestOfN',
  'tab',
  'schedule',
  'vscodeChat',
  'hook',
  'search',
  'image',
  'voice',
  'count',
] as const
export const USAGE_CERTAINTIES = [
  'reported',
  'computed',
  'uncertain',
  'plan',
  'local',
  'unpriced',
  'estimated',
] as const
export const usageKindSchema = /* @__PURE__ */ z.enum(USAGE_KINDS)
export const usageCertaintySchema = /* @__PURE__ */ z.enum(USAGE_CERTAINTIES)
export type UsageKind = z.infer<typeof usageKindSchema>
export type UsageCertainty = z.infer<typeof usageCertaintySchema>

// Editor names come from env.appName / ACP clientInfo.name. They are open
// identifiers, so a new editor needs no schema release. Headless uses `cli`.
export const USAGE_CLI_CLIENT_ID = 'cli'
const CONTROL_CHARACTERS = /\p{Cc}/gu
export const usageLabelSchema = /* @__PURE__ */ z
  .pipe(
    z.string().check(z.maxLength(USAGE_LABEL_MAX_CHARS)),
    z.transform((value) => value.replaceAll(CONTROL_CHARACTERS, '')),
  )
  .check(z.minLength(1))
export const usageClientIdSchema = /* @__PURE__ */ usageLabelSchema.clone()
export const usageIdSchema = /* @__PURE__ */ z
  .string()
  .check(z.minLength(1), z.maxLength(USAGE_ID_MAX_CHARS), z.regex(/^[\w.-]+$/))
export const usageDaySchema = /* @__PURE__ */ z.iso.date()
export const usageCountSchema = /* @__PURE__ */ z.int().check(z.gte(0))
export const usageAmountSchema = /* @__PURE__ */ z.number().check(z.gte(0))

// Explicit names, never a wildcard accepting an account or credential header.
// These are stored as reported; interpreting one as a meter needs a capture.
export const USAGE_HEADER_ALLOW_LIST = [
  'x-ratelimit-limit-requests',
  'x-ratelimit-limit-tokens',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-remaining-tokens',
  'x-ratelimit-reset-requests',
  'x-ratelimit-reset-tokens',
  'anthropic-ratelimit-requests-limit',
  'anthropic-ratelimit-requests-remaining',
  'anthropic-ratelimit-requests-reset',
  'anthropic-ratelimit-tokens-limit',
  'anthropic-ratelimit-tokens-remaining',
  'anthropic-ratelimit-tokens-reset',
  'anthropic-ratelimit-input-tokens-limit',
  'anthropic-ratelimit-input-tokens-remaining',
  'anthropic-ratelimit-input-tokens-reset',
  'anthropic-ratelimit-output-tokens-limit',
  'anthropic-ratelimit-output-tokens-remaining',
  'anthropic-ratelimit-output-tokens-reset',
  // Anthropic's documented Priority Tier headers (GAPANTH-G20; read
  // 2026-10-13, https://platform.claude.com/docs/en/api/rate-limits):
  // kept, like the other rate-limit headers, never interpreted as a meter.
  'anthropic-priority-input-tokens-limit',
  'anthropic-priority-input-tokens-remaining',
  'anthropic-priority-input-tokens-reset',
  'anthropic-priority-output-tokens-limit',
  'anthropic-priority-output-tokens-remaining',
  'anthropic-priority-output-tokens-reset',
  'x-codex-primary-used-percent',
  'x-codex-primary-window-minutes',
  'x-codex-primary-reset-after-seconds',
  'x-codex-secondary-used-percent',
  'x-codex-secondary-window-minutes',
  'x-codex-secondary-reset-after-seconds',
  'ratelimit',
  'ratelimit-policy',
  'retry-after',
  // Azure's millisecond 429 wait (research §1.2 [AZ5]; lane PROVERRORS,
  // research azure-openai.md ZB2); stored beside `retry-after`, never a meter.
  'retry-after-ms',
  // The provider's request id (GAPANTH-G20; support asks for it — the
  // refusal path already attaches it, this keeps it on usage records too).
  // Provider-chosen, never credentials.
  'request-id',
  'x-request-id',
] as const
export const usageHeadersSchema = /* @__PURE__ */ z.partialRecord(
  z.enum(USAGE_HEADER_ALLOW_LIST),
  z.string().check(z.maxLength(USAGE_HEADER_MAX_CHARS), z.regex(/^[\u{20}-\u{7E}]*$/u)),
)
export type UsageHeaders = z.infer<typeof usageHeadersSchema>

export const usageTokensSchema = /* @__PURE__ */ z.strictObject({
  input: z.optional(usageCountSchema),
  cached: z.optional(usageCountSchema),
  cacheWrite: z.optional(usageCountSchema),
  cacheWrite5m: z.optional(usageCountSchema),
  cacheWrite1h: z.optional(usageCountSchema),
  cacheWrite12h: z.optional(usageCountSchema),
  output: z.optional(usageCountSchema),
  reasoning: z.optional(usageCountSchema),
  estimated: z.optional(z.boolean()),
})
export type UsageTokens = z.infer<typeof usageTokensSchema>
export const usageUnitsSchema = /* @__PURE__ */ z.strictObject({
  searches: z.optional(usageCountSchema),
  images: z.optional(usageCountSchema),
  audioSeconds: z.optional(usageAmountSchema),
})
// M121: version 2 stores dollars as canonical decimal text. Version 1 stored
// JSON numbers; the journal store builds its version 1 reader from these
// builders with `legacyUsdSchema` (journalStore.ts), so other bundles carry
// only the current schemas.
export const usageUsdSchema = nonnegativeUsdSchema
export function costSchemaWith<M extends typeof usageUsdSchema | typeof legacyUsdSchema>(money: M) {
  return z.strictObject({
    usd: z.optional(money),
    certainty: usageCertaintySchema,
    source: z.optional(z.enum(['list', 'catalogue', 'user', 'meta-published'])),
    date: z.optional(usageDaySchema),
    // An equivalent API price is not the amount a subscription charged.
    apiEquivalentUsd: z.optional(money),
  })
}
// Pure factories: composing schemas, no reads or writes outside the result.
export const usageCostSchema = /* @__PURE__ */ costSchemaWith(usageUsdSchema)
type CostSchema = typeof usageCostSchema | ReturnType<typeof costSchemaWith<typeof legacyUsdSchema>>
export type UsageCost = z.infer<typeof usageCostSchema>

// Each builder adds its own `v` literal.
const identity = {
  id: usageIdSchema,
  at: usageCountSchema,
  day: usageDaySchema,
  // Date.getTimezoneOffset(), recorded at the call; no later rebucketing.
  timezoneOffsetMins: z.int(),
  client: usageClientIdSchema,
  backend: z.enum(['museCode', 'modelApi']),
  provider: usageLabelSchema,
}
function isWithinRecordCap(value: unknown): boolean {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength < USAGE_RECORD_MAX_BYTES
}

export function recordSchemaWith<V extends number, C extends CostSchema>(version: V, cost: C) {
  return z
    .strictObject({
      ...identity,
      v: z.literal(version),
      type: z.literal('usage'),
      account: z.optional(accountIdSchema),
      startedAt: usageCountSchema,
      model: usageLabelSchema,
      served: z.optional(usageLabelSchema),
      kind: usageKindSchema,
      tokens: usageTokensSchema,
      units: z.optional(usageUnitsSchema),
      cost,
      outcome: z.enum(['completed', 'incomplete', 'failed', 'cancelled', 'refused']),
      durationMs: z.optional(usageAmountSchema),
      firstTokenMs: z.optional(usageAmountSchema),
      retries: z.optional(usageCountSchema),
      rateLimited: z.optional(z.boolean()),
      retryDelayMs: z.optional(usageAmountSchema),
      session: z.optional(usageIdSchema),
      packedAvoided: z.optional(usageCountSchema),
      headers: z.optional(usageHeadersSchema),
    })
    .check(z.refine(isWithinRecordCap))
}
export const usageRecordSchema = /* @__PURE__ */ recordSchemaWith(
  USAGE_JOURNAL_VERSION,
  usageCostSchema,
)
export type UsageRecord = z.infer<typeof usageRecordSchema>

export const usageLimitWindowSchema = /* @__PURE__ */ z.strictObject({
  id: usageIdSchema,
  label: z.optional(usageLabelSchema),
  // Reported percentages can exceed 100; never clamp the stored value.
  usedPercent: usageAmountSchema,
  resetsAt: z.optional(usageCountSchema),
  windowMins: z.optional(usageAmountSchema),
})

export function limitSchemaWith<
  V extends number,
  M extends typeof usageUsdSchema | typeof legacyUsdSchema,
>(version: V, money: M) {
  return z
    .strictObject({
      ...identity,
      v: z.literal(version),
      type: z.literal('limit'),
      source: z.enum(['museCode', 'openRouter', 'headers', 'chatgpt']),
      // M95: which stored credential an OpenRouter observation was admitted
      // for (its key digest) and which observation, so rotations invalidate
      // stale reads and the recorder dedupes by slot.
      credentialId: z.optional(z.string().check(z.regex(/^[a-f0-9]{64}$/))),
      observationId: z.optional(usageLabelSchema),
      observedAt: usageCountSchema,
      windows: z.array(usageLimitWindowSchema),
      // The subscription meter's own plan name, verbatim (Muse Code's
      // `usage/changed` tier): plan rows say whose plan the spend rode on.
      plan: z.optional(usageLabelSchema),
      account: z.optional(
        z.strictObject({
          usedUsd: z.optional(money),
          limitUsd: z.optional(money),
          remainingUsd: z.optional(money),
          period: usageLabelSchema,
        }),
      ),
      // No arbitrary JSON: account/key responses must be normalised first.
      raw: z.optional(usageHeadersSchema),
      // The credential identity the observation arrived under (a key digest,
      // never the secret): selection drops a row stamped for a different
      // account, so a replaced key stops using the old quota.
      observedAccount: z.optional(z.string()),
    })
    .check(z.refine(isWithinRecordCap))
}
export const usageLimitSnapshotSchema = /* @__PURE__ */ limitSchemaWith(
  USAGE_JOURNAL_VERSION,
  usageUsdSchema,
)

export type UsageLimitSnapshot = z.infer<typeof usageLimitSnapshotSchema>
export const usageJournalEntrySchema = /* @__PURE__ */ z.discriminatedUnion('type', [
  usageRecordSchema,
  usageLimitSnapshotSchema,
])
export type UsageJournalEntry = z.infer<typeof usageJournalEntrySchema>

// M102 extends its record schemas with these fields once its journal lands.
// Absence denotes a pre-M108 record; the reader resolves it to `default`.

// Pure factory: only tests spread these fields, so production bundles drop them.
export const usageAccountFields = /* @__PURE__ */ (() => {
  return { account: z.optional(accountIdSchema) }
})()
