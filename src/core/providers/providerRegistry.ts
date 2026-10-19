import { Usd, type UsdAmount } from '../../shared/usd'
// M95-I: resolution joins identity, capability evidence and price-card
// operations before dispatch. Client construction is lane T's transport seam.
import {
  modelPolicyFor,
  type ModelClient,
  type ModelPricedUsage,
  type ModelPolicyEvidence,
  type ModelResolver,
  type ResolvedModel,
} from '../backends/modelapi/modelPolicy'
import { UserRefusalError } from '../refusal'
import { fill } from '../../shared/l10n/text'
import { TOKENS_PER_MILLION, UI_TEXT } from '../../shared/constants'
import { isEffortLevel } from '../../shared/effort'
import type { ModelCapabilityRecord } from './capabilityRecord'
import { parseModelRef, sanitizeModelLabel } from './modelRef'
import { reserveRequestAmount, settleUsageAmount, type ModelPricing } from './priceCard'

export interface RegistryModel {
  readonly catalogueMissing?: boolean
  readonly ref: string
  readonly origin: string
  readonly evidence: ModelPolicyEvidence
  readonly pricing: ModelPricing
  /** The joined capability record, when the owning lane resolved one. */
  readonly record?: ModelCapabilityRecord | undefined
  readonly displayLabel?: string | undefined
  readonly providerLabel?: string | undefined
  readonly contextTokens?: number | undefined
  readonly isPinned?: boolean | undefined
  readonly isDefault?: boolean | undefined
  readonly trainsOnContent?: boolean | undefined
  readonly planLimitsUrl?: string | undefined
}

export interface ProviderRegistryDeps {
  /** Current configured models, joined to scans/catalogue by the owning lanes. */
  readonly models: () => Promise<readonly RegistryModel[]>
  readonly createClient: (model: RegistryModel) => Promise<ModelClient>
  /** Match the model/configuration, evidence/price revision and credential lane. */
  readonly isCurrent: (model: RegistryModel) => boolean
}

/** Per-resolution clients retain their exact producing model and origin. */
export function createProviderRegistry(deps: ProviderRegistryDeps): ModelResolver {
  return {
    async list() {
      const models = await deps.models()
      return models.flatMap((model) => {
        const policy = modelPolicyFor(model.ref, { ...model.evidence, pricing: model.pricing })
        // A model without confirmed tool calling stays listed with its
        // limit stated, never hidden without a reason (F83).
        const agentLimit =
          policy.tools.calling.state === 'yes'
            ? undefined
            : fill(UI_TEXT.providerModelNoToolCalling, { model: model.ref })
        const pricing = model.pricing
        return [
          {
            modelId: model.ref,
            displayLabel: sanitizeModelLabel(model.displayLabel ?? model.ref),
            providerId: policy.identity.provider,
            providerLabel: sanitizeModelLabel(model.providerLabel ?? policy.identity.provider),
            contextLimit: model.contextTokens,
            isActive: false,
            // The record's own levels light the composer's slider (lane
            // REASONSHAPESR2, OPENAI-G01/XAI-G01): a configured-provider id
            // contains `/`, so the static table serves nothing and only
            // the row can offer the model's levels. Unknown names stay
            // out: the option carries tiers the UI serves, never a guess.
            ...(policy.reasoning.effortLevels.state === 'yes' &&
              policy.reasoning.effortLevels.value.some((level) => isEffortLevel(level)) && {
                effortLevels: policy.reasoning.effortLevels.value.filter((level) =>
                  isEffortLevel(level),
                ),
              }),
            // The list's own default where it names a served tier (lane
            // REASONSHAPESR2, XAI-G01); the controller falls back to the
            // highest served tier without it.
            ...(policy.reasoning.defaultEffort !== undefined &&
              isEffortLevel(policy.reasoning.defaultEffort) && {
                defaultEffort: policy.reasoning.defaultEffort,
              }),
            isDefault: model.isDefault === true,
            pricing: pricing.kind,
            isPinned: model.isPinned,
            trainsOnContent: model.trainsOnContent,
            planLimitsUrl: model.planLimitsUrl,
            ...(agentLimit !== undefined && { agentLimit }),
            ...(pricing.kind === 'priced' && {
              inputUsdPerMTokens: pricing.card.input * TOKENS_PER_MILLION,
              outputUsdPerMTokens: pricing.card.output * TOKENS_PER_MILLION,
            }),
          },
        ]
      })
    },
    async resolve(ref): Promise<ResolvedModel> {
      const parsed = parseModelRef(ref)
      const models = await deps.models()
      const model = models.find((model) => model.ref === ref)
      if (model === undefined || parsed === undefined || parsed.providerId === 'meta') {
        throw new UserRefusalError(UI_TEXT.execUnknownModel, 'unknown_model')
      }
      if (model.catalogueMissing === true)
        throw new UserRefusalError(
          fill(UI_TEXT.execProviderNotCatalogue, { model: ref }),
          'model_not_catalogue',
        )
      // Selecting a model without confirmed tool calling for an agent
      // turn is refused with the same sentence its list row states (F83).
      {
        const policy = modelPolicyFor(ref, { ...model.evidence, pricing: model.pricing })
        if (policy.tools.calling.state !== 'yes') {
          throw new Error(fill(UI_TEXT.providerModelNoToolCalling, { model: ref }))
        }
      }
      const client = await deps.createClient(model)
      if (!deps.isCurrent(model)) {
        throw new Error(UI_TEXT.requestStaleRetry)
      }
      const pricing = model.pricing
      return {
        ref,
        contextTokens: model.contextTokens,
        origin: model.origin,
        client,
        policy: modelPolicyFor(ref, { ...model.evidence, pricing }),
        // The send path sizes fresh media against the model's own caps
        // from this record; absent keeps today's provider-identity gating.
        ...(model.record !== undefined && { capabilityRecord: model.record }),
        price: {
          reserve(usage) {
            if (pricing.kind === 'local' || pricing.kind === 'plan') return Usd.from(0).toAmount()
            return pricing.kind === 'priced'
              ? Usd.from(
                  reserveRequestAmount(pricing.card, {
                    ...usage,
                    cacheWriteTokens: usage.inputTokens,
                  }),
                )
                  .add(Usd.from(pricing.card.image ?? 0).times(usage.images ?? 0))
                  .toAmount()
              : undefined
          },
          settle(usage, reported) {
            if (pricing.kind === 'local' || pricing.kind === 'plan') return Usd.from(0).toAmount()
            return pricing.kind === 'priced'
              ? settleWithImages(pricing, usage, reported)
              : undefined
          },
        },
        isCurrent: () => deps.isCurrent(model),
      }
    },
  }
}

function settleWithImages(
  pricing: Extract<ModelPricing, { kind: 'priced' }>,
  usage: ModelPricedUsage,
  reported: Parameters<typeof settleUsageAmount>[2],
): UsdAmount | undefined {
  const cost = settleUsageAmount(pricing.card, usage, reported)
  if (
    cost !== undefined &&
    reported?.cost === undefined &&
    reported?.costInUsdTicks === undefined &&
    (usage.cacheWriteTokens1h ?? 0) > 0 &&
    pricing.card.cacheWrite1h !== undefined
  ) {
    // P2 owns the arithmetic. Until its public module honours the 1h subset,
    // keep the reservation as uncertain liability instead of under-settling it.
    return undefined
  }
  return cost === undefined ||
    reported?.cost !== undefined ||
    reported?.costInUsdTicks !== undefined
    ? cost
    : Usd.from(cost)
        .add(Usd.from(pricing.card.image ?? 0).times(usage.images ?? 0))
        .toAmount()
}
