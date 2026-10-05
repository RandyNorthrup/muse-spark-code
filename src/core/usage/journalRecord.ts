// Canonical Usage is already normalised by the captured provider codecs.
// Never add cached input or reasoning output a second time here.
import {
  MODEL_API_PRICED_MODELS,
  MODEL_API_PRICES_VERIFIED_ON,
  PAID_PRICES_USD,
  PAID_PRICES_VERIFIED_ON,
  SEARCHES_PER_PRICE_UNIT,
  SECONDS_PER_HOUR,
  USAGE_JOURNAL_VERSION,
} from '../../shared/constants'
import {
  usageRecordSchema,
  usageTokensSchema,
  type UsageCost,
  type UsageRecord,
  type UsageTokens,
} from '../../shared/usageJournal'
import type { Usage } from '../backends/modelapi/schemas'
import {
  isValidUsage,
  settleUsageUsd,
  ticksToUsdPerToken,
  type ModelPricing,
  type PriceCard,
  type PricedUsage,
} from '../providers/priceCard'
import { estimateCostUsd } from './insights'

export type UsageRecordContext = Omit<
  UsageRecord,
  'v' | 'type' | 'tokens' | 'cost' | 'day' | 'timezoneOffsetMins'
> & {
  readonly pricing?: ModelPricing
  /** The same model's list card only; never an alias or a user override. */
  readonly apiEquivalentCard?: PriceCard
  readonly priceDate?: string
  readonly providerCostUsd?: number
  readonly costInUsdTicks?: number
  readonly estimatedTokens?: boolean
  readonly uncertain?: boolean
  readonly retainedLiabilityUsd?: number
}

