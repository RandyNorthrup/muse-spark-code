import { Usd, type UsdAmount } from '../../../shared/usd'
// M95-I's single capability adapter. CAPREC replaces the evidence join here;
// consumers retain the distinctions between unknown and unsupported. Provider
// core stays in dist/providers.js, so only its types cross this seam.
import type { ModelApiClient, ProviderClient } from './client'
import type { UnattendedRun } from '../../schedules/unattended'
import type { ModelSummary } from '../../agent/agentBackend'
import type { CreateResponseBody, Usage } from './schemas'
import { estimateCostUsd } from '../../usage/insights'
import {
  EFFORT_PROVIDER_DEFAULT,
  MODEL_API_BASE_URL,
  MODEL_API_MIN_OUTPUT_TOKENS,
  MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS,
  MODEL_API_PRICES_PER_MILLION,
  MODEL_API_MODEL_PREFIX,
  MODEL_API_CONTEXT_WINDOW,
  THINKING_OFF_EFFORT,
  TOKENS_PER_MILLION,
  UI_TEXT,
} from '../../../shared/constants'
import type { ModelCapabilities } from '../../providers/capabilities'
import type { ModelCapabilityRecord } from '../../providers/capabilityRecord'
import type { ModelPricing, PricedUsage } from '../../providers/priceCard'

import { outputTokenMinimumMessage } from '../../../shared/providerRouting'
import { effortLevelsFor, resolveReasoning, type ReasoningControl } from '../../../shared/effort'
import { modelApiPaidTier } from '../../../shared/paid'
import { planOfferedLevels, resolvePlanEffort, type ChatGptPlanFacts } from './planFacts'

/** The configured provider and exact model that produced opaque reasoning. */
export interface ReplayProducer {
  readonly account?: string | undefined
  readonly origin?: string | undefined
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

/**
The record-sourced optional reasoning facts (lane REASONSHAPESR2):
the affirmed Thinking-off value, the list's default effort,
manual-only thinking, the preset's Thinking-off switch and the
full-vocabulary flag. Evidence and policy share them; the policy
adds the resolved level list and disable flag.
*/
export interface ReasoningPolicyFields {
  /**
  The Thinking-off value the record affirms instead of `disabled`
  (Claude Sonnet 5.5's `between_tools`, lane REASONSHAPESR2): Thinking
  off rides to the codec on a model whose `disabled` is refused.
  */
  readonly offSwitch?: 'disabled' | 'between_tools' | undefined
  /**
  The list's own default effort where it names one (lane REASONSHAPESR2,
  XAI-G01). The picker falls back to the highest served tier without it.
  */
  readonly defaultEffort?: string | undefined
  /**
  Manual-only thinking (lane REASONSHAPESR2, GAPANTH-G10/G17): manual
  mode carries no effort level, so an on-level request the record does
  not list rides through unnamed (the tier sizes the budget) instead
  of resolving to the provider default — otherwise a model that
  supports extended thinking could never think.
  */
  readonly manualOnly?: boolean | undefined
  /** The preset's documented Thinking-off switch (lane DSTHINK3). */
  readonly thinkingOff?: 'thinking-switch' | 'reasoning-enabled' | undefined
  /** The preset documents its effort vocabulary for every model. */
  readonly sendUndeclaredEffort?: boolean | undefined
}

/** Evidence supplied by the registry, without inventing missing model facts. */
export interface ModelPolicyEvidence extends ReasoningPolicyFields {
  readonly capabilities?: Partial<ModelCapabilities> | undefined
  readonly maxOutputTokens?: number | undefined
  /** A captured provider minimum for max_output_tokens; unknown keeps 1. */
  readonly minOutputTokens?: number | undefined
  readonly effortLevels?: readonly string[] | undefined
  /** The plan catalogue's own facts for this model, where the catalogue named it. */
  readonly planFacts?: ChatGptPlanFacts | undefined
  readonly canDisableReasoning?: boolean | undefined
  readonly webSearch?: boolean | undefined
  readonly pricing?: ModelPricing | undefined
}

export interface ModelPolicy {
  readonly identity: { readonly provider: string; readonly nativeModel: string }
  readonly tools: { readonly calling: Known<true>; readonly parallel: Known<true> }
  readonly reasoning: ReasoningPolicyFields & {
    readonly effortLevels: Known<readonly string[]>
    readonly canDisable: Known<true>
    readonly thinkingOff?: 'thinking-switch' | 'reasoning-enabled' | undefined
    /** The plan catalogue's own facts, carried for the plan send path only. */
    readonly planFacts?: ChatGptPlanFacts | undefined
  }
  readonly output: {
    readonly maxTokens?: number | undefined
    readonly minTokens?: number | undefined
  }
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
  const planFacts = isMeta ? undefined : evidence.planFacts
  const levels = isMeta
    ? effortLevelsFor(model)
    : (evidence.effortLevels ??
      (planFacts === undefined ? undefined : planOfferedLevels(planFacts)))
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
      ...(evidence.offSwitch !== undefined && { offSwitch: evidence.offSwitch }),
      ...(evidence.defaultEffort !== undefined && { defaultEffort: evidence.defaultEffort }),
      ...(evidence.manualOnly !== undefined && { manualOnly: evidence.manualOnly }),
      ...(!isMeta && evidence.thinkingOff !== undefined && { thinkingOff: evidence.thinkingOff }),
      ...(!isMeta && evidence.sendUndeclaredEffort === true && { sendUndeclaredEffort: true }),
      ...(!isMeta && planFacts !== undefined && { planFacts }),
    },
    output: {
      maxTokens: isMeta ? MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS : evidence.maxOutputTokens,
      minTokens: isMeta ? MODEL_API_MIN_OUTPUT_TOKENS : evidence.minOutputTokens,
    },
    hosted: { webSearch: isMeta ? { state: 'yes', value: true } : webSearch },
    pricing,
  }
}

