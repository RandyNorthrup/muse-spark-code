import type { ModelApiClientDeps } from '../../core/backends/modelapi/client'
import type { PaidFeature } from '../../shared/constants'
import type { createRuntimePaidBudget } from './paidBudget'
import type { BillableUsage } from '../../core/usage/insights'
import type { CreateResponseBody } from '../../core/backends/modelapi/schemas'
import { Usd, type UsdAmount } from '../../shared/usd'

type ReserveRequest = NonNullable<ModelApiClientDeps['reservePaidRequest']>

/** A verified catalog tariff and selected capability, bound to this particular dispatch. */
export interface RuntimePaidRequestPrice {
  readonly costUsd: UsdAmount
  readonly isCurrent: () => boolean
  /**
  Captured dispatch tariff, including any metered tool fees; never the new selection's rates.
  A number, like ModelApiClientDeps.paidResponseCost: the client enters exact money once.
  */
  readonly receiptCost?: (usage: BillableUsage) => number | undefined
}

export interface RuntimePaidRequestDeps {
  readonly budget: ReturnType<typeof createRuntimePaidBudget>
  readonly isOn: (feature: PaidFeature) => boolean
  /** Undefined means unpriced, unsupported, or not the currently selected provider/model. */
  readonly price: (...args: Parameters<ReserveRequest>) => RuntimePaidRequestPrice | undefined
}

/** Consent precedes this port; every paid request still needs a durable claim. */
export function runtimePaidRequestAdmission(deps: RuntimePaidRequestDeps) {
  const tariffs = new WeakMap<
    CreateResponseBody,
    { readonly feature: PaidFeature; readonly tariff: RuntimePaidRequestPrice }
  >()
  const reserve: ReserveRequest = async (...args) => {
    const [body, feature, , signal] = args
    const tariff = deps.price(...args)
    const check = () => {
      signal?.throwIfAborted()
      if (!deps.isOn(feature) || !tariff?.isCurrent())
        throw new Error('MHP_PAID_REQUEST_UNAVAILABLE')
    }
    check()
    if (tariff === undefined) throw new Error('MHP_PAID_TARIFF_UNAVAILABLE')
    const claim = await deps.budget.reserve(tariff.costUsd, signal)
    try {
      check()
    } catch (error: unknown) {
      await claim.settle(Usd.from(0).toAmount())
      throw error
    }
    if ('input' in body) tariffs.set(body, { feature, tariff })
    return {
      ...claim,
      check: () => {
        check()
        claim.check()
      },
    }
  }
  const responseCost: NonNullable<ModelApiClientDeps['paidResponseCost']> = (
    body,
    feature,
    usage,
  ) => {
    const bound = tariffs.get(body)
    return bound?.feature === feature ? bound.tariff.receiptCost?.(usage) : undefined
  }
  return Object.assign(reserve, { responseCost })
}