export function usageLocalDay(at: number): string {
  const date = new Date(at)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

export function normaliseUsage(
  usage: Partial<Usage> | undefined,
  isEstimated = false,
): UsageTokens {
  if (usage === undefined) {
    return {}
  }
  const details = usage.input_tokens_details
  const written = details?.cache_write_tokens
  const written1h = details?.cache_write_tokens_1h
  const tokens = usageTokensSchema.parse({
    ...(usage.input_tokens !== undefined && { input: usage.input_tokens }),
    ...(usage.output_tokens !== undefined && { output: usage.output_tokens }),
    ...(details?.cached_tokens !== undefined && { cached: details.cached_tokens }),
    ...(written !== undefined && { cacheWrite: written }),
    ...(written1h !== undefined && { cacheWrite1h: written1h }),
    ...(written !== undefined && written1h !== undefined && { cacheWrite5m: written - written1h }),
    ...(usage.output_tokens_details?.reasoning_tokens !== undefined && {
      reasoning: usage.output_tokens_details.reasoning_tokens,
    }),
    ...(isEstimated && { estimated: true }),
  })
  const billable = pricedUsage(tokens)
  if (
    (billable !== undefined && !isValidUsage(billable)) ||
    (tokens.input !== undefined &&
      (tokens.cached ?? 0) + (tokens.cacheWrite ?? 0) > tokens.input) ||
    (tokens.cacheWrite1h ?? 0) > (tokens.cacheWrite ?? 0) ||
    (tokens.output !== undefined && (tokens.reasoning ?? 0) > tokens.output)
  ) {
    throw new Error('invalidUsage')
  }
  return tokens
}

function pricedUsage(tokens: UsageTokens): PricedUsage | undefined {
  return tokens.input === undefined || tokens.output === undefined
    ? undefined
    : {
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        cachedTokens: tokens.cached,
        cacheWriteTokens: tokens.cacheWrite,
        cacheWriteTokens1h: tokens.cacheWrite1h,
      }
}

function cardCost(card: PriceCard, tokens: UsageTokens): number | undefined {
  const billable = pricedUsage(tokens)
  return billable === undefined ? undefined : settleUsageUsd(card, billable)
}

function metaCost(context: UsageRecordContext, tokens: UsageTokens): number | undefined {
  if (context.provider !== 'meta' && context.backend !== 'museCode') {
    return undefined
  }
  const models: readonly string[] = Object.values(MODEL_API_PRICED_MODELS).flat()
  const billable = pricedUsage(tokens)
  return billable !== undefined && models.includes(context.model)
    ? estimateCostUsd({ ...billable, cachedTokens: billable.cachedTokens ?? 0 }, context.model)
    : undefined
}

function paidCost(context: UsageRecordContext): number | undefined {
  const units = context.units
  if (context.kind === 'search' && units?.searches !== undefined) {
    return (units.searches / SEARCHES_PER_PRICE_UNIT) * PAID_PRICES_USD.webSearchPerThousand
  }
  if (context.kind === 'image' && units?.images !== undefined) {
    return units.images * PAID_PRICES_USD.imageGeneration
  }
  return context.kind === 'voice' && units?.audioSeconds !== undefined
    ? (units.audioSeconds / SECONDS_PER_HOUR) * PAID_PRICES_USD.voicePerHour
    : undefined
}

function settleCost(context: UsageRecordContext, tokens: UsageTokens): UsageCost {
  const pricing = context.pricing
  if (pricing?.kind === 'local') {
    return { certainty: 'local', usd: 0 }
  }
  const isPlan = context.backend === 'museCode' || pricing?.kind === 'plan'
  if (isPlan) {
    const card = context.apiEquivalentCard
    const usd = card?.source === 'list' ? cardCost(card, tokens) : metaCost(context, tokens)
    return { certainty: 'plan', ...(usd !== undefined && { apiEquivalentUsd: usd }) }
  }
  if (context.uncertain === true || context.kind === 'voice') {
    const usd = context.retainedLiabilityUsd ?? paidCost(context)
    return { certainty: 'uncertain', ...(usd !== undefined && { usd }) }
  }
  const reported = context.providerCostUsd
  const usd =
    reported !== undefined && Number.isFinite(reported) && reported >= 0
      ? reported
      : context.costInUsdTicks === undefined
        ? undefined
        : ticksToUsdPerToken(context.costInUsdTicks)
  if (usd !== undefined) {
    return { certainty: 'reported', usd }
  }
  const card = pricing?.kind === 'priced' ? pricing.card : undefined
  const tool = paidCost(context)
  const computed = tool ?? (card === undefined ? metaCost(context, tokens) : cardCost(card, tokens))
  if (computed === undefined) {
    return {
      certainty:
        tokens.input === undefined && pricing?.kind === 'priced' ? 'uncertain' : 'unpriced',
    }
  }
  const date =
    context.priceDate ??
    (tool === undefined
      ? card === undefined
        ? MODEL_API_PRICES_VERIFIED_ON
        : card.fetchedAt?.split('T', 1)[0]
      : PAID_PRICES_VERIFIED_ON)
  return {
    certainty: context.estimatedTokens === true ? 'estimated' : 'computed',
    usd: computed,
    source: tool !== undefined || card === undefined ? 'meta-published' : card.source,
    ...(date !== undefined && { date }),
  }
}

/** Copies only the journal's allow-listed fields; context cannot smuggle content. */
export function createUsageRecord(
  usage: Partial<Usage> | undefined,
  context: UsageRecordContext,
): UsageRecord {
  const tokens = normaliseUsage(usage, context.estimatedTokens)
  return usageRecordSchema.parse({
    v: USAGE_JOURNAL_VERSION,
    type: 'usage',
    id: context.id,
    at: context.at,
    startedAt: context.startedAt,
    day: usageLocalDay(context.at),
    timezoneOffsetMins: new Date(context.at).getTimezoneOffset(),
    client: context.client,
    backend: context.backend,
    provider: context.provider,
    model: context.model,
    served: context.served,
    kind: context.kind,
    tokens,
    units: context.units,
    cost: settleCost(context, tokens),
    outcome: context.outcome,
    durationMs: context.durationMs,
    firstTokenMs: context.firstTokenMs,
    retries: context.retries,
    rateLimited: context.rateLimited,
    retryDelayMs: context.retryDelayMs,
    session: context.session,
    packedAvoided: context.packedAvoided,
    headers: context.headers,
  })
}
