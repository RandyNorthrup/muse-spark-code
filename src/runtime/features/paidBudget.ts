import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { createDailySpend } from '../../host/paid/dailySpend'
import { storeErrorCode } from '../../host/backend/storeErrors'
import type { SpendClaim } from '../../core/paid/spendClaim'
import type { JudgeDailyLedger } from '../../core/judge/admission'
import { PAID_DAILY_BUDGET, UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import {
  Usd,
  isPositiveUsd,
  legacyUsdSchema,
  usdAmountSchema,
  type UsdAmount,
} from '../../shared/usd'

// The same limit record the VS Code ledger reads: a raise written for today,
// else the setting; zero is none.
const limitRecord = z.strictObject({
  limitUsd: legacyUsdSchema.check(z.refine((amount) => Usd.from(amount).compare(Usd.from(0)) > 0)),
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

/** Portable admission over the shared daily spend files and today's limit record. */
export function createRuntimePaidBudget(
  deps: RuntimePaidBudgetDeps,
  table: UiText,
  locale: string,
) {
  setUiText(table, locale)
  const spend = createDailySpend({ directory: deps.directory, sleep: deps.sleep })
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
    let record: { readonly limitUsd: UsdAmount; readonly stopped: boolean }
    try {
      record = limitRecord.parse(
        JSON.parse(
          readFileSync(path.join(deps.directory, scope, PAID_DAILY_BUDGET.overrideFile), 'utf8'),
        ),
      )
    } catch (error: unknown) {
      if (storeErrorCode(error) !== 'ENOENT') throw error
      record = { limitUsd: deps.capUsd(), stopped: false }
    }
    if (record.stopped) throw new Error(UI_TEXT.paidDailyStopped)
    return record.limitUsd
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
  const reserve = (costUsd: UsdAmount, signal?: AbortSignal): Promise<SpendClaim> =>
    track(() => {
      if (!usdAmountSchema.safeParse(costUsd).success || Usd.from(costUsd).compare(Usd.from(0)) < 0)
        throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
      const scope = day()
      const estimateUsd = Usd.from(costUsd).toAmount()
      const check = () => {
        const cap = guard(scope, signal)
        if (!isPositiveUsd(cap)) return
        const { spentUsd } = spend.read(scope)
        if (Usd.from(spentUsd).add(Usd.from(estimateUsd)).compare(Usd.from(cap)) > 0)
          throw new Error(UI_TEXT.paidDailyStopped)
      }
      check()
      let isSettled = false
      return Promise.resolve({
        estimateUsd,
        check,
        settle: (actualUsd) =>
          track(async () => {
            if (isSettled) return
            isSettled = true
            await spend.add(scope, actualUsd)
          }, false),
      })
    })
  const latestDay = () =>
    track(() => {
      const scope = day()
      const cap = guard(scope)
      const { spentUsd } = spend.read(scope)
      return Promise.resolve({ day: scope, capUsd: cap, spentUsd })
    })
  const judgeLedger: JudgeDailyLedger = {
    remainingUsd: async () => {
      // Exact decimal remainder: $0.40 settled against a $0.50 cap leaves exactly $0.10.
      const total = await latestDay()
      if (!isPositiveUsd(total.capUsd)) return
      const remaining = Usd.from(total.capUsd).subtract(Usd.from(total.spentUsd))
      return remaining.compare(Usd.from(0)) < 0 ? Usd.from(0).toAmount() : remaining.toAmount()
    },
    reserve: async (costUsd) => {
      if (!isPositiveUsd(guard(day()))) return
      const claim = await reserve(costUsd)
      return {
        claimId: randomUUID(),
        reservedUsd: claim.estimateUsd,
        check: () => {
          claim.check()
        },
        settle: async (actualCostUsd) => {
          await claim.settle(actualCostUsd)
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
    dispose: (): Promise<void> => {
      isClosed = true
      closing ??= (async () => {
        await Promise.allSettled(pending)
      })()
      return closing
    },
  }
}
