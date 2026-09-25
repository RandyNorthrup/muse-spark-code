// The paid Model API features (M33–M35, PLAN.md D30) as the host, the wire
// protocol and the webview share them: which are on, what this window has
// used, and what that is estimated to cost at Meta's published prices.
//
// Shared by host and webview: no `vscode`, Node, or DOM imports.

import * as z from 'zod/mini'
import {
  PAID_FEATURES,
  PAID_PRICES_USD,
  type PaidFeature,
  SEARCHES_PER_PRICE_UNIT,
  SECONDS_PER_HOUR,
  UI_TEXT,
} from './constants'
import { fill, formatUsd } from './l10n/text'

/** What this window used of each paid feature since it opened. */
export const paidTallySchema = z.object({
  webSearches: z.number(),
  images: z.number(),
  voiceSeconds: z.number(),
})
export type PaidTally = z.infer<typeof paidTallySchema>

export const EMPTY_PAID_TALLY: PaidTally = { webSearches: 0, images: 0, voiceSeconds: 0 }

/** The features that are on (setting on and price accepted), and the tally. */
export const paidStateSchema = z.object({
  features: z.array(z.enum(PAID_FEATURES)),
  tally: paidTallySchema,
})
export type PaidState = z.infer<typeof paidStateSchema>

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
  }
}

/** The whole tally's estimated cost. */
export function paidTotalUsd(tally: PaidTally): number {
  return PAID_FEATURES.reduce((sum, feature) => sum + paidCostUsd(feature, tally), 0)
}

// Built per call, never at module load: the display language's table is
// installed after this module loads (PLAN.md D33).

/** The feature's short name, as the badge and the dialog show it. */
export function paidFeatureName(feature: PaidFeature): string {
  const names: Readonly<Record<PaidFeature, string>> = {
    webSearch: UI_TEXT.paidWebSearchName,
    imageGeneration: UI_TEXT.paidImageGenerationName,
    voice: UI_TEXT.paidVoiceName,
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
  }
}
