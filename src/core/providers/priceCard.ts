// A model's price card (M95, PLAN.md D74). Prices drive budgets and are
// never guessed. Sources, in order: the provider's own models list where it
// prices (OpenRouter, xAI, Together, Groq, Hugging Face's router), the
// vendored models.dev snapshot, what the user entered in the panel. A local
// model is free; a plan's model is "plan" (M95b). Anything else is
// **unpriced**: it runs, its tokens are counted and shown, the UI says
// "unpriced", and a session with a dollar cap refuses it before sending.
// Reservations take the worst case; settlement takes the provider's actual
// cost where it reports one (OpenRouter's `cost`, xAI's `cost_in_usd_ticks`
// in 1e-10 USD). DeepSeek's off-peak half price is ignored (the peak price
// bounds it). Pure; amounts are plain USD numbers.

/** Where a price card's numbers came from, in D74's source order. */
export type PriceSource = 'list' | 'catalogue' | 'user'

/** USD prices for one model, per token unless said otherwise. */
export interface PriceCard {
  readonly input: number
  readonly cachedInput?: number | undefined
  readonly cacheWrite?: number | undefined
  /** The 1 h write where it differs (OpenRouter lists it). */
  readonly cacheWrite1h?: number | undefined
  readonly output: number
  /** A flat USD price per request where one exists (OpenRouter, Groq). */
  readonly request?: number | undefined
  /** A flat USD price per image where one exists (OpenRouter). */
  readonly image?: number | undefined
  /** The long-context tier (xAI bills every token at it from 200k). */
  readonly longContextTier?:
    { readonly fromTokens: number; readonly input: number; readonly output: number } | undefined
  readonly source: PriceSource
  /** When list prices were fetched (the panel shows it; refreshed on Refresh). */
  readonly fetchedAt?: string | undefined
  /** Which upstream's prices these are (OpenRouter's endpoints, HF's router). */
  readonly upstream?: string | undefined
}

/** What a model costs: priced, unpriced, free (local) or plan-paid (M95b). */
export type ModelPricing =
  | { readonly kind: 'priced'; readonly card: PriceCard }
  | { readonly kind: 'unpriced' }
  | { readonly kind: 'local' }
  | { readonly kind: 'plan' }

/** Tokens a cost estimate covers. */
export interface PricedUsage {
  readonly inputTokens: number
  /** Cached input tokens, counted inside `inputTokens`. */
  readonly cachedTokens?: number | undefined
  /** Cache-write tokens where the provider reports them. */
  readonly cacheWriteTokens?: number | undefined
  readonly outputTokens: number
}

/** Whether every count is a finite, non-negative number with cached at most input. */
export function isValidUsage(usage: PricedUsage): boolean {
  const counts = [
    usage.inputTokens,
    usage.outputTokens,
    usage.cachedTokens ?? 0,
    usage.cacheWriteTokens ?? 0,
  ]
  return (
    counts.every((count) => Number.isFinite(count) && !(count < 0)) &&
    (usage.cachedTokens ?? 0) <= usage.inputTokens
  )
}

/** Whether a card's own rates are finite and non-negative. */
export function isValidPriceCard(card: PriceCard): boolean {
  const rates = [
    card.input,
    card.output,
    card.cachedInput ?? 0,
    card.cacheWrite ?? 0,
    card.cacheWrite1h ?? 0,
    card.request ?? 0,
    card.image ?? 0,
  ]
  if (rates.some((rate) => !Number.isFinite(rate) || rate < 0)) {
    return false
  }
  const tier = card.longContextTier
  return (
    tier === undefined ||
    (Number.isFinite(tier.fromTokens) &&
      tier.fromTokens > 0 &&
      Number.isFinite(tier.input) &&
      tier.input >= 0 &&
      Number.isFinite(tier.output) &&
      tier.output >= 0)
  )
}

/**
 * The card to price with: the first valid card in D74's source order
 * (list, catalogue, user). Undefined when none applies.
 */
export function resolvePriceCard(cards: readonly PriceCard[]): PriceCard | undefined {
  const rank: Record<PriceSource, number> = { list: 0, catalogue: 1, user: 2 }
  return cards
    .filter((card) => isValidPriceCard(card))
    .toSorted((a, b) => rank[a.source] - rank[b.source])
    .at(0)
}

/** An OpenRouter-style decimal-string price (USD per token) as a number. */
export function parseDecimalPrice(text: string): number | undefined {
  if (text.trim() === '') {
    return undefined
  }
  const value = Number(text)
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

/** xAI's integer unit: ticks of 1e-10 USD per token. */
const XAI_TICKS_PER_USD = 1e10

/** xAI's integer prices (1e-10 USD per token) as USD per token. */
export function ticksToUsdPerToken(ticks: number): number | undefined {
  return Number.isFinite(ticks) && ticks >= 0 ? ticks / XAI_TICKS_PER_USD : undefined
}

/**
 * The reservation for a request: the worst case. Input at the full input
 * price (the long-context tier when the estimate reaches it), cached input
 * at no less than the read price where one exists, output at the output
 * price, plus a per-request flat price where one exists.
 */
export function reserveRequestUsd(card: PriceCard, usage: PricedUsage): number {
  const tier = card.longContextTier
  const isLongContext = tier !== undefined && usage.inputTokens >= tier.fromTokens
  const inputRate = isLongContext ? tier.input : card.input
  const outputRate = isLongContext ? tier.output : card.output
  const cached = Math.min(usage.cachedTokens ?? 0, usage.inputTokens)
  const fresh = usage.inputTokens - cached
  const readRate = Math.min(card.cachedInput ?? card.input, card.input)
  return (
    fresh * inputRate +
    cached * readRate +
    (usage.cacheWriteTokens ?? 0) * (card.cacheWrite ?? 0) +
    usage.outputTokens * outputRate +
    (card.request ?? 0)
  )
}

/**
 * The worst-case reservation across upstream cards (OpenRouter and
 * Hugging Face's router may route to the dearest upstream). Undefined for
 * no valid card.
 */
export function reserveWorstCaseUsd(
  cards: readonly PriceCard[],
  usage: PricedUsage,
): number | undefined {
  const valid = cards.filter((card) => isValidPriceCard(card))
  return valid.length === 0
    ? undefined
    : Math.max(...valid.map((card) => reserveRequestUsd(card, usage)))
}

/**
 * What a request cost: the provider's reported cost where there is one
 * (OpenRouter's `cost`, xAI's `cost_in_usd_ticks`), otherwise the card's
 * rates over the usage. Invalid usage leaves the cost unknown (the session
 * budget then closes) rather than guessing zero.
 */
export function settleUsageUsd(
  card: PriceCard,
  usage: PricedUsage,
  reported?: { readonly cost?: number | undefined; readonly costInUsdTicks?: number | undefined },
): number | undefined {
  if (reported?.cost !== undefined && Number.isFinite(reported.cost) && reported.cost >= 0) {
    return reported.cost
  }
  if (reported?.costInUsdTicks !== undefined) {
    const converted = ticksToUsdPerToken(reported.costInUsdTicks)
    if (converted !== undefined) {
      return converted
    }
  }
  return !isValidPriceCard(card) || !isValidUsage(usage)
    ? undefined
    : reserveRequestUsd(card, usage)
}
