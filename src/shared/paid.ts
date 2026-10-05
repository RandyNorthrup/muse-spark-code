// The paid Model API features (M33–M35, PLAN.md D30) as the host, the wire
// protocol and the webview share them: which are on, what this window has
// used, and what that is estimated to cost at Meta's published prices.
//
// Shared by host and webview: no `vscode`, Node, or DOM imports.

import * as z from 'zod/mini'
import {
  BEST_OF_N_DEFAULT_ATTEMPTS,
  BEST_OF_N_DEFAULT_REQUESTS_PER_ATTEMPT,
  MUSE_CODE_PAID_FEATURES,
  DEFAULT_MODEL_ID,
  CONTRIBUTOR_MODEL_SUFFIX,
  MODEL_API_PRICED_MODELS,
  MODEL_API_PRICES_PER_MILLION,
  MODEL_API_PRICE_DECIMALS,
  PAID_FEATURES,
  PAID_PRICES_USD,
  type PaidFeature,
  SEARCHES_PER_PRICE_UNIT,
  SECONDS_PER_HOUR,
  SUBAGENT_TASK_MAX_REQUESTS,
  UI_TEXT,
} from './constants'
import { fill, formatNumber, formatUsd } from './l10n/text'
import type { BackendKind } from './protocol'

/** What this window used of each paid feature since it opened. */
export const paidTallySchema = z.object({
  webSearches: z.number(),
  images: z.number(),
  voiceSeconds: z.number(),
  scheduledRuns: z.number(),
  // Optional for panels saved before M48; absent means no child use recorded.
  subagentRequests: z.optional(z.int().check(z.nonnegative())),
  subagentUnknownRequests: z.optional(z.int().check(z.nonnegative())),
  subagentTokens: z.optional(z.int().check(z.nonnegative())),
  subagentCostUsd: z.optional(z.number().check(z.nonnegative())),
  // Optional for panels saved before M78; absent means no review made.
  autoReviews: z.optional(z.int().check(z.nonnegative())),
  autoReviewUnknownRequests: z.optional(z.int().check(z.nonnegative())),
  autoReviewTokens: z.optional(z.int().check(z.nonnegative())),
  autoReviewCostUsd: z.optional(z.number().check(z.nonnegative())),
  // Best-of-N runs started this window (M77); absent means none.
  bestOfNAttempts: z.optional(z.int().check(z.nonnegative())),
  bestOfNRequests: z.optional(z.int().check(z.nonnegative())),
  bestOfNUnknownRequests: z.optional(z.int().check(z.nonnegative())),
  bestOfNTokens: z.optional(z.int().check(z.nonnegative())),
  bestOfNCostUsd: z.optional(z.number().check(z.nonnegative())),
  // Tab suggestion requests sent this window (M94, PLAN.md D73); absent
  // means none. Lane L counts them, lane U shows them in Account & usage.
  tabRequests: z.optional(z.int().check(z.nonnegative())),
  tabUnknownRequests: z.optional(z.int().check(z.nonnegative())),
  tabTokens: z.optional(z.int().check(z.nonnegative())),
  tabCachedTokens: z.optional(z.int().check(z.nonnegative())),
  tabCostUsd: z.optional(z.number().check(z.nonnegative())),
  // M91 prompt/agent hook runs started this window (D70); absent means none.
  hookModelRuns: z.optional(z.int().check(z.nonnegative())),
  hookModelUnknownRequests: z.optional(z.int().check(z.nonnegative())),
  hookModelTokens: z.optional(z.int().check(z.nonnegative())),
  hookModelCostUsd: z.optional(z.number().check(z.nonnegative())),
})
export type PaidTally = z.infer<typeof paidTallySchema>

export const EMPTY_PAID_TALLY: PaidTally = {
  webSearches: 0,
  images: 0,
  voiceSeconds: 0,
  scheduledRuns: 0,
}

export interface SubagentTaskConfirmation {
  readonly role: string
  readonly objective: string
  readonly modelId: string
  readonly attemptLimit: number
}

