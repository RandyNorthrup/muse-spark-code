// One call admitted under a spending limit the person set (PLAN.md D121).
// Nothing is held for it: before each send the limit is compared with what
// was already spent plus this call's estimate, and once the call ends its
// real cost, from the usage the provider reported, is added. A call that went
// out and reported no usage is recorded as cost unknown, never as its estimate.
import type { UsdAmount } from '../../shared/usd'

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
