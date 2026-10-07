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

const limitRecord = z.strictObject({
  limitUsd: z
    .number()
    .check(z.minimum(PAID_DAILY_BUDGET.minimumUsd), z.maximum(PAID_DAILY_BUDGET.maximumUsd)),
  stopped: z.boolean(),
})

export interface RuntimePaidBudgetDeps {
  /** One canonical machine-wide local namespace shared by all editors and providers. */
  readonly directory: string
  readonly now: () => number
  readonly capUsd: () => number
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
    initialBudget: () => Promise.resolve({ spentUsd: 0, hasUnknownHistoricalFees: false }),
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
  function limit(scope: string): number {
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
  function guard(scope: string, signal?: AbortSignal): number {
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
  const reserve = (costUsd: number, signal?: AbortSignal): Promise<SessionBudgetClaim> =>
    track(async () => {
      const scope = day()
      guard(scope, signal)
      if (!Number.isFinite(costUsd) || costUsd < 0)
        throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
      const claim = await journal.reserve(scope, PAID_DAILY_BUDGET.accountId, costUsd)
      const check = () => claim.check(guard(scope, signal))
      try {
        check()
      } catch (error: unknown) {
        // No dispatch can precede returning this claim. An unsuccessful refund retains liability.
        await claim.settle(0)
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
      const total = await latestDay()
      return Math.max(0, total.capUsd - total.spentUsd)
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
