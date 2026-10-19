// The chat's own money hooks (STARTUP017): the composer's paid badge and
// dictate tooltip, row badges and reply usage costs. They read the shared
// money chunk through the hub (`money.tsx`), and live apart from it so the
// panels that share the hub's chunk do not carry them.
import { UI_TEXT, type PaidFeature } from '../shared/constants'
import { fill, formatTokenWindow } from '../shared/l10n/text'
import type { UsdAmount } from '../shared/usdSchema'
import { type MoneyImporter, useMoneyDisplay } from './money'

/**
 * An exact feature price, or undefined while the money chunk loads. The
 * tariff states every price it can compute and throws when it cannot; a
 * price failure keeps its kind past this hook to the error boundary — it
 * is never read as unpriced.
 */
export function usePaidFeaturePrice(
  feature: PaidFeature | undefined,
  importer?: MoneyImporter,
): string | undefined {
  const api = useMoneyDisplay(importer, feature !== undefined)
  if (api === undefined || feature === undefined) {
    return
  }
  return api.paidFeaturePrice(feature)
}

/**
 * Exact prices for several features, or undefined until every one is known.
 * A price failure keeps its kind past this hook to the error boundary;
 * it is never read as unpriced.
 */
export function usePaidFeaturePrices(
  features: readonly PaidFeature[],
  importer?: MoneyImporter,
): ReadonlyMap<PaidFeature, string> | undefined {
  const api = useMoneyDisplay(importer, features.length > 0)
  if (api === undefined) {
    return
  }
  return new Map(features.map((feature) => [feature, api.paidFeaturePrice(feature)] as const))
}

/** A reply's usage line with its exact cost, or undefined until loaded. */
export function useReplyUsageText(
  inputTokens: number,
  outputTokens: number,
  costUsd: UsdAmount,
  importer?: MoneyImporter,
): string | undefined {
  const api = useMoneyDisplay(importer)
  if (api === undefined) {
    return
  }
  return fill(UI_TEXT.replyUsage, {
    input: formatTokenWindow(inputTokens),
    output: formatTokenWindow(outputTokens),
    cost: api.formatReplyCost(costUsd),
  })
}
