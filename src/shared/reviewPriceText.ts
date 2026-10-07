// Provider review quotes are read only with the review or usage surface.
import type { ModelPricing } from '../core/providers/priceCard'
import {
  UI_TEXT,
  MODEL_API_PRICE_DECIMALS,
  PROVIDER_PRICE_MAX_DECIMALS,
  TOKENS_PER_MILLION,
} from './constants'
import { fill, formatNumber, formatUsdAtPrecision, uiLocale } from './l10n/text'
import { Usd } from './usd'
import { USD_DECIMAL_RADIX } from './usdConstants'
import { modelApiPaidTier } from './paidBoundary'
import { tokenRatePrice } from './tokenRatePrice'

/** One Auto review's tariff on the conversation's model (M78); undefined without a verified price. */
export function autoReviewPrice(modelId: string, pricing?: ModelPricing): string | undefined {
  if (pricing !== undefined) return providerPriceText(pricing)
  const tier = modelApiPaidTier(modelId)
  return tier === undefined ? undefined : tokenRatePrice(tier)
}

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
  const exact = Usd.from(value)
  if (value > 0 && value < USD_DECIMAL_RADIX ** -PROVIDER_PRICE_MAX_DECIMALS) {
    return new Intl.NumberFormat(uiLocale(), {
      style: 'currency',
      currency: 'USD',
      notation: 'scientific',
      minimumFractionDigits: MODEL_API_PRICE_DECIMALS,
      maximumFractionDigits: MODEL_API_PRICE_DECIMALS,
    }).format(value)
  }
  const decimal = exact.toString()
  const precision = Math.max(
    MODEL_API_PRICE_DECIMALS,
    Math.min(PROVIDER_PRICE_MAX_DECIMALS, decimal.split('.', 2)[1]?.length ?? 0),
  )
  return formatUsdAtPrecision(exact, precision)
}

function providerPriceRate(value: number): string {
  return providerPriceAmount(value * TOKENS_PER_MILLION)
}
