import { Usd, type UsdAmount } from '../../shared/usd'
import * as z from 'zod/mini'
import { TOKENS_PER_MILLION } from '../../shared/constants'
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
// bounds it). Price-card inputs preserve the captured numeric shape; admission and
// settlement use canonical decimal USD amounts.

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
  /**
   * The long-context tier (xAI bills every token at it from 200k;
   * OpenAI's starts at 272k and reprices cached reads and writes too).
   * A tier cache rate the list does not give falls back to the card's own
   * cache rate, then to the tier's input rate; nothing is guessed.
   */
  readonly longContextTier?:
    | {
        readonly fromTokens: number
        readonly input: number
        readonly output: number
        readonly cachedInput?: number | undefined
        readonly cacheWrite?: number | undefined
        readonly cacheWrite1h?: number | undefined
      }
    | undefined
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
  /**
   * Cache-write tokens counted inside inputTokens, disjoint from cachedTokens.
   * Canonical input is fresh + read + written (OpenAI captures 02-tool-call/03-tool-result-stream).
   * Codecs whose native input excludes read/write must normalize to this total.
   */
  readonly cacheWriteTokens?: number | undefined
  /**
   * The 1-hour-written subset of `cacheWriteTokens` (Anthropic's 1-hour
   * cache, OpenRouter's 1 h write): settled at the 1 h write rate, disjoint
   * from the 5-minute remainder. Absent where the provider reports none.
   */
  readonly cacheWriteTokens1h?: number | undefined
  readonly outputTokens: number
}

/**
 * Whether every count is a finite, non-negative number, with read plus
 * written at most the total and the 1-hour-written at most the written.
 */
export function isValidUsage(usage: PricedUsage): boolean {
  const counts = [
    usage.inputTokens,
    usage.outputTokens,
    usage.cachedTokens ?? 0,
    usage.cacheWriteTokens ?? 0,
    usage.cacheWriteTokens1h ?? 0,
  ]
  return (
    counts.every((count) => Number.isSafeInteger(count) && !(count < 0)) &&
    (usage.cachedTokens ?? 0) + (usage.cacheWriteTokens ?? 0) <= usage.inputTokens &&
    (usage.cacheWriteTokens1h ?? 0) <= (usage.cacheWriteTokens ?? 0)
  )
}

/**
 * Written tokens split into the 5-minute remainder and the 1-hour subset,
 * for a host that prices or stores the two TTLs apart (M101 lane P2; lane I
 * wires the consumers).
 */