/** The harness ceiling is separate from an unknown provider output maximum. */
export function outputLimitFor(policy: ModelPolicy, ceiling: number): number {
  const maximum = policy.output.maxTokens
  const cap = maximum === undefined ? ceiling : Math.min(ceiling, maximum)
  const minimum = minOutputTokensForPolicy(policy)
  if (cap < minimum) throw new RangeError(outputTokenMinimumMessage(minimum))
  return cap
}

/**
The smallest max_output_tokens the provider accepts (Meta's live capture
is 16). Requests below it are rejected by the provider, so a budget that
cannot fit it refuses instead of sending. Unknown keeps 1.
*/
export function minOutputTokensForPolicy(policy: Pick<ModelPolicy, 'output'>): number {
  return policy.output.minTokens ?? 1
}

/**
Whether the record affirms the model takes an effort value (lane
REASONSHAPESR2): declared levels with at least one level besides
`none`. A model without usable levels gets no reasoning field in any
request: the parameter itself is what providers such as xAI refuse.
*/
export function hasUsableEffortLevels(levels: Known<readonly string[]>): boolean {
  return levels.state === 'yes' && levels.value.some((level) => level !== THINKING_OFF_EFFORT)
}

/**
The resolver input for a policy (lane REASONSHAPESR2): unwraps the
record's `Known<>` facts into the shared control. The resolver and
its test mirror build it here, so the mirror checks decisions, not
plumbing.
*/
export function reasoningControlForPolicy(
  policy: Pick<ModelPolicy, 'reasoning'>,
): ReasoningControl {
  const { effortLevels, canDisable, thinkingOff } = policy.reasoning
  return {
    effortLevels: effortLevels.state === 'yes' ? effortLevels.value : undefined,
    canDisable: canDisable.state === 'yes',
    thinkingOff,
  }
}

