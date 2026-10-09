// M102 / D82: our private on-disk format, not a provider wire parser.
// Canonical Usage already includes cached/write input and reasoning output.
// Optional counters remain absent when unknown. Strict objects reject content,
// paths, credentials and account identifiers rather than silently storing them.
import * as z from 'zod/mini'
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
export const usageKindSchema = z.enum(USAGE_KINDS)
export const usageCertaintySchema = z.enum(USAGE_CERTAINTIES)
export type UsageKind = z.infer<typeof usageKindSchema>
export type UsageCertainty = z.infer<typeof usageCertaintySchema>

// Editor names come from env.appName / ACP clientInfo.name. They are open
// identifiers, so a new editor needs no schema release. Headless uses `cli`.
export const USAGE_CLI_CLIENT_ID = 'cli'
const CONTROL_CHARACTERS = /\p{Cc}/gu
export const usageLabelSchema = z
  .pipe(
    z.string().check(z.maxLength(USAGE_LABEL_MAX_CHARS)),
    z.transform((value) => value.replaceAll(CONTROL_CHARACTERS, '')),
  )
  .check(z.minLength(1))
export const usageClientIdSchema = usageLabelSchema.clone()
export const usageIdSchema = z
  .string()
  .check(z.minLength(1), z.maxLength(USAGE_ID_MAX_CHARS), z.regex(/^[\w.-]+$/))
export const usageDaySchema = z.iso.date()
export const usageCountSchema = z.int().check(z.gte(0))
export const usageAmountSchema = z.number().check(z.gte(0))

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
  'x-codex-primary-used-percent',
  'x-codex-primary-window-minutes',
  'x-codex-primary-reset-after-seconds',
  'x-codex-secondary-used-percent',
  'x-codex-secondary-window-minutes',
  'x-codex-secondary-reset-after-seconds',
  'ratelimit',
  'ratelimit-policy',
  'retry-after',
] as const
export const usageHeadersSchema = z.partialRecord(
  z.enum(USAGE_HEADER_ALLOW_LIST),
  z.string().check(z.maxLength(USAGE_HEADER_MAX_CHARS), z.regex(/^[\u{20}-\u{7E}]*$/u)),
)
export type UsageHeaders = z.infer<typeof usageHeadersSchema>

export const usageTokensSchema = z.strictObject({
  input: z.optional(usageCountSchema),
  cached: z.optional(usageCountSchema),
  cacheWrite: z.optional(usageCountSchema),
  cacheWrite5m: z.optional(usageCountSchema),
  cacheWrite1h: z.optional(usageCountSchema),
  output: z.optional(usageCountSchema),
  reasoning: z.optional(usageCountSchema),
  estimated: z.optional(z.boolean()),
})
export type UsageTokens = z.infer<typeof usageTokensSchema>
export const usageUnitsSchema = z.strictObject({
  searches: z.optional(usageCountSchema),
  images: z.optional(usageCountSchema),
  audioSeconds: z.optional(usageAmountSchema),
})
export const usageCostSchema = z.strictObject({
  usd: z.optional(usageAmountSchema),
  certainty: usageCertaintySchema,
  source: z.optional(z.enum(['list', 'catalogue', 'user', 'meta-published'])),
  date: z.optional(usageDaySchema),
  // An equivalent API price is not the amount a subscription charged.
  apiEquivalentUsd: z.optional(usageAmountSchema),
})
export type UsageCost = z.infer<typeof usageCostSchema>

const identity = {
  v: z.literal(USAGE_JOURNAL_VERSION),
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

export const usageRecordSchema = z
  .strictObject({
    ...identity,
    type: z.literal('usage'),
    account: z.optional(accountIdSchema),
    startedAt: usageCountSchema,
    model: usageLabelSchema,
    served: z.optional(usageLabelSchema),
    kind: usageKindSchema,
    tokens: usageTokensSchema,
    units: z.optional(usageUnitsSchema),
    cost: usageCostSchema,
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
export type UsageRecord = z.infer<typeof usageRecordSchema>

export const usageLimitWindowSchema = z.strictObject({
  id: usageIdSchema,
  label: z.optional(usageLabelSchema),
  // Reported percentages can exceed 100; never clamp the stored value.
  usedPercent: usageAmountSchema,
  resetsAt: z.optional(usageCountSchema),
  windowMins: z.optional(usageAmountSchema),
})
export const usageLimitSnapshotSchema = z
  .strictObject({
    ...identity,
    type: z.literal('limit'),
    source: z.enum(['museCode', 'openRouter', 'headers', 'chatgpt']),
    observedAt: usageCountSchema,
    windows: z.array(usageLimitWindowSchema),
    account: z.optional(
      z.strictObject({
        usedUsd: z.optional(usageAmountSchema),
        limitUsd: z.optional(usageAmountSchema),
        remainingUsd: z.optional(usageAmountSchema),
        period: usageLabelSchema,
      }),
    ),
    // No arbitrary JSON: account/key responses must be normalised first.
    raw: z.optional(usageHeadersSchema),
  })
  .check(z.refine(isWithinRecordCap))
export type UsageLimitSnapshot = z.infer<typeof usageLimitSnapshotSchema>
export const usageJournalEntrySchema = z.discriminatedUnion('type', [
  usageRecordSchema,
  usageLimitSnapshotSchema,
])
export type UsageJournalEntry = z.infer<typeof usageJournalEntrySchema>
// M102 extends its record schemas with these fields once its journal lands.
// Absence denotes a pre-M108 record; the reader resolves it to `default`.
import { accountIdSchema } from './accountId'

export const usageAccountFields = { account: z.optional(accountIdSchema) }
