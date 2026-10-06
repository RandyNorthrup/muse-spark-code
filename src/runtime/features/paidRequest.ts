import type { ModelApiClientDeps } from '../../core/backends/modelapi/client'
import type { PaidFeature } from '../../shared/constants'
import type { createRuntimePaidBudget } from './paidBudget'

type ReserveRequest = NonNullable<ModelApiClientDeps['reservePaidRequest']>

/** A verified catalog tariff and selected capability, bound to this particular dispatch. */
export interface RuntimePaidRequestPrice {
  readonly costUsd: number
  readonly isCurrent: () => boolean
}

export interface RuntimePaidRequestDeps {
  readonly budget: ReturnType<typeof createRuntimePaidBudget>
  readonly isOn: (feature: PaidFeature) => boolean
  /** Undefined means unpriced, unsupported, or not the currently selected provider/model. */
  readonly price: (...args: Parameters<ReserveRequest>) => RuntimePaidRequestPrice | undefined
}

/** Consent precedes this port; every paid request still needs a durable claim. */
export function runtimePaidRequestAdmission(deps: RuntimePaidRequestDeps): ReserveRequest {
  return async (...args) => {
    const [, feature, , signal] = args
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
      await claim.settle(0)
      throw error
    }
    return {
      ...claim,
      check: (capUsd) => {
        check()
        return claim.check(capUsd)
      },
    }
  }
}
