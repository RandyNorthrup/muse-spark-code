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
  PROVIDER_PRICE_MAX_DECIMALS,
  PAID_FEATURES,
  PAID_FEATURE_SETTINGS,
  type JudgeEngine,
  type SETTING_DEFAULTS,
  PAID_PRICES_USD,
  type PaidFeature,
  SUBAGENT_TASK_MAX_REQUESTS,
  TOKENS_PER_MILLION,
  UI_TEXT,
} from './constants'
import { fill, formatNumber, formatUsd } from './l10n/text'
import type { BackendKind } from './protocol'

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
  readonly costUsd?: number | undefined
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
  webSearch: { featureId: 'search', tally: 'webSearches', once: 'use' },
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
 * names before anything is billed. Web search asks once per prompt, since
 * Meta runs the searches inside the response and the model decides whether
 * to search at all.
 */
export type PaidUseRequest =
  | { readonly feature: 'judge'; readonly modelId: string; readonly dailyBudgetUsd: number }
  | { readonly feature: 'webSearch' }
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
      readonly dailyBudgetUsd: number | undefined
      /** Required by the unpriced-provider admission path before it dispatches. */
      readonly dailyBudgetTokens?: number
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
      paidCostUsd(feature, tally) > 0 ||
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
    teamWorkers: UI_TEXT.paidTeamWorkersName,
    tab: UI_TEXT.paidTabName,
    hookModels: UI_TEXT.paidHookModelName,
    judge: UI_TEXT.paidJudgeName,
    legalExplanation: UI_TEXT.paidLegalExplanationName,
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
export function autoReviewPrice(modelId: string, pricing?: ModelPricing): string | undefined {
  if (pricing !== undefined) return providerPriceText(pricing)
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

import { modelApiPaidTier, paidCostUsd, type PaidTally } from './paidBoundary'
export {
  paidTallySchema,
  EMPTY_PAID_TALLY,
  modelApiPaidTier,
  paidStateSchema,
  paidCostUsd,
  paidTotalUsd,
} from './paidBoundary'
export type { PaidTally, PaidState } from './paidBoundary'
/** Resolved provider rates, including cache-write premiums and long-context tiers. */
function providerPriceText(pricing: ModelPricing): string | undefined {
  if (pricing.kind === 'unpriced') return undefined
  if (pricing.kind === 'local') return UI_TEXT.modelLocal
  if (pricing.kind === 'plan') return UI_TEXT.modelPlan
  const card = pricing.card
  const basic = fill(UI_TEXT.paidProviderPrice, {
    input: providerPriceRate(card.input),
    cached: providerPriceRate(card.cachedInput ?? card.input),
    write: providerPriceRate(card.cacheWrite ?? card.input),
    write1h: providerPriceRate(card.cacheWrite1h ?? card.cacheWrite ?? card.input),
    output: providerPriceRate(card.output),
    request: providerPriceAmount(card.request ?? 0),
    image: providerPriceAmount(card.image ?? 0),
  })
  const tier = card.longContextTier
  return tier === undefined
    ? basic
    : [
        basic,
        fill(UI_TEXT.paidProviderPriceTier, {
          threshold: formatNumber(tier.fromTokens),
          input: providerPriceRate(tier.input),
          output: providerPriceRate(tier.output),
        }),
      ].join('\n')
}

function providerPriceAmount(value: number): string {
  return formatUsd(value, MODEL_API_PRICE_DECIMALS, PROVIDER_PRICE_MAX_DECIMALS)
}

function providerPriceRate(value: number): string {
  return providerPriceAmount(value * TOKENS_PER_MILLION)
}
