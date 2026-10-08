import { nonnegativeUsdSchema } from './usd'
// Canonical paid schemas and accounting shared by Node consumers through
// modelApiBoundaries.js; browser consumers retain the same inline code.
import * as z from 'zod/mini'
import {
  MODEL_API_PRICED_MODELS,
  type MODEL_API_PRICES_PER_MILLION,
  PAID_FEATURES,
} from './constants'

const paidCountSchema = z.optional(z.int().check(z.nonnegative()))

const paidCostSchema = z.optional(nonnegativeUsdSchema)

/** What this window used of each paid feature since it opened. */
export const paidTallySchema = z.object({
  webSearches: z.number(),
  webSearchCharges: z.optional(
    z.array(
      z.object({
        units: z.int().check(z.nonnegative()),
        priceUsd: nonnegativeUsdSchema,
      }),
    ),
  ),
  images: z.number(),
  voiceSeconds: z.number(),
  scheduledRuns: z.number(),
  // Optional for panels saved before M48; absent means no child use recorded.
  subagentRequests: paidCountSchema,
  subagentUnknownRequests: paidCountSchema,
  subagentTokens: paidCountSchema,
  subagentCostUsd: paidCostSchema,
  // Optional for panels saved before M78; absent means no review made.
  autoReviews: paidCountSchema,
  autoReviewUnknownRequests: paidCountSchema,
  autoReviewTokens: paidCountSchema,
  autoReviewCostUsd: paidCostSchema,
  legalExplanations: paidCountSchema,
  legalExplanationUnknownRequests: paidCountSchema,
  legalExplanationTokens: paidCountSchema,
  legalExplanationCostUsd: paidCostSchema,
  // Best-of-N runs started this window (M77); absent means none.
  bestOfNAttempts: paidCountSchema,
  bestOfNRequests: paidCountSchema,
  bestOfNUnknownRequests: paidCountSchema,
  bestOfNTokens: paidCountSchema,
  bestOfNCostUsd: paidCostSchema,
  // Team tasks started this window (M96 lane A, PLAN.md D75); absent means none.
  teamWorkerRequests: paidCountSchema,
  teamWorkerUnknownRequests: paidCountSchema,
  teamWorkerTokens: paidCountSchema,
  teamWorkerCostUsd: paidCostSchema,
  // Tab suggestion requests sent this window (M94, PLAN.md D73); absent
  // means none. Lane L counts them, lane U shows them in Account & usage.
  tabRequests: z.optional(z.int().check(z.nonnegative())),
  tabUnknownRequests: z.optional(z.int().check(z.nonnegative())),
  tabTokens: z.optional(z.int().check(z.nonnegative())),
  tabCachedTokens: z.optional(z.int().check(z.nonnegative())),
  tabCostUsd: z.optional(nonnegativeUsdSchema),
  // M91 prompt/agent hook runs started this window (D70); absent means none.
  hookModelRuns: z.optional(z.int().check(z.nonnegative())),
  hookModelUnknownRequests: z.optional(z.int().check(z.nonnegative())),
  hookModelTokens: z.optional(z.int().check(z.nonnegative())),
  hookModelCostUsd: z.optional(nonnegativeUsdSchema),
  // Same-model judge calls this window (M98, PLAN.md D77); absent means none.
  judgeCalls: z.optional(z.int().check(z.nonnegative())),
  judgeUnknownRequests: z.optional(z.int().check(z.nonnegative())),
  judgeTokens: z.optional(z.int().check(z.nonnegative())),
  judgeCostUsd: z.optional(nonnegativeUsdSchema),
})

export type PaidTally = z.infer<typeof paidTallySchema>

export const EMPTY_PAID_TALLY: PaidTally = {
  webSearches: 0,
  images: 0,
  voiceSeconds: 0,
  scheduledRuns: 0,
}

/** Unknown model tariffs cannot authorize a paid child task. */
export function modelApiPaidTier(
  modelId: string,
): keyof typeof MODEL_API_PRICES_PER_MILLION | undefined {
  const standard: readonly string[] = MODEL_API_PRICED_MODELS.standard
  if (standard.includes(modelId)) {
    return 'standard'
  }
  const contributor: readonly string[] = MODEL_API_PRICED_MODELS.contributor
  return contributor.includes(modelId) ? 'contributor' : undefined
}

/** The features that are on (setting on and price accepted), and the tally. */
export const paidStateSchema = z.object({
  features: z.array(z.enum(PAID_FEATURES)),
  tally: paidTallySchema,
  /** A Model API key is stored (M44): the Muse Code backend can use the key's paid features. */
  isKeyStored: z.boolean(),
  /** The features that are on and allowed always in this workspace (M58): they no longer ask. */
  alwaysAllowed: z.array(z.enum(PAID_FEATURES)),
  /**
   * Tab's day (M94, D73; RVM94HU 23–24): the configured daily budget, and
   * today's total across every window from the ledger once Tab has run in
   * this window (absent before: the ledger is read by dist/tab.js).
   */
  tab: z.optional(
    z.object({
      budgetUsd: nonnegativeUsdSchema,
      todayUsd: z.optional(nonnegativeUsdSchema),
    }),
  ),
})

export type PaidState = z.infer<typeof paidStateSchema>
