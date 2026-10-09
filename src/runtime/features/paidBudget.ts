import { mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { createSessionBudgetJournal } from '../../host/backend/sessionBudgetJournal'
import { storeErrorCode } from '../../host/backend/storeErrors'
import type { SessionBudgetClaim } from '../../core/backends/modelapi/sessionBudget'
import type { JudgeDailyLedger } from '../../core/judge/admission'
import { PAID_DAILY_BUDGET, UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { Usd, legacyUsdSchema, type UsdAmount } from '../../shared/usd'

// The same record the VS Code ledger reads: a historical number or an exact string.
const limitRecord = z.strictObject({
  limitUsd: legacyUsdSchema.check(
    z.refine(
      (amount) =>
        Usd.from(amount).compare(Usd.from(PAID_DAILY_BUDGET.minimumUsd)) >= 0 &&
        Usd.from(amount).compare(Usd.from(PAID_DAILY_BUDGET.maximumUsd)) <= 0,
    ),
  ),
  stopped: z.boolean(),
})

export interface RuntimePaidBudgetDeps {
  /** One canonical machine-wide local namespace shared by all editors and providers. */
  readonly directory: string
  readonly now: () => number
  readonly capUsd: () => UsdAmount
  readonly sleep: (ms: number) => Promise<void>
  readonly assertCurrent: () => void
  readonly isLocalStorage: () => boolean
}

/** Portable admission reuses the authoritative durable journal and its synchronous final claim check. */
export function createRuntimePaidBudget(
  deps: RuntimePaidBudgetDeps,
  table: UiText,
  locale: string,
) {
  setUiText(table, locale)
  const journal = createSessionBudgetJournal({
    directory: deps.directory,
    sleep: deps.sleep,
    initialBudget: () =>
      Promise.resolve({ spentUsd: Usd.from(0).toAmount(), hasUnknownHistoricalFees: false }),
  })
  const pending = new Set<Promise<unknown>>()
  let isClosed = false
  let closing: Promise<void> | undefined
  const day = () => {
    const time = new Date(deps.now())
    return `${String(time.getFullYear())}-${String(time.getMonth() + 1)}-${String(time.getDate())}`
  }
  function open(): void {
    if (isClosed) throw new Error('MHP_PAID_LEDGER_CLOSED')
    if (!deps.isLocalStorage()) throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
  }
  function active(): void {
    open()
    deps.assertCurrent()
  }
  function limit(scope: string): UsdAmount {
    let isStopped = false
    try {
      statSync(path.join(deps.directory, scope, PAID_DAILY_BUDGET.stopDirectory))
      isStopped = true
    } catch (error: unknown) {
      if (storeErrorCode(error) !== 'ENOENT') throw error
    }
    if (isStopped) throw new Error(UI_TEXT.paidDailyStopped)
    let record: unknown
    try {
      record = JSON.parse(
        readFileSync(path.join(deps.directory, scope, PAID_DAILY_BUDGET.overrideFile), 'utf8'),
      )
    } catch (error: unknown) {
      if (storeErrorCode(error) !== 'ENOENT') throw error
      record = { limitUsd: deps.capUsd(), stopped: false }
    }
    const parsed = limitRecord.parse(record)
    if (parsed.stopped) throw new Error(UI_TEXT.paidDailyStopped)
    return parsed.limitUsd
  }
  function guard(scope: string, signal?: AbortSignal): UsdAmount {
    active()
    signal?.throwIfAborted()
    if (scope !== day()) throw new Error(UI_TEXT.paidDailyStopped)
    return limit(scope)
  }
  async function track<T>(work: () => Promise<T>, requiresCurrent = true): Promise<T> {
    if (requiresCurrent) active()
    else open()
    const operation = work()
    pending.add(operation)
    try {
      return await operation
    } finally {
      pending.delete(operation)
    }
  }
  const reserve = (costUsd: UsdAmount, signal?: AbortSignal): Promise<SessionBudgetClaim> =>
    track(async () => {
      const scope = day()
      guard(scope, signal)
      if (Usd.from(costUsd).compare(Usd.from(0)) < 0)
        throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
      const claim = await journal.reserve(scope, PAID_DAILY_BUDGET.accountId, costUsd)
      const check = () => claim.check(guard(scope, signal))
      try {
        check()
      } catch (error: unknown) {
        // No dispatch can precede returning this claim. An unsuccessful refund retains liability.
        await claim.settle(Usd.from(0).toAmount())
        throw error
      }
      return {
        claimId: claim.claimId,
        reservedUsd: claim.reservedUsd,
        check,
        // Settlement belongs to its original day and remains valid after midnight or Stop.
        settle: (actualUsd, isUnknown) => track(() => claim.settle(actualUsd, isUnknown), false),
      }
    })
  const latestDay = () =>
    track(async () => {
      const scope = day()
      guard(scope)
      const total = await journal.read(scope, PAID_DAILY_BUDGET.accountId)
      if (total.hasUnknownHistoricalFees) throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
      return { day: scope, capUsd: guard(scope), spentUsd: total.spentUsd }
    })
  const judgeLedger: JudgeDailyLedger = {
    remainingUsd: async () => {
      // Exact decimal remainder: $0.40 settled against a $0.50 cap leaves exactly $0.10.
      const total = await latestDay()
      const remaining = Usd.from(total.capUsd).subtract(Usd.from(total.spentUsd))
      return remaining.compare(Usd.from(0)) < 0 ? Usd.from(0).toAmount() : remaining.toAmount()
    },
    reserve: async (costUsd) => {
      const claim = await reserve(costUsd)
      return {
        claimId: claim.claimId,
        reservedUsd: claim.reservedUsd,
        check: () => {
          claim.check(guard(day()))
        },
        settle: async (actualUsd) => {
          await claim.settle(actualUsd)
        },
      }
    },
  }
  return {
    reserve,
    latestDay,
    judgeLedger,
    capUsd: () => guard(day()),
    stop: () => {
      active()
      mkdirSync(path.join(deps.directory, day(), PAID_DAILY_BUDGET.stopDirectory), {
        recursive: true,
      })
    },
    lookupByClaimId: (scope: string, id: string) =>
      track(() => journal.lookupByClaimId(scope, PAID_DAILY_BUDGET.accountId, id)),
    dispose: (): Promise<void> => {
      isClosed = true
      closing ??= (async () => {
        await Promise.allSettled(pending)
      })()
      return closing
    },
  }
}