export interface SubagentUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cachedTokens: number
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

/** Exact published rates and the task's HTTP attempt cap, in the installed locale. */
export function subagentTaskPrice(modelId: string, attemptLimit: number): string {
  const tier = modelApiPaidTier(modelId)
  if (tier === undefined) {
    return UI_TEXT.subagentTariffUnknown
  }
  const rates = MODEL_API_PRICES_PER_MILLION[tier]
  return fill(UI_TEXT.paidSubagentRates, {
    model: modelId,
    input: formatUsd(rates.input, MODEL_API_PRICE_DECIMALS),
    cached: formatUsd(rates.cachedInput, MODEL_API_PRICE_DECIMALS),
    output: formatUsd(rates.output, MODEL_API_PRICE_DECIMALS),
    limit: formatNumber(attemptLimit),
  })
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
      budgetUsd: z.number().check(z.nonnegative()),
      todayUsd: z.optional(z.number().check(z.nonnegative())),
    }),
  ),
})
export type PaidState = z.infer<typeof paidStateSchema>

/**
 * One paid use the user is asked about (M58, PLAN.md D48): what the popup
 * names before anything is billed. Web search asks once per prompt, since
 * Meta runs the searches inside the response and the model decides whether
 * to search at all.
 */
export type PaidUseRequest =
  | { readonly feature: 'webSearch' }
  | { readonly feature: 'voice' }
  | {
      readonly feature: 'imageGeneration'
      readonly kind: 'generate' | 'edit'
      /** Workspace-relative paths, as the popup shows them. */
      readonly path: string
      readonly sources: readonly string[]
      readonly prompt: string
    }
  | { readonly feature: 'scheduledPrompts'; readonly prompt: string; readonly modelId: string }
  | { readonly feature: 'subagents'; readonly task: SubagentTaskConfirmation }
  | {
      readonly feature: 'autoReviewer'
      /** The conversation's model, which the review runs on (M78). */
      readonly modelId: string
      /** The tool the reviewed call is for, and its command line or arguments. */
      readonly tool: string
      readonly action: string
    }
  | {
      readonly feature: 'bestOfN'
      readonly modelId: string
      readonly prompt: string
      readonly attempts: number
      readonly requestCeilingPerAttempt: number
    }
  | {
      // Inline completions (M94, PLAN.md D73; lane L): the request's model
      // (its per-token rates are quoted) and today's budget cap the popup.
      readonly feature: 'tab'
      readonly modelId: string
      readonly budgetUsd: number
    }
  | {
      /** M91 prompt/agent hook handlers (D70): one paid model call per hook run. */
      readonly feature: 'hookModels'
      /** The hook event the handler runs on. */
      readonly event: string
      /** The handler kind, as written in the file. */
      readonly kind: 'prompt' | 'agent'
      readonly modelId: string
      readonly dailyBudgetUsd?: number | undefined
    }

/**
 * The paid features a window can use (M44, PLAN.md D37): every one on the
 * Model API backend; on Muse Code, the ones billed to a stored key that it
 * has no subscription equivalent for; none otherwise.
 */
export function usablePaidFeatures(
  backend: BackendKind | undefined,
  isKeyStored: boolean,
): readonly PaidFeature[] {
  if (backend === 'modelApi') {
    return PAID_FEATURES
  }
  return backend === 'museCode' && isKeyStored ? MUSE_CODE_PAID_FEATURES : []
}

