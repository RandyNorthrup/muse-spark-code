// Judge wire shapes stay independent of host projection and lazy presentation.
import * as z from 'zod/mini'
import { JUDGE_FAST_TURN_DECISIONS, JUDGE_FAST_TURN_REASONS } from './judgeFastTurn'

export const JUDGE_PANEL_ENGINES = ['auto', 'same', 'separate', 'both', 'off'] as const

/**
D107 (M125 lane U): one fast decision's latest window state. The
aggregator keeps the newest turn record per decision; unwired or
unevaluated decisions carry no entry, and the surface shows unknown.
*/
export const judgePanelFastDecisionSchema = z.strictObject({
  decision: z.enum(JUDGE_FAST_TURN_DECISIONS),
  raised: z.boolean(),
  acted: z.boolean(),
  reason: z.enum(JUDGE_FAST_TURN_REASONS),
  /** Turn records merged into this entry. */
  evaluated: z.number().check(z.int(), z.minimum(0)),
  /** Turn records where the decision acted. */
  appliedTurns: z.number().check(z.int(), z.minimum(0)),
  /** Triage only: results that rode whole for want of a real window. */
  noWindow: z.optional(z.number().check(z.int(), z.minimum(0))),
})

export const judgePanelFastTotalsSchema = z.strictObject({
  /** Turns with at least one evaluated decision. */
  turns: z.number().check(z.int(), z.minimum(0)),
  /** Turns where any decision acted. */
  appliedTurns: z.number().check(z.int(), z.minimum(0)),
  raised: z.number().check(z.int(), z.minimum(0)),
  acted: z.number().check(z.int(), z.minimum(0)),
  judgeCalls: z.number().check(z.int(), z.minimum(0)),
  judgeTokens: z.number().check(z.int(), z.minimum(0)),
})

export const judgePanelFastFactsSchema = z.strictObject({
  decisions: z.array(judgePanelFastDecisionSchema),
  totals: judgePanelFastTotalsSchema,
  /** What decided most recently: `deterministic`, or the engine's id. */
  method: z.string().check(z.minLength(1)),
  /**
  Lane V's paired median wall-time saving per eligible turn, per
  decision, when a measurement exists. Absent decisions are unmeasured:
  the surface shows unknown, never zero.
  */
  measuredMsPerTurn: z.optional(z.partialRecord(z.enum(JUDGE_FAST_TURN_DECISIONS), z.number())),
})

/**
D107 (M125 lane U): one fast decision's snapshot row. The estimate
multiplies lane V's paired median by the turns where the decision
applied at least once; either side absent leaves the saving unknown.
*/
export const judgePanelFastRowSchema = z.strictObject({
  decision: z.enum(JUDGE_FAST_TURN_DECISIONS),
  state: z.enum(['acted', 'raised', 'absent']),
  reason: z.enum(JUDGE_FAST_TURN_REASONS),
  evaluated: z.number().check(z.int(), z.minimum(0)),
  appliedTurns: z.number().check(z.int(), z.minimum(0)),
  noWindow: z.optional(z.number().check(z.int(), z.minimum(0))),
  /** The measured median saving per eligible turn, when measured. */
  savedMsPerTurn: z.optional(z.number()),
  /** Per-turn median times applied turns; unknown without the median. */
  savedMsTotal: z.optional(z.number()),
})

export const judgePanelFastSnapshotSchema = z.strictObject({
  rows: z.array(judgePanelFastRowSchema),
  totals: judgePanelFastTotalsSchema,
  method: z.string().check(z.minLength(1)),
  /** Summed over measured decisions; unknown when none is measured. */
  savedMsTotal: z.optional(z.number()),
})
export type JudgePanelFastRow = z.infer<typeof judgePanelFastRowSchema>
export type JudgePanelFastFacts = z.infer<typeof judgePanelFastFactsSchema>
export type JudgePanelFastSnapshot = z.infer<typeof judgePanelFastSnapshotSchema>

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

/** A reported amount. Negative and non-finite values are omitted, never shown as zero. */
const reportedUsd = z.number()

const usdSchema = z.number().check(
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
  inputPerMillion: z.optional(reportedUsd),
  cachedPerMillion: z.optional(reportedUsd),
  outputPerMillion: z.optional(reportedUsd),
  reservedUsd: z.optional(reportedUsd),
  settledUsd: z.optional(reportedUsd),
  uncertainUsd: z.optional(reportedUsd),
  dailyBudgetUsd: z.optional(reportedUsd),
  dailySpentUsd: z.optional(reportedUsd),
  /** The window's fast-decision state; absent before the first turn record. */
  fast: z.optional(judgePanelFastFactsSchema),
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
  inputPerMillion: z.optional(usdSchema),
  cachedPerMillion: z.optional(usdSchema),
  outputPerMillion: z.optional(usdSchema),
  reservedUsd: z.optional(usdSchema),
  settledUsd: z.optional(usdSchema),
  uncertainUsd: z.optional(usdSchema),
  dailyBudgetUsd: z.optional(usdSchema),
  dailySpentUsd: z.optional(usdSchema),
  fast: z.optional(judgePanelFastSnapshotSchema),
})
export type JudgePanelSnapshot = z.infer<typeof judgePanelSnapshotSchema>
