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
import { TOKENS_PER_MILLION, UI_TEXT } from '../../shared/constants'
import { parseModelRef, sanitizeModelLabel } from './modelRef'
import { reserveRequestAmount, settleUsageAmount, type ModelPricing } from './priceCard'

export interface RegistryModel {
  readonly ref: string
  readonly origin: string
  readonly evidence: ModelPolicyEvidence
  readonly pricing: ModelPricing
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
        if (policy.tools.calling.state !== 'yes') return []
        const pricing = model.pricing
        return [
          {
            modelId: model.ref,
            displayLabel: sanitizeModelLabel(model.displayLabel ?? model.ref),
            providerId: policy.identity.provider,
            providerLabel: sanitizeModelLabel(model.providerLabel ?? policy.identity.provider),
            contextLimit: model.contextTokens,
            isActive: false,
            isDefault: model.isDefault === true,
            pricing: pricing.kind,
            isPinned: model.isPinned,
            trainsOnContent: model.trainsOnContent,
            planLimitsUrl: model.planLimitsUrl,
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
        throw new Error(UI_TEXT.execUnknownModel)
      }
      const client = await deps.createClient(model)
      if (!deps.isCurrent(model)) {
        throw new Error(UI_TEXT.scheduleConfirmationExpired)
      }
      const pricing = model.pricing
      return {
        ref,
        contextTokens: model.contextTokens,
        origin: model.origin,
        client,
        policy: modelPolicyFor(ref, { ...model.evidence, pricing }),
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
