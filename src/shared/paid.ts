import { tokenRatePrice } from './tokenRatePrice'
export { autoReviewPrice } from './reviewPriceText'
import * as z from 'zod/mini'
import {
  Usd,
  type UsdAmount,
  multiplyUsd,
  isPositiveUsd,
  nonnegativeUsdSchema,
  sumUsd,
} from './usd'
// The paid Model API features (M33–M35, PLAN.md D30) as the host, the wire
// protocol and the webview share them: which are on, what this window has
// used, and what that is estimated to cost at Meta's published prices.
//
// Shared by host and webview: no `vscode`, Node, or DOM imports.

import type { ModelPricing } from '../core/providers/priceCard'
import { isJudgeEngineOn } from '../core/judge/engine'
import {
  BEST_OF_N_DEFAULT_ATTEMPTS,
  BEST_OF_N_DEFAULT_REQUESTS_PER_ATTEMPT,
  MUSE_CODE_PAID_FEATURES,
  DEFAULT_MODEL_ID,
  CONTRIBUTOR_MODEL_SUFFIX,
  MODEL_API_PRICES_PER_MILLION,
  MODEL_API_PRICED_MODELS,
  MODEL_API_PRICE_DECIMALS,
  SEARCHES_PER_PRICE_UNIT,
  SECONDS_PER_HOUR,
  PAID_FEATURES,
  PAID_FEATURE_SETTINGS,
  type JudgeEngine,
  type SETTING_DEFAULTS,
  PAID_PRICES_USD,
  type PaidFeature,
  SUBAGENT_TASK_MAX_REQUESTS,
  UI_TEXT,
} from './constants'
import { fill, formatNumber } from './l10n/text'
import { formatUsd } from './l10n/exactUsd'
import type { BackendKind } from './protocol'

/** Consent and dispatch share this immutable, exact, feature-specific authorization. */
export const paidQuoteSchema = /* @__PURE__ */ (() =>
  z.object({
    id: z.string().check(z.minLength(1)),
    feature: z.literal('webSearch'),
    conversationId: z.optional(z.string()),
    maxCalls: z.optional(z.int().check(z.positive())),
    provider: z.string().check(z.minLength(1)),
    model: z.string().check(z.minLength(1)),
    modelRevision: z.int().check(z.nonnegative()),
    tariffUsd: nonnegativeUsdSchema,
    unit: z.literal('search'),
    capturedAt: z.number(),
  }))()
export type PaidQuote = Readonly<z.infer<typeof paidQuoteSchema>>
export function freezePaidQuote(quote: PaidQuote): PaidQuote {
  return Object.freeze(paidQuoteSchema.parse(quote))
}
export function isSamePaidQuote(left: PaidQuote, right: PaidQuote): boolean {
  return (
    left.id === right.id &&
    left.provider === right.provider &&
    left.model === right.model &&
    left.modelRevision === right.modelRevision &&
    left.tariffUsd === right.tariffUsd
  )
}
export interface SearchSettlement {
  readonly quote: PaidQuote
  readonly returnedCalls: number
  readonly costUsd: UsdAmount
  readonly isTerminal: boolean
}
export function searchSettlement(
  quote: PaidQuote,
  returnedCalls: number,
  isTerminal: boolean,
): SearchSettlement {
  if (!Number.isSafeInteger(returnedCalls) || returnedCalls < 0)
    throw new Error('Invalid search count')
  return Object.freeze({
    quote,
    returnedCalls,
    costUsd: multiplyUsd(quote.tariffUsd, returnedCalls),
    isTerminal,
  })
}
export type PaidUseDecision = boolean | PaidQuote | undefined

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
  readonly cacheWriteTokens?: number | undefined
  readonly cacheWriteTokens1h?: number | undefined
  /** A resolved provider receipt; legacy Meta observers keep their existing fields. */
  readonly costUsd?: UsdAmount | undefined
}

/** One key-billed team task the popup names (M96 lane A, PLAN.md D75). */
export interface TeamWorkerConfirmation {
  /** Missing means Meta; other key-billed providers use the unknown-price path. */
  readonly provider?: string
  /** The adapter's tariff identity; changing it asks again even for the same model. */
  readonly priceTier?: string
  readonly role: string
  readonly modelId: string
  /** The task's token ceiling, from the entry's `task` caps or the level. */
  readonly taskCeilingTokens: number
}

