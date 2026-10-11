import { freezePaidQuote } from '../../../src/shared/paid'
import { Usd } from '../../../src/shared/usd'

export function quotedSearch(tariff: string, model = 'model-a', id = model + tariff) {
  const quote = freezePaidQuote({
    id,
    feature: 'webSearch',
    provider: 'meta',
    model,
    modelRevision: 0,
    tariffUsd: Usd.from(tariff).toAmount(),
    unit: 'search',
    capturedAt: 0,
  })
  return { feature: 'webSearch', priceUsd: quote.tariffUsd, quote } as const
}
