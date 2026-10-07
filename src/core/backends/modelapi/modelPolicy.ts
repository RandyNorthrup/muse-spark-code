import { Usd, type UsdAmount } from '../../../shared/usd'
// M95-I's single capability adapter. CAPREC replaces the evidence join here;
// consumers retain the distinctions between unknown and unsupported. Provider
// core stays in dist/providers.js, so only its types cross this seam.
import type { ModelApiClient, ProviderClient } from './client'
import type { ModelSummary } from '../../agent/agentBackend'
import type { CreateResponseBody, Usage } from './schemas'
import { estimateCostUsd } from '../../usage/insights'
import {
  MODEL_API_BASE_URL,
  MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS,
  MODEL_API_PRICES_PER_MILLION,
  MODEL_API_MODEL_PREFIX,
  MODEL_API_CONTEXT_WINDOW,
  TOKENS_PER_MILLION,
} from '../../../shared/constants'
import type { ModelCapabilities } from '../../providers/capabilities'
import type { ModelPricing, PricedUsage } from '../../providers/priceCard'

import { effortLevelsFor } from '../../../shared/effort'
import { modelApiPaidTier } from '../../../shared/paid'

/** The configured provider and exact model that produced opaque reasoning. */
export interface ReplayProducer {
  readonly provider: string
  readonly model: string
}

/** Bare references remain Meta's; qualified references name their configured provider. */
export function replayProducer(model: string): ReplayProducer {
  const slash = model.indexOf('/')
  return { provider: slash === -1 ? 'meta' : model.slice(0, slash), model }
}

export type Known<T> =
  | { readonly state: 'yes'; readonly value: T }
  | { readonly state: 'no' }
  | { readonly state: 'unknown' }

/** Evidence supplied by the registry, without inventing missing model facts. */
export interface ModelPolicyEvidence {
  readonly capabilities?: Partial<ModelCapabilities> | undefined
  readonly maxOutputTokens?: number | undefined
  readonly effortLevels?: readonly string[] | undefined
  readonly canDisableReasoning?: boolean | undefined
  readonly webSearch?: boolean | undefined
  readonly pricing?: ModelPricing | undefined
}

export interface ModelPolicy {
  readonly identity: { readonly provider: string; readonly nativeModel: string }
  readonly tools: { readonly calling: Known<true>; readonly parallel: Known<true> }
  readonly reasoning: {
    readonly effortLevels: Known<readonly string[]>
    readonly canDisable: Known<true>
  }
  readonly output: { readonly maxTokens?: number | undefined }
  readonly hosted: { readonly webSearch: Known<true> }
  readonly pricing: ModelPricing
}

function knownFlag(flag: boolean | undefined): Known<true> {
  if (flag === undefined) return { state: 'unknown' }
  return flag ? { state: 'yes', value: true } : { state: 'no' }
}

/** Meta records come exclusively from the existing Meta constants. */
export function modelPolicyFor(model: string, evidence: ModelPolicyEvidence = {}): ModelPolicy {
  const producer = replayProducer(model)
  const isMeta = producer.provider === 'meta' && model.startsWith(MODEL_API_MODEL_PREFIX)
  const tier = isMeta ? modelApiPaidTier(model) : undefined
  const rates = tier === undefined ? undefined : MODEL_API_PRICES_PER_MILLION[tier]
  const slash = model.indexOf('/')
  const capabilities = isMeta
    ? { toolCalling: true, vision: true, reasoning: true, parallelToolCalls: true }
    : evidence.capabilities
  const levels = isMeta ? effortLevelsFor(model) : evidence.effortLevels
  // BYO native hosted routes/prices are a captured M95 follow-up. A native
  // capability alone cannot authorize Meta's tool shape or search fee.
  const webSearch: Known<true> = { state: evidence.webSearch === false ? 'no' : 'unknown' }
  let pricing: ModelPricing = evidence.pricing ?? { kind: 'unpriced' }
  if (isMeta) {
    pricing =
      rates === undefined
        ? { kind: 'unpriced' }
        : {
            kind: 'priced',
            card: {
              input: Number(Usd.from(rates.input).divide(TOKENS_PER_MILLION).toAmount()),
              cachedInput: Number(
                Usd.from(rates.cachedInput).divide(TOKENS_PER_MILLION).toAmount(),
              ),
              output: Number(Usd.from(rates.output).divide(TOKENS_PER_MILLION).toAmount()),
              source: 'catalogue',
            },
          }
  }
  return {
    identity: {
      provider: producer.provider,
      nativeModel: slash === -1 ? model : model.slice(slash + 1),
    },
    tools: {
      calling: knownFlag(capabilities?.toolCalling),
      parallel: knownFlag(capabilities?.parallelToolCalls),
    },
    reasoning: {
      effortLevels: levels === undefined ? { state: 'unknown' } : { state: 'yes', value: levels },
      canDisable: knownFlag(isMeta || evidence.canDisableReasoning),
    },
    output: {
      maxTokens: isMeta ? MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS : evidence.maxOutputTokens,
    },
    hosted: { webSearch: isMeta ? { state: 'yes', value: true } : webSearch },
    pricing,
  }
}