/** Runtime paid-use identity: popup grants, tally fields and reference claims. */
export const PAID_USE_REGISTRY = {
  webSearch: { featureId: 'search', tally: 'webSearches', once: 'window' },
  imageGeneration: { featureId: 'images', tally: 'images', once: 'use' },
  voice: { featureId: 'voice', tally: 'voiceSeconds', once: 'use' },
  subagents: {
    featureId: 'subagents',
    tally: 'subagentRequests',
    unknown: 'subagentUnknownRequests',
    once: 'use',
  },
  scheduledPrompts: { featureId: 'schedules', tally: 'scheduledRuns', once: 'use' },
  autoReviewer: {
    featureId: 'auto',
    tally: 'autoReviews',
    unknown: 'autoReviewUnknownRequests',
    once: 'use',
  },
  bestOfN: { featureId: 'best-of-n', tally: 'bestOfNAttempts', once: 'use' },
  tab: { featureId: 'tab', tally: 'tabRequests', once: 'window' },
  hookModels: {
    featureId: 'hook-models',
    tally: 'hookModelRuns',
    unknown: 'hookModelUnknownRequests',
    once: 'use',
  },
  legalExplanation: {
    featureId: 'legal-explanation',
    tally: 'legalExplanations',
    unknown: 'legalExplanationUnknownRequests',
    once: 'use',
  },
  teamWorkers: {
    featureId: 'team-workers',
    tally: 'teamWorkerRequests',
    unknown: 'teamWorkerUnknownRequests',
    once: 'use',
  },
  judge: { featureId: 'judge', tally: 'judgeCalls', unknown: 'judgeUnknownRequests', once: 'use' },
} as const satisfies Readonly<
  Record<
    PaidFeature,
    {
      readonly featureId: string
      readonly tally: keyof PaidTally
      readonly unknown?: keyof PaidTally
      readonly once: 'use' | 'window'
    }
  >
>

/** A boolean switch and the judge enum use their actual runtime predicates. */
export function isPaidSettingOn(
  feature: PaidFeature,
  settings: {
    readonly [
      K in (typeof PAID_FEATURE_SETTINGS)[PaidFeature]
    ]: (typeof SETTING_DEFAULTS)[K] extends boolean ? boolean : JudgeEngine
  },
): boolean {
  return feature === 'judge'
    ? isJudgeEngineOn(settings['judge.engine'])
    : settings[PAID_FEATURE_SETTINGS[feature]]
}

export function paidWindowOnceFeatures(): ReadonlySet<PaidFeature> {
  return new Set(PAID_FEATURES.filter((feature) => PAID_USE_REGISTRY[feature].once === 'window'))
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

/**
 * One paid use the user is asked about (M58, PLAN.md D48): what the popup
 * names before anything is billed. Interactive web search Once covers the window
 * under the same model and price binding; each response still carries its own
 * validated quote and bounded search reservation.
 */
export type PaidUseRequest =
  | { readonly feature: 'judge'; readonly modelId: string; readonly dailyBudgetUsd: UsdAmount }
  | {
      readonly feature: 'webSearch'
      readonly priceUsd: UsdAmount
      readonly quote?: PaidQuote
      readonly isCurrent?: () => boolean
    }
  | { readonly feature: 'voice' }
  | { readonly feature: 'legalExplanation'; readonly modelId: string }
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
      readonly pricing?: ModelPricing | undefined
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
      readonly feature: 'teamWorkers'
      /** The key tasks one `delegate` call starts: each model's prices and each task's ceiling. */
      readonly tasks: readonly TeamWorkerConfirmation[]
      /** The shared daily team budget the popup names; undefined while lanes 0/X land the setting. */
      readonly dailyBudgetUsd: UsdAmount | undefined
      /** Required by the unpriced-provider admission path before it dispatches. */
      readonly dailyBudgetTokens?: number
    }
  | {
      // Inline completions (M94, PLAN.md D73; lane L): the request's model
      // (its per-token rates are quoted) and today's budget cap the popup.
      readonly feature: 'tab'
      readonly modelId: string
      readonly budgetUsd: UsdAmount
    }
  | {
      /** M91 prompt/agent hook handlers (D70): one paid model call per hook run. */
      readonly feature: 'hookModels'
      /** The hook event the handler runs on. */
      readonly event: string
      /** The handler kind, as written in the file. */
      readonly kind: 'prompt' | 'agent'
      readonly modelId: string
      readonly dailyBudgetUsd?: UsdAmount | undefined
    }