/** The estimated cost of one feature's use in the tally, in dollars. */
export function paidCostUsd(feature: PaidFeature, tally: PaidTally): number {
  switch (feature) {
    case 'webSearch': {
      return (tally.webSearches * PAID_PRICES_USD.webSearchPerThousand) / SEARCHES_PER_PRICE_UNIT
    }
    case 'imageGeneration': {
      return tally.images * PAID_PRICES_USD.imageGeneration
    }
    case 'voice': {
      return (tally.voiceSeconds * PAID_PRICES_USD.voicePerHour) / SECONDS_PER_HOUR
    }
    case 'scheduledPrompts': {
      // Scheduled runs use ordinary Model API tokens. UsageDialog prices those
      // tokens already; adding them to the extra-features total doubles them.
      return 0
    }
    case 'subagents': {
      return tally.subagentCostUsd ?? 0
    }
    case 'autoReviewer': {
      // Billed apart from the conversation, so counted here alone.
      return tally.autoReviewCostUsd ?? 0
    }
    case 'bestOfN': {
      // Separate worktree hosts do not contribute to the parent's token
      // estimate. Count only reported costs here, not unknown HTTP tries.
      return tally.bestOfNCostUsd ?? 0
    }
    case 'tab': {
      // Tab requests are billed apart from every conversation, so they are
      // counted here alone. Count only reported costs, not unknown tries.
      return tally.tabCostUsd ?? 0
    }
    case 'hookModels': {
      // A hook's own model call is billed apart from the conversation, like
      // a review's. Count only reported costs, not unanswered runs.
      return tally.hookModelCostUsd ?? 0
    }
  }
}

/**
 * The paid features Account & usage lists (the review of PR #30): the ones
 * this backend can use, and any this window has already used, whatever the
 * backend now, so its total is the sum of the rows it shows.
 */
export function listedPaidFeatures(
  usable: readonly PaidFeature[],
  tally: PaidTally,
): readonly PaidFeature[] {
  return PAID_FEATURES.filter(
    (feature) =>
      usable.includes(feature) ||
      paidCostUsd(feature, tally) > 0 ||
      (feature === 'scheduledPrompts' && tally.scheduledRuns > 0) ||
      (feature === 'subagents' && (tally.subagentRequests ?? 0) > 0) ||
      (feature === 'autoReviewer' && (tally.autoReviews ?? 0) > 0) ||
      (feature === 'bestOfN' && (tally.bestOfNAttempts ?? 0) > 0) ||
      (feature === 'tab' && (tally.tabRequests ?? 0) > 0) ||
      (feature === 'hookModels' && (tally.hookModelRuns ?? 0) > 0),
  )
}

/** The whole tally's estimated cost. */
export function paidTotalUsd(tally: PaidTally): number {
  // Child token cost is already part of the conversation's token estimate.
  let total = 0
  for (const feature of PAID_FEATURES) {
    if (feature !== 'subagents') {
      total += paidCostUsd(feature, tally)
    }
  }
  return total
}

// Built per call, never at module load: the display language's table is
// installed after this module loads (PLAN.md D33).

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
    tab: UI_TEXT.paidTabName,
    hookModels: UI_TEXT.paidHookModelName,
  }
  return names[feature]
}

function tokenRatePrice(tier: keyof typeof MODEL_API_PRICES_PER_MILLION): string {
  const rates = MODEL_API_PRICES_PER_MILLION[tier]
  return fill(UI_TEXT.paidScheduledPrice, {
    input: formatUsd(rates.input, MODEL_API_PRICE_DECIMALS),
    cached: formatUsd(rates.cachedInput, MODEL_API_PRICE_DECIMALS),
    output: formatUsd(rates.output, MODEL_API_PRICE_DECIMALS),
  })
}

/** Exact scheduled-run tariff; unknown models cannot authorize a paid request. */
export function scheduledRunPrice(modelId: string): string {
  const tier = modelApiPaidTier(modelId)
  if (tier === undefined) {
    throw new Error(UI_TEXT.subagentTariffUnknown)
  }
  return tokenRatePrice(tier)
}

/** One Auto review's tariff on the conversation's model (M78); undefined without a verified price. */
export function autoReviewPrice(modelId: string): string | undefined {
  const tier = modelApiPaidTier(modelId)
  return tier === undefined ? undefined : tokenRatePrice(tier)
}