/** The harness ceiling is separate from an unknown provider output maximum. */
export function outputLimitFor(policy: ModelPolicy, ceiling: number): number {
  const maximum = policy.output.maxTokens
  return maximum === undefined ? ceiling : Math.min(ceiling, maximum)
}

/** Do not invent Meta effort tiers for a BYO model with no reasoning evidence. */
export function effortForPolicy(policy: ModelPolicy, requested: string): string {
  if (policy.identity.provider === 'meta') {
    return requested === 'none' ? 'minimal' : requested
  }
  const levels = policy.reasoning.effortLevels
  return levels.state === 'yes' && levels.value.includes(requested) ? requested : 'none'
}

/** Price-card operations run in the lazy provider bundle. Unpriced is never zero. */
export interface ModelPricedUsage extends PricedUsage {
  readonly cacheWriteTokens1h?: number | undefined
  readonly images?: number | undefined
}

/** The images in this request, including replayed attachments. */
export function requestImageCount(body: CreateResponseBody): number {
  return body.input.reduce(
    (count, item) =>
      count +
      (item.type === 'message'
        ? item.content.filter((part) => part.type === 'input_image').length
        : 0),
    0,
  )
}

export function modelPricedUsage(usage: Usage): ModelPricedUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: usage.input_tokens_details?.cache_write_tokens ?? 0,
    cacheWriteTokens1h: usage.input_tokens_details?.cache_write_tokens_1h,
  }
}

export function metaResolvedModel(ref: string, client: ProviderClient): ResolvedModel {
  const isPlan = client.isPlanModel?.(ref) === true
  const policy = modelPolicyFor(
    ref,
    isPlan ? { capabilities: { toolCalling: true }, pricing: { kind: 'plan' } } : {},
  )
  const estimate = (usage: PricedUsage) => {
    if (isPlan) return Usd.from(0).toAmount()
    return policy.pricing.kind === 'priced'
      ? estimateCostUsd({ ...usage, cachedTokens: usage.cachedTokens ?? 0 }, ref)
      : undefined
  }
  return {
    ref,
    contextTokens: MODEL_API_CONTEXT_WINDOW,
    client,
    origin: client.provider?.origin ?? new URL(MODEL_API_BASE_URL).origin,
    policy,
    price: { reserve: estimate, settle: estimate },
    isCurrent: () => true,
  }
}

export interface ModelPricePolicy {
  readonly reserve: (usage: ModelPricedUsage) => UsdAmount | undefined
  readonly settle: (
    usage: ModelPricedUsage,
    reported?: { readonly cost?: number | undefined; readonly costInUsdTicks?: number | undefined },
  ) => UsdAmount | undefined
}

/** Structural client seam; ModelApiClient and lane T's ProviderClient both satisfy it. */
export type ModelClient = Pick<
  ModelApiClient,
  | 'streamResponse'
  | 'countInputTokens'
  | 'listModels'
  | 'currentKeyDigest'
  | 'retryDelayMs'
  | 'waitBeforeRetry'
>

export interface ResolvedModel {
  readonly contextTokens?: number | undefined
  readonly ref: string
  readonly origin: string
  readonly client: ModelClient
  readonly policy: ModelPolicy
  readonly price: ModelPricePolicy
  /** Configuration, capability/price evidence and auth lane still match this resolution. */
  readonly isCurrent: () => boolean
}

export interface ModelResolver {
  readonly list?: (() => Promise<readonly ModelSummary[]>) | undefined
  readonly resolve: (ref: string) => Promise<ResolvedModel>
}