/**
 * The paid features a window can use (M44, PLAN.md D37): every one on the
 * Model API backend; on Muse Code, the extension's features billed to a
 * stored key, including key-billed team tasks; none without that key.
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
      isPositiveUsd(paidCostUsd(feature, tally)) ||
      (feature === 'scheduledPrompts' && tally.scheduledRuns > 0) ||
      (feature === 'subagents' && (tally.subagentRequests ?? 0) > 0) ||
      (feature === 'autoReviewer' && (tally.autoReviews ?? 0) > 0) ||
      (feature === 'legalExplanation' && (tally.legalExplanations ?? 0) > 0) ||
      (feature === 'bestOfN' && (tally.bestOfNAttempts ?? 0) > 0) ||
      (feature === 'teamWorkers' && (tally.teamWorkerRequests ?? 0) > 0) ||
      (feature === 'tab' && (tally.tabRequests ?? 0) > 0) ||
      (feature === 'hookModels' && (tally.hookModelRuns ?? 0) > 0) ||
      (feature === 'judge' && (tally.judgeCalls ?? 0) > 0),
  )
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

/** Exact scheduled-run tariff; unknown models cannot authorize a paid request. */
export function scheduledRunPrice(modelId: string): string {
  const tier = modelApiPaidTier(modelId)
  if (tier === undefined) {
    throw new Error(UI_TEXT.subagentTariffUnknown)
  }
  return tokenRatePrice(tier)
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
export function paidFeaturePrice(feature: PaidFeature, searchPriceUsd?: UsdAmount): string {
  switch (feature) {
    case 'webSearch': {
      const price =
        searchPriceUsd ??
        Usd.from(PAID_PRICES_USD.webSearchPerThousand).divide(SEARCHES_PER_PRICE_UNIT).toAmount()
      if (
        !nonnegativeUsdSchema.safeParse(price).success ||
        Usd.from(price).compare(Usd.from(0)) < 0
      )
        throw new Error(UI_TEXT.sessionBudgetSearchUnavailable)
      return fill(UI_TEXT.paidWebSearchPrice, {
        price: formatUsd(multiplyUsd(price, SEARCHES_PER_PRICE_UNIT), 2),
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
    case 'legalExplanation':
    case 'tab':
    case 'judge': {
      // The judge runs on the conversation's own model, at its token rates.
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
    case 'teamWorkers': {
      // The popup quotes each started task's own model and ceiling
      // (teamWorkerPrice); the setting names the tiers it may bill.
      return tokenRatesByTier()
    }
    case 'hookModels': {
      return [
        hookModelPrice(DEFAULT_MODEL_ID),
        hookModelPrice(`${DEFAULT_MODEL_ID}${CONTRIBUTOR_MODEL_SUFFIX}`),
      ].join('\n')
    }
  }
}

import { modelApiPaidTier, type PaidTally } from './paidBoundary'
export {
  paidTallySchema,
  EMPTY_PAID_TALLY,
  modelApiPaidTier,
  paidStateSchema,
} from './paidBoundary'
export type { PaidTally, PaidState } from './paidBoundary'
/** The estimated cost of one feature's use in the tally, in dollars. */
export function paidCostUsd(feature: PaidFeature, tally: PaidTally): UsdAmount {
  switch (feature) {
    case 'webSearch': {
      if (tally.webSearchCharges === undefined) {
        return Usd.from(PAID_PRICES_USD.webSearchPerThousand)
          .times(tally.webSearches)
          .divide(SEARCHES_PER_PRICE_UNIT)
          .toAmount()
      }
      let cost = Usd.from(0)
      for (const charge of tally.webSearchCharges) {
        cost = cost.add(Usd.from(charge.priceUsd).times(charge.units))
      }
      return cost.toAmount()
    }
    case 'imageGeneration': {
      return multiplyUsd(Usd.from(PAID_PRICES_USD.imageGeneration).toAmount(), tally.images)
    }
    case 'voice': {
      return Usd.from(PAID_PRICES_USD.voicePerHour)
        .times(tally.voiceSeconds)
        .divideIntegerCeiling(SECONDS_PER_HOUR)
        .toAmount()
    }
    case 'scheduledPrompts': {
      // Scheduled runs use ordinary Model API tokens. UsageDialog prices those
      // tokens already; adding them to the extra-features total doubles them.
      return Usd.from(0).toAmount()
    }
    case 'subagents': {
      return Usd.from(tally.subagentCostUsd ?? 0).toAmount()
    }
    case 'autoReviewer': {
      // Billed apart from the conversation, so counted here alone.
      return Usd.from(tally.autoReviewCostUsd ?? 0).toAmount()
    }
    case 'legalExplanation': {
      return Usd.from(tally.legalExplanationCostUsd ?? 0).toAmount()
    }
    case 'teamWorkers': {
      return Usd.from(tally.teamWorkerCostUsd ?? 0).toAmount()
    }
    case 'bestOfN': {
      // Separate worktree hosts do not contribute to the parent's token
      // estimate. Count only reported costs here, not unknown HTTP tries.
      return Usd.from(tally.bestOfNCostUsd ?? 0).toAmount()
    }
    case 'tab': {
      // Tab requests are billed apart from every conversation, so they are
      // counted here alone. Count only reported costs, not unknown tries.
      return Usd.from(tally.tabCostUsd ?? 0).toAmount()
    }
    case 'hookModels': {
      // A hook's own model call is billed apart from the conversation, like
      // a review's. Count only reported costs, not unanswered runs.
      return Usd.from(tally.hookModelCostUsd ?? 0).toAmount()
    }
    case 'judge': {
      // Billed apart from the conversation, so counted here alone.
      return Usd.from(tally.judgeCostUsd ?? 0).toAmount()
    }
  }
}

/** The whole tally's estimated cost. */
export function paidTotalUsd(tally: PaidTally): UsdAmount {
  // Child token cost is already part of the conversation's token estimate.
  let total = Usd.from(0).toAmount()
  for (const feature of PAID_FEATURES) {
    if (feature !== 'subagents' && feature !== 'teamWorkers') {
      total = sumUsd(total, paidCostUsd(feature, tally))
    }
  }
  return total
}
