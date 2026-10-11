import { nonnegativeUsdSchema } from './usdSchema'
// Canonical paid schemas and accounting shared by Node consumers through
// modelApiBoundaries.js; browser consumers retain the same inline code.
import * as z from 'zod/mini'
import {
  MODEL_API_PRICED_MODELS,
  type MODEL_API_PRICES_PER_MILLION,
  MUSE_CODE_PAID_FEATURES,
  PAID_FEATURES,
  UI_TEXT,
  type PaidFeature,
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

/**
 * The paid features a window can use (M44, PLAN.md D37): every one on the
 * Model API backend; on Muse Code, the extension's features billed to a
 * stored key, including key-billed team tasks; none without that key. This
 * stays beside the schemas, without exact money arithmetic, so chat startup
 * (the composer badge, the dictate tooltip) can name features before the
 * lazy money chunk with the prices arrives.
 */
export function usablePaidFeatures(
  // The backends protocol.ts names; kept as literals so this module never
  // imports protocol (which imports this module for paidStateSchema).
  backend: 'museCode' | 'modelApi' | undefined,
  isKeyStored: boolean,
): readonly PaidFeature[] {
  if (backend === 'modelApi') {
    return PAID_FEATURES
  }
  return backend === 'museCode' && isKeyStored ? MUSE_CODE_PAID_FEATURES : []
}

/** The feature's short name, as the badge and the dialog show it. */
export function paidFeatureName(feature: PaidFeature): string {
  const names: Readonly<Record<PaidFeature, string>> = {
    webSearch: UI_TEXT.paidWebSearchName,
    imageGeneration: UI_TEXT.paidImageGenerationName,
    voice: UI_TEXT.paidVoiceName,
    scheduledPrompts: UI_TEXT.paidScheduledName,
    subagents: UI_TEXT.paidSubagentsName,
    autoReviewer: UI_TEXT.paidAutoReviewerName,
    bestOfN: UI_TEXT.paidBestOfNName,
    teamWorkers: UI_TEXT.paidTeamWorkersName,
    tab: UI_TEXT.paidTabName,
    hookModels: UI_TEXT.paidHookModelName,
    judge: UI_TEXT.paidJudgeName,
    legalExplanation: UI_TEXT.paidLegalExplanationName,
  }
  return names[feature]
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