export function splitCacheWrites(usage: PricedUsage): {
  readonly standard: number
  readonly oneHour: number
} {
  const oneHour = usage.cacheWriteTokens1h ?? 0
  return { standard: (usage.cacheWriteTokens ?? 0) - oneHour, oneHour }
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
  const tierCacheRates = [tier?.cachedInput ?? 0, tier?.cacheWrite ?? 0, tier?.cacheWrite1h ?? 0]
  return (
    tier === undefined ||
    (Number.isFinite(tier.fromTokens) &&
      tier.fromTokens > 0 &&
      Number.isFinite(tier.input) &&
      tier.input >= 0 &&
      Number.isFinite(tier.output) &&
      tier.output >= 0 &&
      tierCacheRates.every((rate) => Number.isFinite(rate) && rate >= 0))
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

/** Captured provider-list rates, converted to the card's USD per-token unit. */
export function listedPriceCard(
  preset: string,
  native: Readonly<Record<string, unknown>>,
): PriceCard | undefined {
  const rate = z.number().check(z.nonnegative())
  if (preset === 'xai') {
    const prices = z
      .object({
        prompt_text_token_price: rate,
        completion_text_token_price: rate,
        cached_prompt_text_token_price: z.optional(rate),
        prompt_text_token_price_long_context: z.optional(rate),
        completion_text_token_price_long_context: z.optional(rate),
        cached_prompt_text_token_price_long_context: z.optional(rate),
        long_context_threshold: z.optional(rate),
      })
      .safeParse(native)
    if (!prices.success) return undefined
    const p = prices.data
    return {
      input: ticksToUsdPerToken(p.prompt_text_token_price) ?? NaN,
      output: ticksToUsdPerToken(p.completion_text_token_price) ?? NaN,
      cachedInput:
        p.cached_prompt_text_token_price === undefined
          ? undefined
          : ticksToUsdPerToken(p.cached_prompt_text_token_price),
      ...(p.long_context_threshold !== undefined &&
        p.prompt_text_token_price_long_context !== undefined &&
        p.completion_text_token_price_long_context !== undefined && {
          longContextTier: {
            fromTokens: p.long_context_threshold,
            input: ticksToUsdPerToken(p.prompt_text_token_price_long_context) ?? NaN,
            output: ticksToUsdPerToken(p.completion_text_token_price_long_context) ?? NaN,
            cachedInput:
              p.cached_prompt_text_token_price_long_context === undefined
                ? undefined
                : ticksToUsdPerToken(p.cached_prompt_text_token_price_long_context),
          },
        }),
      source: 'list',
    }
  }
  const millionRates = z.object({ input: rate, output: rate, cached_input: z.optional(rate) })
  if (preset === 'together') {
    const prices = millionRates.safeParse(native['pricing'])
    if (!prices.success) return undefined
    return {
      input: prices.data.input / TOKENS_PER_MILLION,
      output: prices.data.output / TOKENS_PER_MILLION,
      cachedInput:
        prices.data.cached_input === undefined
          ? undefined
          : prices.data.cached_input / TOKENS_PER_MILLION,
      source: 'list',
    }
  }
  if (preset === 'huggingface') {
    const upstreams = z
      .array(
        z.object({
          status: z.string(),
          pricing: z.optional(millionRates),
        }),
      )
      .safeParse(native['providers'])
    if (!upstreams.success) return undefined
    const cards = upstreams.data
      .filter((row) => row.status === 'live' && row.pricing !== undefined)
      .flatMap((row) => (row.pricing === undefined ? [] : [row.pricing]))
    if (cards.length === 0) return undefined
    // The router may choose any live upstream: show the highest captured
    // input/output rates, rather than promising one cheaper upstream.
    return {
      input: Math.max(...cards.map((card) => card.input)) / TOKENS_PER_MILLION,
      output: Math.max(...cards.map((card) => card.output)) / TOKENS_PER_MILLION,
      source: 'list',
    }
  }
  const decimal = z.string().check(z.refine((text) => parseDecimalPrice(text) !== undefined))
  const parsed = z
    .object({
      prompt: decimal,
      completion: decimal,
      input_cache_read: z.optional(decimal),
      input_cache_write: z.optional(decimal),
      input_cache_write_1h: z.optional(decimal),
      request: z.optional(decimal),
      image: z.optional(decimal),
    })
    .safeParse(native['pricing'])
  if (!parsed.success) return undefined
  const input = parseDecimalPrice(parsed.data.prompt)
  const output = parseDecimalPrice(parsed.data.completion)
  if (input === undefined || output === undefined) return undefined
  const optional = (text: string | undefined) =>
    text === undefined ? undefined : parseDecimalPrice(text)
  return {
    input,
    output,
    cachedInput: optional(parsed.data.input_cache_read),
    cacheWrite: optional(parsed.data.input_cache_write),
    cacheWrite1h: optional(parsed.data.input_cache_write_1h),
    request: optional(parsed.data.request),
    image: optional(parsed.data.image),
    source: 'list',
  }
}

/** xAI's integer unit: ticks of 1e-10 USD per token. */
const XAI_TICKS_PER_USD = 1e10

/** xAI's integer prices (1e-10 USD per token) as USD per token. */
export function ticksToUsdPerToken(ticks: number): number | undefined {
  const amount = ticksToUsdAmount(ticks)
  return amount === undefined ? undefined : Number(amount)
}

export function ticksToUsdAmount(ticks: number): UsdAmount | undefined {
  return Number.isFinite(ticks) && ticks >= 0
    ? Usd.from(ticks).divide(XAI_TICKS_PER_USD).toAmount()
    : undefined
}

/**
 * The card's input/output rates for this usage: the long-context tier past
 * its threshold, else the card's own rates. The tier itself is returned so
 * callers can reach its cache rates.
 */
function longContextRates(
  card: PriceCard,
  usage: PricedUsage,
): {
  readonly tier: PriceCard['longContextTier']
  readonly isLongContext: boolean
  readonly inputRate: number
  readonly outputRate: number
} {
  const tier = card.longContextTier
  const isLongContext = tier !== undefined && usage.inputTokens >= tier.fromTokens
  return {
    tier,
    isLongContext,
    inputRate: isLongContext ? tier.input : card.input,
    outputRate: isLongContext ? tier.output : card.output,
  }
}

/**
 * The reservation for a request: the worst case. Input at the full input
 * price (the long-context tier when the estimate reaches it), regardless of
 * estimated cache hits. Known write premiums are reserved in addition;
 * output and a per-request flat price are reserved too.
 */
export function reserveRequestAmount(card: PriceCard, usage: PricedUsage): UsdAmount {
  const { tier, isLongContext, inputRate, outputRate } = longContextRates(card, usage)
  // Cold writes are bounded at the dearest applicable write price: the
  // card's own write rates, plus the tier's where the estimate reaches it.
  const writeCandidates: number[] = [card.cacheWrite, card.cacheWrite1h].filter(
    (rate): rate is number => rate !== undefined,
  )
  if (isLongContext && tier !== undefined) {
    writeCandidates.push(
      ...[tier.cacheWrite, tier.cacheWrite1h].filter((rate): rate is number => rate !== undefined),
    )
  }
  const writeRate = Math.max(inputRate, ...writeCandidates)
  return Usd.from(inputRate)
    .times(usage.inputTokens)
    .add(
      Usd.from(writeRate)
        .subtract(Usd.from(inputRate))
        .times(usage.cacheWriteTokens ?? 0),
    )
    .add(Usd.from(outputRate).times(usage.outputTokens))
    .add(Usd.from(card.request ?? 0))
    .toAmount()
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
export function settleUsageCost(
  card: PriceCard,
  usage: PricedUsage,
  reported?: { readonly cost?: number | undefined; readonly costInUsdTicks?: number | undefined },
): { readonly usd: UsdAmount; readonly upperBound: boolean } | undefined {
  if (reported?.cost !== undefined && Number.isFinite(reported.cost) && reported.cost >= 0) {
    return { usd: Usd.from(reported.cost).toAmount(), upperBound: false }
  }
  if (reported?.costInUsdTicks !== undefined) {
    const converted = ticksToUsdPerToken(reported.costInUsdTicks)
    if (converted !== undefined) {
      return {
        usd: Usd.from(reported.costInUsdTicks).divide(XAI_TICKS_PER_USD).toAmount(),
        upperBound: false,
      }
    }
  }
  if (!isValidPriceCard(card) || !isValidUsage(usage)) {
    return undefined
  }
  const { tier, isLongContext, inputRate, outputRate } = longContextRates(card, usage)
  const rates = {
    read: (isLongContext ? tier?.cachedInput : undefined) ?? card.cachedInput,
    write: (isLongContext ? tier?.cacheWrite : undefined) ?? card.cacheWrite,
    write1h: (isLongContext ? tier?.cacheWrite1h : undefined) ?? card.cacheWrite1h,
  }
  // An unpriced reported class is bounded by the dearest applicable input-side rate.
  const highest = Math.max(
    inputRate,
    card.input,
    card.cachedInput ?? 0,
    card.cacheWrite ?? 0,
    card.cacheWrite1h ?? 0,
    ...(isLongContext
      ? [tier?.input ?? 0, tier?.cachedInput ?? 0, tier?.cacheWrite ?? 0, tier?.cacheWrite1h ?? 0]
      : []),
  )
  const readRate = rates.read ?? highest
  const writeRate = rates.write ?? highest
  const write1hRate = rates.write1h ?? highest
  const read = usage.cachedTokens ?? 0
  const { standard: written5m, oneHour: written1h } = splitCacheWrites(usage)
  const fresh = usage.inputTokens - read - written5m - written1h
  const usd = Usd.from(inputRate)
    .times(fresh)
    .add(Usd.from(readRate).times(read))
    .add(Usd.from(writeRate).times(written5m))
    .add(Usd.from(write1hRate).times(written1h))
    .add(Usd.from(outputRate).times(usage.outputTokens))
    .add(Usd.from(card.request ?? 0))
    .toAmount()
  return {
    usd,
    upperBound:
      (read > 0 && rates.read === undefined) ||
      (written5m > 0 && rates.write === undefined) ||
      (written1h > 0 && rates.write1h === undefined),
  }
}

export function settleUsageAmount(
  card: PriceCard,
  usage: PricedUsage,
  reported?: { readonly cost?: number | undefined; readonly costInUsdTicks?: number | undefined },
): UsdAmount | undefined {
  return settleUsageCost(card, usage, reported)?.usd
}

/** Numeric projections for the existing usage reports. Admission uses exact amounts. */
export function reserveRequestUsd(card: PriceCard, usage: PricedUsage): number {
  return Number(reserveRequestAmount(card, usage))
}

/** Numeric projection for captured usage report schemas. */
export function settleUsageUsd(
  card: PriceCard,
  usage: PricedUsage,
  reported?: { readonly cost?: number | undefined; readonly costInUsdTicks?: number | undefined },
): number | undefined {
  const amount = settleUsageAmount(card, usage, reported)
  return amount === undefined ? undefined : Number(amount)
}
