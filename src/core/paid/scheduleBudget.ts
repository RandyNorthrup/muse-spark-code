import type { AccountBudgetAdmission, SessionBudgetClaim } from '../backends/modelapi/sessionBudget'
import { fingerprint } from '../verify/fingerprint'
import { UI_TEXT } from '../../shared/constants'
import { scheduleV2Schema, type ScheduleV2 } from '../../shared/scheduleV2'
import { Usd, minUsd, type UsdAmount } from '../../shared/usd'

/** One hard reservation for both D95's schedule cap and D78's shared local day. */
export function scheduleBudget(deps: {
  readonly day: () => string
  readonly capUsd: () => UsdAmount
  readonly reserveShared: (
    day: string,
    cost: UsdAmount,
    cap: UsdAmount,
  ) => Promise<SessionBudgetClaim>
  readonly reserveOwn: (
    scope: string,
    cost: UsdAmount,
    cap: UsdAmount,
  ) => Promise<SessionBudgetClaim>
  readonly accountAdmission?: AccountBudgetAdmission
}) {
  return async (
    schedule: ScheduleV2,
    costUsd: UsdAmount,
    signal: AbortSignal,
  ): Promise<SessionBudgetClaim> => {
    scheduleV2Schema.parse(schedule)
    signal.throwIfAborted()
    const consent = schedule.paidConsent
    const zero = Usd.from(0).toAmount()
    if (
      consent?.payerKind !== 'paidKey' ||
      Usd.from(costUsd).compare(Usd.from(0)) <= 0 ||
      schedule.action.kind !== 'prompt'
    )
      throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
    const ownCap = minUsd(consent.dailyCapUsd, schedule.paidCapUsd, schedule.grant.paidCapUsd)
    if (ownCap === zero || consent.sharedDailyBudgetUsd === zero)
      throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
    const day = deps.day()
    const shared = await deps.reserveShared(
      day,
      costUsd,
      minUsd(deps.capUsd(), consent.sharedDailyBudgetUsd),
    )
    let own: SessionBudgetClaim | undefined
    try {
      signal.throwIfAborted()
      const checkAccount = deps.accountAdmission?.(shared)
      own = await deps.reserveOwn(`${day}-schedule-${fingerprint(schedule.id)}`, costUsd, ownCap)
      const scheduleClaim = own
      const check = () => {
        signal.throwIfAborted()
        if (day !== deps.day()) throw new Error(UI_TEXT.paidDailyStopped)
        checkAccount?.()
        const total = shared.check(minUsd(deps.capUsd(), consent.sharedDailyBudgetUsd))
        scheduleClaim.check(ownCap)
        return total
      }
      check()
      return {
        claimId: scheduleClaim.claimId,
        reservedUsd: scheduleClaim.reservedUsd,
        check,
        settle: async (amount: UsdAmount, hasUnknownCost = false) => {
          if (Usd.from(amount).compare(Usd.from(costUsd)) > 0)
            throw new Error(UI_TEXT.sessionBudgetRetryUnavailable)
          // Try both journals: a failed publication must not silently lose the other liability.
          const results = await Promise.allSettled([
            scheduleClaim.settle(amount, hasUnknownCost),
            shared.settle(amount, hasUnknownCost),
          ])
          const [ownResult, sharedResult] = results
          if (ownResult.status !== 'fulfilled' || sharedResult.status !== 'fulfilled')
            throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
          return sharedResult.value
        },
      }
    } catch (error: unknown) {
      const refunds = await Promise.allSettled([shared.settle(zero), own?.settle(zero)])
      if (refunds.some((refund) => refund.status === 'rejected'))
        throw new Error(UI_TEXT.paidDailyLedgerUnavailable, { cause: error })
      throw error
    }
  }
}
