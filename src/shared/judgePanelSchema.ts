// Judge wire shapes stay independent of host projection and lazy presentation.
import * as z from 'zod/mini'
import { nonnegativeUsdSchema } from './usdSchema'

export const JUDGE_PANEL_ENGINES = ['auto', 'same', 'separate', 'both', 'off'] as const

export const JUDGE_PANEL_SOURCES = ['same', 'separate', 'both', 'none'] as const
export type JudgePanelSource = (typeof JUDGE_PANEL_SOURCES)[number]

/** Kept aligned with `JUDGE_TECHNIQUES` in src/core/judge/schema.ts. */
export const JUDGE_PANEL_TECHNIQUES = [
  'logprob',
  'top1',
  'stated',
  'systemone',
  'sampling',
  'contrastive',
  'cascade',
  'embedding',
] as const
export type JudgePanelTechnique = (typeof JUDGE_PANEL_TECHNIQUES)[number]

/** Kept aligned with `JUDGE_LABELS` in src/core/judge/schema.ts. */
export const JUDGE_PANEL_LABELS = [
  'calibrated (logprob)',
  'calibrated (stated)',
  'uncalibrated',
  'approximate (top-1)',
] as const
export type JudgePanelLabel = (typeof JUDGE_PANEL_LABELS)[number]

/** Kept aligned with `JUDGE_NO_ANSWER_REASONS` in src/core/judge/schema.ts. */
export const JUDGE_PANEL_REASONS = [
  'explicit-off',
  'unknown-setting',
  'consent-needed',
  'consent-declined',
  'source-unavailable',
  'ready-rate-low',
  'profile-missing',
  'profile-mismatch',
  'source-untested',
  'local-unverified',
  'confidential-refused',
  'capability-unavailable',
  'over-context',
  'over-budget',
  'unpriced',
  'cancelled',
  'timeout',
  'engine-failure',
] as const
export type JudgePanelReason = (typeof JUDGE_PANEL_REASONS)[number]

/**
A reported per-unit rate: display dollars at the captured tariff, never a
liability. The host filters negative and non-finite values before they reach
the facts; the projection drops any that remain instead of showing zero.
*/
const reportedRate = z.number()

const rateSchema = z.number().check(
  z.nonnegative(),
  z.refine((value) => Number.isFinite(value)),
)

export const judgePanelLogprobSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('topk'), topK: z.int().check(z.positive()) }),
  z.strictObject({ kind: z.enum(['top1', 'refused', 'dropped', 'unknown']) }),
])

/** One model's captured judge capability. Provider id is identity, not a technique. */
export const judgePanelCapabilitySchema = z.strictObject({
  providerId: z.string().check(z.minLength(1)),
  model: z.string().check(z.minLength(1)),
  logprobs: judgePanelLogprobSchema,
  stated: z.boolean(),
  systemone: z.boolean(),
  reasoningForced: z.boolean(),
  cache: z.boolean(),
  embedding: z.optional(z.boolean()),
})
export type JudgePanelCapability = z.infer<typeof judgePanelCapabilitySchema>

const panelIdentityFields = {
  engine: z.enum(JUDGE_PANEL_ENGINES),
  effectiveSource: z.enum(JUDGE_PANEL_SOURCES),
  providerId: z.optional(z.string().check(z.minLength(1))),
  modelId: z.optional(z.string().check(z.minLength(1))),
  technique: z.optional(z.enum(JUDGE_PANEL_TECHNIQUES)),
  label: z.optional(z.enum(JUDGE_PANEL_LABELS)),
  partial: z.optional(z.boolean()),
  reason: z.optional(z.enum(JUDGE_PANEL_REASONS)),
}

export const judgePanelFactsSchema = z.strictObject({
  ...panelIdentityFields,
  capability: z.optional(judgePanelCapabilitySchema),
  locality: z.enum(['not-local', 'verified', 'unverified']),
  experimental: z.boolean(),
  confidential: z.boolean(),
  billing: z.enum(['subscription', 'modelApi', 'free', 'none']),
  paidSourceSelected: z.boolean(),
  consent: z.enum(['not-required', 'needed', 'granted', 'declined']),
  consentBoundTo: z.optional(z.string().check(z.minLength(1))),
  paidIdentity: z.optional(z.string().check(z.minLength(1))),
  inputPerMillion: z.optional(reportedRate),
  cachedPerMillion: z.optional(reportedRate),
  outputPerMillion: z.optional(reportedRate),
  reservedUsd: z.optional(nonnegativeUsdSchema),
  settledUsd: z.optional(nonnegativeUsdSchema),
  uncertainUsd: z.optional(nonnegativeUsdSchema),
  dailyBudgetUsd: z.optional(nonnegativeUsdSchema),
  dailySpentUsd: z.optional(nonnegativeUsdSchema),
})
export type JudgePanelFacts = z.infer<typeof judgePanelFactsSchema>

export const judgePanelSnapshotSchema = z.strictObject({
  ...panelIdentityFields,
  unverifiedLocal: z.boolean(),
  untested: z.boolean(),
  billing: z.enum(['subscription', 'modelApi', 'free', 'none']),
  paidSourceSelected: z.boolean(),
  consent: z.enum(['not-required', 'needed', 'granted', 'declined']),
  askFirstCharge: z.boolean(),
  showSubscriptionNote: z.boolean(),
  inputPerMillion: z.optional(rateSchema),
  cachedPerMillion: z.optional(rateSchema),
  outputPerMillion: z.optional(rateSchema),
  reservedUsd: z.optional(nonnegativeUsdSchema),
  settledUsd: z.optional(nonnegativeUsdSchema),
  uncertainUsd: z.optional(nonnegativeUsdSchema),
  dailyBudgetUsd: z.optional(nonnegativeUsdSchema),
  dailySpentUsd: z.optional(nonnegativeUsdSchema),
})
export type JudgePanelSnapshot = z.infer<typeof judgePanelSnapshotSchema>