/** Every priced model's token rates, one tier a line: a feature billed by tokens. */
function tokenRatesByTier(): string {
  return [
    `${MODEL_API_PRICED_MODELS.standard.join(', ')}: ${tokenRatePrice('standard')}`,
    `${MODEL_API_PRICED_MODELS.contributor.join(', ')}: ${tokenRatePrice('contributor')}`,
  ].join('\n')
}

/**
 * What a best-of-N run may bill (M77, PLAN.md D49): the per-token rates of
 * the model, the attempt count and the request ceiling per attempt. The
 * total cannot be known in advance, so the popup quotes exactly these.
 */
export function bestOfNPrice(
  modelId: string,
  attempts: number,
  requestCeilingPerAttempt: number,
): string {
  const tier = modelApiPaidTier(modelId)
  if (tier === undefined) {
    return UI_TEXT.subagentTariffUnknown
  }
  const rates = MODEL_API_PRICES_PER_MILLION[tier]
  return fill(UI_TEXT.paidBestOfNRates, {
    model: modelId,
    input: formatUsd(rates.input, MODEL_API_PRICE_DECIMALS),
    cached: formatUsd(rates.cachedInput, MODEL_API_PRICE_DECIMALS),
    output: formatUsd(rates.output, MODEL_API_PRICE_DECIMALS),
    attempts: formatNumber(attempts),
    limit: formatNumber(requestCeilingPerAttempt),
  })
}

/**
 * What one prompt/agent hook run may bill (M91, PLAN.md D70): the per-token
 * rates of the model. The total cannot be known in advance, so the popup
 * quotes exactly these; unknown models cannot authorize a hook run.
 */
export function hookModelPrice(modelId: string): string {
  const tier = modelApiPaidTier(modelId)
  return tier === undefined ? UI_TEXT.subagentTariffUnknown : tokenRatePrice(tier)
}

/** The feature's price, as its setting, confirmation, badge and dialog state it. */
export function paidFeaturePrice(feature: PaidFeature): string {
  switch (feature) {
    case 'webSearch': {
      return fill(UI_TEXT.paidWebSearchPrice, {
        price: formatUsd(PAID_PRICES_USD.webSearchPerThousand, 2),
      })
    }
    case 'imageGeneration': {
      return fill(UI_TEXT.paidImagePrice, { price: formatUsd(PAID_PRICES_USD.imageGeneration, 2) })
    }
    case 'voice': {
      return fill(UI_TEXT.paidVoicePrice, { price: formatUsd(PAID_PRICES_USD.voicePerHour, 2) })
    }
    case 'scheduledPrompts':
    case 'autoReviewer':
    case 'tab': {
      // Tab bills ordinary Model API tokens on the request's model (M94,
      // PLAN.md D73); the popup quotes these same tier rates.
      return tokenRatesByTier()
    }
    case 'subagents': {
      return [
        subagentTaskPrice(DEFAULT_MODEL_ID, SUBAGENT_TASK_MAX_REQUESTS),
        subagentTaskPrice(
          `${DEFAULT_MODEL_ID}${CONTRIBUTOR_MODEL_SUFFIX}`,
          SUBAGENT_TASK_MAX_REQUESTS,
        ),
      ].join('\n')
    }
    case 'bestOfN': {
      return [
        bestOfNPrice(
          DEFAULT_MODEL_ID,
          BEST_OF_N_DEFAULT_ATTEMPTS,
          BEST_OF_N_DEFAULT_REQUESTS_PER_ATTEMPT,
        ),
        bestOfNPrice(
          `${DEFAULT_MODEL_ID}${CONTRIBUTOR_MODEL_SUFFIX}`,
          BEST_OF_N_DEFAULT_ATTEMPTS,
          BEST_OF_N_DEFAULT_REQUESTS_PER_ATTEMPT,
        ),
      ].join('\n')
    }
    case 'hookModels': {
      return [
        hookModelPrice(DEFAULT_MODEL_ID),
        hookModelPrice(`${DEFAULT_MODEL_ID}${CONTRIBUTOR_MODEL_SUFFIX}`),
      ].join('\n')
    }
  }
}
