// One call admitted under a spending limit the person set (PLAN.md D121).
// Nothing is held for it: before each send the limit is compared with what
// was already spent plus this call's estimate, and once the call ends its
// real cost, from the usage the provider reported, is added. A call that went
// out and reported no usage is recorded as cost unknown, never as its estimate.
import type { UsdAmount } from '../../shared/usd'

/**
 * D78's exact reservation for batch transcription: the shared daily
 * ledger's claim as the voice seam's admission, or, with no daily limit, a
 * passthrough that admits and enforces nothing. The editor and the
 * standalone runtime share this shape so their admissions stay identical.
 */
export function paidExtraAdmission(
  claim: SpendClaim | undefined,
  costUsd: UsdAmount,
  signal: AbortSignal,
): {
  readonly reservedUsd: UsdAmount
  readonly check: () => void
  readonly settle: (amountUsd: UsdAmount, hasUnknownCost?: boolean) => Promise<unknown>
} {
  // No limit, no claim: nothing outside a request is admitted, and
  // nothing is enforced either.
  if (claim === undefined)
    return {
      reservedUsd: costUsd,
      check: () => {
        // No limit: nothing to recheck.
      },
      settle: () => Promise.resolve(),
    }
  return {
    reservedUsd: claim.estimateUsd,
    check: () => {
      signal.throwIfAborted()
      claim.check()
    },
    settle: (amountUsd, hasUnknownCost) =>
      claim.settle(hasUnknownCost === true ? undefined : amountUsd),
  }
}

export interface SpendClaim {
  /** The call's estimate at list price: compared with the limit, never counted as spent. */
  readonly estimateUsd: UsdAmount
  /** Synchronous, immediately before each send: throws once the limit no longer fits the estimate. */
  check(): void
  /**
   * After the call: its cost from the provider's reported usage; `undefined`
   * when it went out and no usage came back (the cost is unknown and nothing
   * is added); zero when nothing was sent. Only the first call counts.
   */
  settle(costUsd: UsdAmount | undefined): Promise<void>
}
