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
  /** A reasoning-token price where one differs (DeepSeek's catalogue `cost.reasoning`). */
  readonly reasoning?: number | undefined
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
  /**
   * Reasoning tokens, counted inside `outputTokens` (OpenAI's usage
   * semantics: `completion_tokens` includes them; Gemini's
   * `thoughtsTokenCount` maps here too). Absent stays unknown, never zero.
   */
  readonly reasoningTokens?: number | undefined
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
    usage.reasoningTokens ?? 0,
    usage.cachedTokens ?? 0,
    usage.cacheWriteTokens ?? 0,
    usage.cacheWriteTokens1h ?? 0,
  ]
  return (
    counts.every((count) => Number.isFinite(count) && !(count < 0)) &&
    (usage.cachedTokens ?? 0) + (usage.cacheWriteTokens ?? 0) <= usage.inputTokens &&
    (usage.cacheWriteTokens1h ?? 0) <= (usage.cacheWriteTokens ?? 0) &&
    (usage.reasoningTokens ?? 0) <= usage.outputTokens
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
    card.reasoning ?? 0,
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

/**
 * One Hugging Face router upstream's price card, from the live `/v1/models`
 * row (router.huggingface.co, read 2026-10-12): each live upstream states
 * its own `pricing{input, output}` per 1M tokens, `context_length` and its
 * `supports_tools` / `supports_structured_output` flags.
 */
export interface HuggingFaceUpstream {
  readonly upstream: string
  readonly card: PriceCard
  readonly contextLength?: number | undefined
  readonly supportsTools?: boolean | undefined
  readonly supportsStructuredOutput?: boolean | undefined
}

/**
 * Per-upstream cards from a Hugging Face router `/v1/models` row, cheapest
 * input first. Only `live` upstreams with pricing; anything else stays
 * unpriced, never guessed. Reservations still take the dearest
 * (reserveWorstCaseUsd); an explicitly chosen upstream settles at its own
 * card, and the reply names it in the suffixed model id.
 */
export function huggingFaceUpstreamCards(native: unknown): HuggingFaceUpstream[] {
  const rate = z.number().check(z.nonnegative())
  const row = z.object({ providers: z.unknown() }).safeParse(native)
  if (!row.success) return []
  const upstreams = z
    .array(
      z.object({
        provider: z.string(),
        status: z.string(),
        context_length: z.optional(rate),
        pricing: z.optional(z.object({ input: rate, output: rate })),
        supports_tools: z.optional(z.boolean()),
        supports_structured_output: z.optional(z.boolean()),
      }),
    )
    .safeParse(row.data.providers)
  if (!upstreams.success) return []
  return upstreams.data
    .filter((row) => row.status === 'live' && row.pricing !== undefined)
    .flatMap((row) =>
      row.pricing === undefined
        ? []
        : [
            {
              upstream: row.provider,
              card: {
                input: row.pricing.input / TOKENS_PER_MILLION,
                output: row.pricing.output / TOKENS_PER_MILLION,
                source: 'list' as const,
                upstream: row.provider,
              },
              ...(row.context_length !== undefined && { contextLength: row.context_length }),
              ...(row.supports_tools !== undefined && { supportsTools: row.supports_tools }),
              ...(row.supports_structured_output !== undefined && {
                supportsStructuredOutput: row.supports_structured_output,
              }),
            },
          ],
    )
    .toSorted((left, right) => left.card.input - right.card.input)
}

const catalogueRateShape = {
  input: z.number().check(z.nonnegative()),
  output: z.number().check(z.nonnegative()),
  cache_read: z.optional(z.number().check(z.nonnegative())),
  cache_write: z.optional(z.number().check(z.nonnegative())),
}

const catalogueTierSchema = z.object({
  ...catalogueRateShape,
  tier: z.object({ type: z.string(), size: z.number().check(z.positive()) }),
})

/** A catalogue `cost` block, per 1M tokens, as the snapshot carries it. */
export const catalogueCostSchema = z.object({
  ...catalogueRateShape,
  reasoning: z.optional(z.number().check(z.nonnegative())),
  context_over_200k: z.optional(z.object({ ...catalogueRateShape })),
  tiers: z.optional(z.array(catalogueTierSchema)),
})

/**
 * A catalogue `cost` block (the vendored models.dev snapshot, per 1M
 * tokens) as a price card, for any preset. Reads the long-context tier
 * (`context_over_200k`, else the first context `tiers[]` entry: Gemini 2.5
 * Pro $2.50/$15 past 200k prompts, ai.google.dev/gemini-api/docs/pricing,
 * read 2026-10-12), DeepSeek's `cost.reasoning`, and Groq's documented
 * halved cached-input price where no cached rate is listed
 * (console.groq.com/docs/prompt-caching: "a 50% discount for cached input
 * tokens", read 2026-10-12). Anything the block does not give stays absent.
 */
export function cataloguePriceCard(preset: string, cost: unknown): PriceCard | undefined {
  const parsed = catalogueCostSchema.safeParse(cost)
  if (!parsed.success) return undefined
  const data = parsed.data
  const contextTier = data.tiers?.find((row) => row.tier.type === 'context')
  // The tier entry's own size wins (OpenAI reprices from 272k); without one,
  // `context_over_200k` starts past 200k prompts.
  const tier =
    contextTier === undefined
      ? data.context_over_200k === undefined
        ? undefined
        : { fromTokens: 200_000, ...data.context_over_200k }
      : {
          fromTokens: contextTier.tier.size,
          input: contextTier.input,
          output: contextTier.output,
          ...(contextTier.cache_read !== undefined && { cache_read: contextTier.cache_read }),
          ...(contextTier.cache_write !== undefined && { cache_write: contextTier.cache_write }),
        }
  const cachedPerMillion =
    data.cache_read ?? (preset === 'groq' ? data.input * GROQ_CACHED_INPUT_FRACTION : undefined)
  return {
    input: data.input / TOKENS_PER_MILLION,
    output: data.output / TOKENS_PER_MILLION,
    ...(cachedPerMillion !== undefined && { cachedInput: cachedPerMillion / TOKENS_PER_MILLION }),
    ...(data.cache_write !== undefined && { cacheWrite: data.cache_write / TOKENS_PER_MILLION }),
    ...(data.reasoning !== undefined && { reasoning: data.reasoning / TOKENS_PER_MILLION }),
    ...(tier !== undefined &&
      tier.fromTokens > 0 && {
        longContextTier: {
          fromTokens: tier.fromTokens,
          input: tier.input / TOKENS_PER_MILLION,
          output: tier.output / TOKENS_PER_MILLION,
          ...(tier.cache_read !== undefined && {
            cachedInput: tier.cache_read / TOKENS_PER_MILLION,
          }),
          ...(tier.cache_write !== undefined && {
            cacheWrite: tier.cache_write / TOKENS_PER_MILLION,
          }),
        },
      }),
    source: 'catalogue',
  }
}

/**
 * Groq's documented cached-input price as a fraction of input where the
 * catalogue lists none (console.groq.com/docs/prompt-caching, read
 * 2026-10-12: "There is a 50% discount for cached input tokens"). A billed
 * receipt has not confirmed its application per model (capture GQ-C1).
 */
const GROQ_CACHED_INPUT_FRACTION = 0.5

/** xAI's integer unit: ticks of 1e-10 USD per token. */
const XAI_TICKS_PER_USD = 1e10

/** xAI's integer prices (1e-10 USD per token) as USD per token. */
export function ticksToUsdPerToken(ticks: number): number | undefined {
  return Number.isFinite(ticks) && ticks >= 0 ? ticks / XAI_TICKS_PER_USD : undefined
}

/** A reported tick count as exact dollars: a power-of-ten division, never a float. */
export function ticksAmount(ticks: number): UsdAmount | undefined {
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
  // Reasoning tokens reserve at their own rate where it is dearer: the
  // estimate does not yet know the split, so all output reserves there.
  const reserveOutputRate = Math.max(outputRate, card.reasoning ?? outputRate)
  return Usd.from(inputRate)
    .times(usage.inputTokens)
    .add(
      Usd.from(writeRate)
        .subtract(Usd.from(inputRate))
        .times(usage.cacheWriteTokens ?? 0),
    )
    .add(Usd.from(reserveOutputRate).times(usage.outputTokens))
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
export function settleUsageAmount(
  card: PriceCard,
  usage: PricedUsage,
  reported?: {
    readonly cost?: UsdAmount | undefined
    readonly costInUsdTicks?: number | undefined
  },
): UsdAmount | undefined {
  if (reported?.cost !== undefined && Usd.from(reported.cost).compare(Usd.from(0)) >= 0) {
    return Usd.from(reported.cost).toAmount()
  }
  if (reported?.costInUsdTicks !== undefined) {
    const converted = ticksAmount(reported.costInUsdTicks)
    if (converted !== undefined) return converted
  }
  if (!isValidPriceCard(card) || !isValidUsage(usage)) {
    return undefined
  }
  const { tier, isLongContext, inputRate, outputRate } = longContextRates(card, usage)
  // Long-context tiers reprice cached reads and writes too; a tier cache
  // rate the list does not give falls back to the card's own, then to the
  // tier's input rate.
  const readRate =
    (isLongContext && tier !== undefined ? tier.cachedInput : undefined) ??
    card.cachedInput ??
    inputRate
  const writeRate =
    (isLongContext && tier !== undefined ? tier.cacheWrite : undefined) ??
    card.cacheWrite ??
    inputRate
  const write1hRate =
    (isLongContext && tier !== undefined ? tier.cacheWrite1h : undefined) ??
    card.cacheWrite1h ??
    writeRate
  const read = usage.cachedTokens ?? 0
  const { standard: written5m, oneHour: written1h } = splitCacheWrites(usage)
  const fresh = usage.inputTokens - read - written5m - written1h
  // Reasoning tokens settle at their own rate where the card carries one
  // (DeepSeek's catalogue `cost.reasoning`); the rest of output settles at
  // the output rate. Absent the count, all of output does.
  const thought = usage.reasoningTokens ?? 0
  const thoughtRate = card.reasoning ?? outputRate
  return Usd.from(inputRate)
    .times(fresh)
    .add(Usd.from(readRate).times(read))
    .add(Usd.from(writeRate).times(written5m))
    .add(Usd.from(write1hRate).times(written1h))
    .add(Usd.from(thoughtRate).times(thought))
    .add(Usd.from(outputRate).times(usage.outputTokens - thought))
    .add(Usd.from(card.request ?? 0))
    .toAmount()
}

/** Numeric projections for the existing usage reports. Admission uses exact amounts. */
export function reserveRequestUsd(card: PriceCard, usage: PricedUsage): number {
  return Number(reserveRequestAmount(card, usage))
}

/** Numeric projection for captured usage report schemas. */
export function settleUsageUsd(
  card: PriceCard,
  usage: PricedUsage,
  reported?: {
    readonly cost?: UsdAmount | undefined
    readonly costInUsdTicks?: number | undefined
  },
): number | undefined {
  const amount = settleUsageAmount(card, usage, reported)
  return amount === undefined ? undefined : Number(amount)
}