/**
Meta's client-side tiers (lane REASONSHAPES): `ultra` is an alias, not
a tier of its own: the 1.4.x live probe (`docs/certification/m3.md`,
one turn per tier) shows the CLI forwards `ultra` to the API as `max`
(the 1.2 400 for `ultra` names `'max'`), and the SDK types `ultra` in
the client-side `ReasoningEffort` vocabulary (`@muse-code/sdk`
`dist/src/msp.d.ts:1258`). `none` rides as `minimal` the same way.
Other providers get `undefined`: the record decides for them.
*/
export function metaRequestedEffort(
  policy: Pick<ModelPolicy, 'identity'>,
  requested: string,
): string | undefined {
  if (policy.identity.provider !== 'meta') return undefined
  if (requested === 'ultra') return 'max'
  return requested === 'none' ? 'minimal' : requested
}

/**
Routing preamble shared by the resolver and its test mirror (lane
REASONSHAPESR2): the Meta mapping and the full-vocabulary passthrough
are stable round-1 routing, so both sides call it and the mirror keeps
only the decision branches it checks. Returns the effort where routing
decides it, else `undefined`.
*/
export function routedEffortForPolicy(policy: ModelPolicy, requested: string): string | undefined {
  const meta = metaRequestedEffort(policy, requested)
  if (meta !== undefined) {
    return meta
  }
  const { thinkingOff, sendUndeclaredEffort } = policy.reasoning
  return thinkingOff === undefined && sendUndeclaredEffort === true && requested !== 'default'
    ? requested
    : undefined
}

/**
The selected model's request effort, from the one resolver (lane
DSTHINK3). A listed level rides as named; an unlisted on-level resolves
to `default` (the provider default: codecs omit the field), never to a
neighbour and never to off. Off rides as `none` where the record
affirms disabling (a listed `none`, an affirmed `canDisable`, or an
affirmed off switch); anywhere else the record speaks, the typed
refusal is raised before dispatch instead of sending a value the model
does not take (lane REASONSHAPESR2). With a declared switch, a default
or refused setting rides unchanged to the model's codec, which
resolves it again from the same record.
*/
export function effortForPolicy(policy: ModelPolicy, requested: string): string {
  const routed = routedEffortForPolicy(policy, requested)
  if (routed !== undefined) {
    return routed
  }
  const { effortLevels, canDisable, offSwitch, thinkingOff, planFacts } = policy.reasoning
  // Plan models resolve from the catalogue's own levels: a listed level
  // rides as named (`xhigh` stays `xhigh`), never `none` to a model that
  // does not list it.
  if (planFacts !== undefined) return resolvePlanEffort(planFacts, requested)
  const decision = resolveReasoning(reasoningControlForPolicy(policy), requested)
  if (decision.kind === 'effort') return decision.effort
  if (thinkingOff !== undefined) {
    return decision.kind === 'off' ? THINKING_OFF_EFFORT : requested
  }
  if (requested !== 'none' && decision.kind === 'default' && policy.reasoning.manualOnly === true) {
    // Manual-only thinking carries no level to list: the tier rides
    // through unnamed and sizes the budget (GAPANTH-G10/G17). `none`
    // still resolves below; genuinely requested `default` omits.
    return requested
  }
  if (decision.kind === 'off') {
    // Off is affirmed by a listed `none`, an affirmed `canDisable`, or an
    // affirmed off switch (Claude Sonnet 5.5's `between_tools`); a model
    // with no usable levels takes the plain turn. Anything else the record
    // speaks about refuses here: gpt-6-astra answers 400 to `none`
    // (`developers.openai.com/api/docs/guides/reasoning`, read
    // 2026-10-13), and xAI documents no `none` at all
    // (`docs.x.ai/developers/model-capabilities/text/reasoning`, read
    // 2026-10-13).
    if (
      offSwitch !== undefined ||
      (effortLevels.state === 'yes' && effortLevels.value.includes(THINKING_OFF_EFFORT)) ||
      canDisable.state === 'yes' ||
      !hasUsableEffortLevels(effortLevels)
    ) {
      return THINKING_OFF_EFFORT
    }
    throw new Error(`${UI_TEXT.providerCapabilityUnsupported} (unsupported_reasoning_effort)`)
  }
  return EFFORT_PROVIDER_DEFAULT
}

