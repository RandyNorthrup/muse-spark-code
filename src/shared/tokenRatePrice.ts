import { UI_TEXT, MODEL_API_PRICES_PER_MILLION, MODEL_API_PRICE_DECIMALS } from './constants'
import { fill, formatUsd } from './l10n/text'

export function tokenRatePrice(tier: keyof typeof MODEL_API_PRICES_PER_MILLION): string {
  const rates = MODEL_API_PRICES_PER_MILLION[tier]
  return fill(UI_TEXT.paidScheduledPrice, {
    input: formatUsd(rates.input, MODEL_API_PRICE_DECIMALS),
    cached: formatUsd(rates.cachedInput, MODEL_API_PRICE_DECIMALS),
    output: formatUsd(rates.output, MODEL_API_PRICE_DECIMALS),
  })
}
