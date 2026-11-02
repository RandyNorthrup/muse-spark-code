// The one Wonder-tier refusal (RLF-WONDER). A leaf of its own, like
// outputTokenMinimum.ts: the team registry and both Muse Code-backed
// worker starts share it without carrying the paid schemas.
import { MODEL_API_PRICED_MODELS } from './constants'
import { fill, UI_TEXT } from './l10n/text'

/**
Whether the id's verified Model API tariff is the Wonder tariff: exactly
the ids `modelApiPaidTier` (paidBoundary.ts) reports as `'wonder'`. Such
an id is priced on the Model API backend, but it is not a standard (or
contributor) Muse Code tier, so a Muse Code-backed team worker must
never send a request for it under the standard label: its billed tier
there is not the one the pool named.
*/
export function isWonderTierModel(modelId: string): boolean {
  const wonder: readonly string[] = MODEL_API_PRICED_MODELS.wonder
  return wonder.includes(modelId)
}

/** The said refusal for a Wonder-tier id named as a Muse Code team model. */
export function wonderTierRefusal(modelId: string): string {
  return fill(UI_TEXT.teamWonderTierRefused, { model: modelId })
}