/** Price-card operations run in the lazy provider bundle. Unpriced is never zero. */
export interface ModelPricedUsage extends PricedUsage {
  readonly cacheWriteTokens1h?: number | undefined
  readonly images?: number | undefined
}

/** The images in this request, including replayed attachments. */
/**
The stream request's token estimate for pacing: the paid admission's own
count when it has one, else the body's byte size plus its output budget.
A hook call on a record-silent model sends no output budget (D121), so
nothing is added for it; every other caller sends one, unchanged.
*/
export function estimatedStreamTokens(
  body: CreateResponseBody,
  admitAttempt: { readonly paidEstimatedInputTokens?: number | undefined } | undefined,
): number {
  // D121: a hook call on a record-silent model sends no output budget; the
  // key is absent at runtime although the shared type cannot see it
  // (hookModelEntry, PLAN.md §8). The pacing estimate then counts the input
  // side alone; every other caller sends a budget, unchanged.
  const sent = body as { readonly max_output_tokens?: number | undefined }
  return (
    (admitAttempt?.paidEstimatedInputTokens ??
      new TextEncoder().encode(JSON.stringify([body.input, body.instructions, body.tools]))
        .length) + (sent.max_output_tokens ?? 0)
  )
}

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

export function metaResolvedModel(
  ref: string,
  client: ProviderClient,
  planFacts?: ChatGptPlanFacts,
): ResolvedModel {
  const isPlan = client.isPlanModel?.(ref) === true
  const policy = modelPolicyFor(
    ref,
    isPlan ? { capabilities: { toolCalling: true }, pricing: { kind: 'plan' }, planFacts } : {},
  )
  const estimate = (usage: PricedUsage) => {
    if (isPlan) return Usd.from(0).toAmount()
    return policy.pricing.kind === 'priced'
      ? estimateCostUsd({ ...usage, cachedTokens: usage.cachedTokens ?? 0 }, ref)
      : undefined
  }
  return {
    ref,
    // A plan model the catalogue named reports its own window; unknown
    // keeps today's Meta constant.
    contextTokens: planFacts?.contextTokens ?? MODEL_API_CONTEXT_WINDOW,
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
    reported?: {
      readonly cost?: UsdAmount | undefined
      readonly costInUsdTicks?: number | undefined
    },
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
  | 'maxRetries'
  | 'personCap'
> & {
  /**
  EXECPROV round 6: an exact same-body input count where the provider
  documents one, with the count call's own billed cost when the provider
  bills it (undefined when the count is free). Absent keeps the byte bound
  and sends no count request.
  */
  readonly countInputTokensDetailed?: (
    body: CreateResponseBody,
    signal?: AbortSignal,
  ) => Promise<{
    readonly tokens: number
    readonly costUsd?: UsdAmount | undefined
    readonly accuracy?: 'exact' | 'estimate'
  }>
  /**
  Scheduled runs pin one model and price behind this authority: the
  transport calls it instead of a second full-context reservation.
  */
  readonly withScheduleAuthority?: (
    run: () => UnattendedRun | undefined,
    price?: ModelPricePolicy,
  ) => ModelClient
}

export interface ResolvedModel {
  readonly contextTokens?: number | undefined
  readonly ref: string
  readonly origin: string
  readonly client: ModelClient
  readonly policy: ModelPolicy
  /** The joined capability record, when the resolving lane carried one. */
  readonly capabilityRecord?: ModelCapabilityRecord | undefined
  readonly price: ModelPricePolicy
  /** Configuration, capability/price evidence and auth lane still match this resolution. */
  readonly isCurrent: () => boolean
}

export interface ModelResolver {
  readonly defaultModel?: () => Promise<string | undefined>
  readonly list?: (() => Promise<readonly ModelSummary[]>) | undefined
  readonly resolve: (ref: string) => Promise<ResolvedModel>
}
