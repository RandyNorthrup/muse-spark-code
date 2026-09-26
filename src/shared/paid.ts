// The paid Model API features (M33–M35, PLAN.md D30) as the host, the wire
// protocol and the webview share them: which are on, what this window has
// used, and what that is estimated to cost at Meta's published prices.
//
// Shared by host and webview: no `vscode`, Node, or DOM imports.

import * as z from 'zod/mini'
import {
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
  // Optional for panels saved before M48; absent means no child use recorded.
  subagentRequests: z.optional(z.int().check(z.nonnegative())),
  subagentUnknownRequests: z.optional(z.int().check(z.nonnegative())),
  subagentTokens: z.optional(z.int().check(z.nonnegative())),
  subagentCostUsd: z.optional(z.number().check(z.nonnegative())),
})
export type PaidTally = z.infer<typeof paidTallySchema>

export const EMPTY_PAID_TALLY: PaidTally = { webSearches: 0, images: 0, voiceSeconds: 0 }

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
})
export type PaidState = z.infer<typeof paidStateSchema>

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
    case 'subagents': {
      return tally.subagentCostUsd ?? 0
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
      (feature === 'subagents' && (tally.subagentRequests ?? 0) > 0),
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
    subagents: UI_TEXT.paidSubagentsName,
  }
  return names[feature]
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
    case 'subagents': {
      return [
        subagentTaskPrice(DEFAULT_MODEL_ID, SUBAGENT_TASK_MAX_REQUESTS),
        subagentTaskPrice(
          `${DEFAULT_MODEL_ID}${CONTRIBUTOR_MODEL_SUFFIX}`,
          SUBAGENT_TASK_MAX_REQUESTS,
        ),
      ].join('\n')
    }
  }
}
