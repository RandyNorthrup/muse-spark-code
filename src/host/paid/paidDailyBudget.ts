import { reportingAmount } from '../../core/usage/reportingAmount'
import { randomUUID } from 'node:crypto'
import { PaidAuthority } from '../../core/paid/paidAuthority'
import { Usd, legacyUsdSchema, usdInputSchema, type UsdAmount } from '../../shared/usd'
// D78: daily interactive extras share M82's durable claims across windows.
import { mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'
import * as vscode from 'vscode'
import * as z from 'zod/mini'
import type { JudgeDailyLedger } from '../../core/judge/admission'
import type { ModelApiClientDeps } from '../../core/backends/modelapi/client'
import type {
  AccountBudgetAdmission,
  SessionBudgetClaim,
} from '../../core/backends/modelapi/sessionBudget'
import { fingerprint } from '../../core/verify/fingerprint'
import { estimateCostUsd } from '../../core/usage/insights'
import { unlessAborted } from '../../core/timeouts'
import { PAID_DAILY_BUDGET, PAID_PRICES_USD, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'
import { modelApiPaidTier } from '../../shared/paid'
import { createSessionBudgetJournal } from '../backend/sessionBudgetJournal'
import { storeErrorCode } from '../backend/storeErrors'
import { writeFileAtomically } from '../fsAtomic'
import type { UsageBudgetRead } from '../../core/usage/usageService'
import { scheduleV2Schema, type ScheduleV2 } from '../../shared/scheduleV2'

const limitSchema = z.object({
  limitUsd: legacyUsdSchema.check(
    z.refine(
      (amount) =>
        Usd.from(amount).compare(Usd.from(PAID_DAILY_BUDGET.minimumUsd)) >= 0 &&
        Usd.from(amount).compare(Usd.from(PAID_DAILY_BUDGET.maximumUsd)) <= 0,
    ),
  ),
  stopped: z.boolean(),
})

export function createPaidDailyBudget(deps: {
  readonly authority?: PaidAuthority
  readonly directory: string
  readonly now: () => number
  readonly capUsd: () => UsdAmount
  readonly sleep: (ms: number) => Promise<void>
  readonly isModelApi: () => boolean
  /** P's account-bound guard; shared daily claims still use one fixed scope. */
  readonly accountAdmission?: AccountBudgetAdmission
}) {
  const authority = deps.authority ?? new PaidAuthority()
  const day = () => {
    const today = new Date(deps.now())
    return [today.getFullYear(), today.getMonth() + 1, today.getDate()].join('-')
  }
  const journal = createSessionBudgetJournal({
    directory: deps.directory,
    sleep: deps.sleep,
    initialBudget: () =>
      Promise.resolve({ spentUsd: Usd.from(0).toAmount(), hasUnknownHistoricalFees: false }),
  })
  const limitPath = (scope: string) =>
    path.join(deps.directory, scope, PAID_DAILY_BUDGET.overrideFile)
  const stopPath = (scope: string) =>
    path.join(deps.directory, scope, PAID_DAILY_BUDGET.stopDirectory)
  const readLimit = (scope: string, isDisplay = false) => {
    let isStopped = false
    try {
      statSync(stopPath(scope))
      isStopped = true
    } catch (error: unknown) {
      if (storeErrorCode(error) !== 'ENOENT')
        throw new Error(UI_TEXT.paidDailyLedgerUnavailable, { cause: error })
    }
    if (isStopped && !isDisplay) throw new Error(UI_TEXT.paidDailyStopped)
    let limit: z.infer<typeof limitSchema>
    try {
      limit = limitSchema.parse(JSON.parse(readFileSync(limitPath(scope), 'utf8')))
    } catch (error: unknown) {
      if (storeErrorCode(error) !== 'ENOENT')
        throw new Error(UI_TEXT.paidDailyLedgerUnavailable, { cause: error })
      limit = { limitUsd: deps.capUsd(), stopped: false }
    }
    if (!isDisplay && limit.stopped) throw new Error(UI_TEXT.paidDailyStopped)
    return limit.limitUsd
  }
  const capUsd = () => readLimit(day())
  const raise = async (scope: string, neededUsd: UsdAmount, signal: AbortSignal): Promise<void> => {
    const assertActive = () => {
      signal.throwIfAborted()
      if (scope !== day()) throw new Error(UI_TEXT.paidDailyStopped)
      readLimit(scope)
    }
    const stop = (): never => {
      assertActive()
      // Synchronous publication owns cancellation; this marker is never
      // removed or overwritten by a raise, even one already in rename().
      mkdirSync(stopPath(scope), { recursive: true })
      throw new Error(UI_TEXT.paidDailyStopped)
    }
    assertActive()
    const raiseTitle = UI_TEXT.paidDailyRaise
    const stopItem: vscode.MessageItem = { title: UI_TEXT.paidDailyStop, isCloseAffordance: true }
    const answer = await unlessAborted(
      Promise.resolve(
        vscode.window.showWarningMessage(
          UI_TEXT.paidDailyReached,
          {
            modal: true,
            detail: fill(UI_TEXT.paidDailyReachedDetail, {
              budget: formatUsd(readLimit(scope), 2),
              needed: formatUsd(neededUsd, 2),
            }),
          },
          { title: raiseTitle },
          stopItem,
        ),
      ),
      signal,
    )
    assertActive()
    if (answer?.title !== raiseTitle) stop()
    const doubledLimit = Usd.from(readLimit(scope)).times(2)
    let suggestedLimit = neededUsd
    if (Usd.from(neededUsd).compare(doubledLimit) <= 0)
      suggestedLimit =
        doubledLimit.compare(Usd.from(PAID_DAILY_BUDGET.maximumUsd)) > 0
          ? Usd.from(PAID_DAILY_BUDGET.maximumUsd).toAmount()
          : doubledLimit.toAmount()
    const entered = await unlessAborted(
      Promise.resolve(
        vscode.window.showInputBox({
          title: raiseTitle,
          prompt: UI_TEXT.paidDailyRaisePrompt,
          value: suggestedLimit,
          validateInput: (value) => {
            const parsed = limitSchema.safeParse({
              limitUsd: usdInputSchema.safeParse(value).data,
              stopped: false,
            })
            if (!parsed.success || Usd.from(parsed.data.limitUsd).compare(Usd.from(neededUsd)) < 0)
              return UI_TEXT.paidDailyRaisePrompt
            return
          },
        }),
      ),
      signal,
    )
    assertActive()
    const parsed = limitSchema.safeParse({
      limitUsd: usdInputSchema.safeParse(entered).data,
      stopped: false,
    })
    if (
      entered === undefined ||
      !parsed.success ||
      Usd.from(parsed.data.limitUsd).compare(Usd.from(neededUsd)) < 0
    ) {
      stop()
    }
    await writeFileAtomically(limitPath(scope), JSON.stringify(parsed.data), {
      sleep: deps.sleep,
      assertCanWrite: assertActive,
      // Couple this request's last cancellation check to publication in
      // one event-loop step; another window's Stop still wins via its marker.
      rename: (from, to) => {
        assertActive()
        renameSync(from, to)
        return Promise.resolve()
      },
    })
    assertActive()
  }
  const ownClaim = (
    scope: string,
    claimId: string,
    claim: Awaited<ReturnType<typeof journal.reserve>>,
  ) => {
    const pending = new Map<string, ReturnType<typeof claim.settle>>()
    return {
      ...claim,
      check: (capUsd: UsdAmount) => {
        const total = claim.check(capUsd)
        authority.dispatch({ type: 'day', day: scope, capUsd, spentUsd: total.spentUsd })
        return total
      },
      settle: async (amount: UsdAmount, hasUnknownCost = false, isFinal = true) => {
        const key = JSON.stringify([amount, hasUnknownCost, isFinal])
        const effects = authority.dispatch({
          type: 'moneySettle',
          claimId,
          amount,
          hasUnknownCost,
          isFinal,
        })
        for (const effect of effects) {
          if (effect.type !== 'persistMoney') continue
          const writing = claim.settle(effect.amount, effect.hasUnknownCost, effect.isFinal)
          pending.set(key, writing)
          try {
            const total = await writing
            authority.dispatch({ type: 'moneySaved', effect })
            if (scope === day())
              authority.dispatch({
                type: 'day',
                day: scope,
                capUsd: authority.day(scope)?.capUsd ?? deps.capUsd(),
                spentUsd: total.spentUsd,
              })
            return total
          } catch (error: unknown) {
            authority.dispatch({ type: 'moneyFailed', effect })
            throw error
          } finally {
            pending.delete(key)
          }
        }
        const writing = pending.get(key)
        if (writing === undefined) throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
        return await writing
      },
    }
  }
  const reserveClaim = async (scope: string, amount: UsdAmount) => {
    const claimId = randomUUID()
    const effects = authority.dispatch({ type: 'moneyReserve', claimId, reservedUsd: amount })
    const effect = effects.find((candidate) => candidate.type === 'persistReserve')
    if (effect?.type !== 'persistReserve') throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
    const claim = await journal.reserve(scope, PAID_DAILY_BUDGET.accountId, effect.amount)
    return ownClaim(scope, effect.claimId, claim)
  }
  const reserve: NonNullable<ModelApiClientDeps['reservePaidRequest']> = async (
    body,
    feature,
    estimatedInputTokens,
    signal = new AbortController().signal,
  ) => {
    signal.throwIfAborted()
    if (feature !== 'legalExplanation' && !deps.isModelApi()) return
    if (
      feature === 'webSearch' ||
      ('tools' in body && body.tools.some((tool) => tool.type === 'web_search'))
    )
      throw new Error(UI_TEXT.sessionBudgetSearchUnavailable)
    const scope = day()
    let claim: ReturnType<typeof ownClaim>
    try {
      readLimit(scope)
      let costUsd = Usd.from(PAID_PRICES_USD.imageGeneration).toAmount()
      if ('input' in body) {
        if (modelApiPaidTier(body.model) === undefined)
          throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
        if (estimatedInputTokens === undefined) throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
        if (
          !Number.isSafeInteger(estimatedInputTokens) ||
          estimatedInputTokens < 0 ||
          !Number.isSafeInteger(body.max_output_tokens) ||
          body.max_output_tokens < 0
        )
          throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
        costUsd = estimateCostUsd(
          {
            inputTokens: estimatedInputTokens,
            outputTokens: body.max_output_tokens,
            cachedTokens: 0,
          },
          body.model,
        )
      }
      claim = await reserveClaim(scope, costUsd)
    } catch (error: unknown) {
      signal.throwIfAborted()
      if (error instanceof Error && error.message === UI_TEXT.paidDailyStopped) throw error
      throw new Error(UI_TEXT.paidDailyLedgerUnavailable, { cause: error })
    }
    try {
      signal.throwIfAborted()
      const checkAccount = deps.accountAdmission?.(claim)
      checkAccount?.()
      const admittedClaim = {
        ...claim,
        check: () => {
          signal.throwIfAborted()
          if (scope !== day()) throw new Error(UI_TEXT.paidDailyStopped)
          checkAccount?.()
          try {
            return claim.check(readLimit(scope))
          } catch (error: unknown) {
            throw new Error(UI_TEXT.paidDailyLedgerUnavailable, { cause: error })
          }
        },
      }
      const total = await journal.read(scope, PAID_DAILY_BUDGET.accountId)
      signal.throwIfAborted()
      if (Usd.from(total.spentUsd).compare(Usd.from(readLimit(scope))) > 0)
        await unlessAborted(raise(scope, total.spentUsd, signal), signal)
      signal.throwIfAborted()
      return admittedClaim
    } catch (error: unknown) {
      await claim.settle(Usd.from(0).toAmount())
      throw error
    }
  }
  const readToday = async (): Promise<readonly UsageBudgetRead[]> => {
    const scope = day()
    const total = await journal.readExisting(scope, PAID_DAILY_BUDGET.accountId)
    let isStopped = false
    let cap: number
    try {
      cap = Number(readLimit(scope))
    } catch (error: unknown) {
      if (!(error instanceof Error) || error.message !== UI_TEXT.paidDailyStopped) throw error
      isStopped = true
      cap = Number(readLimit(scope, true))
    }
    const reset = new Date(deps.now())
    reset.setHours(0, 0, 0, 0)
    reset.setDate(reset.getDate() + 1)
    return [
      {
        budget: {
          id: scope,
          kind: 'paidDaily',
          spentUsd: Number(total?.spentUsd ?? 0),
          ...(total?.uncertainUsd !== undefined && {
            uncertainUsd: reportingAmount(total.uncertainUsd),
          }),
          capUsd: cap,
          stopped: isStopped,
          raisedToday: Usd.from(cap).compare(Usd.from(deps.capUsd())) > 0,
          resetsAt: reset.getTime(),
        },
      },
    ]
  }
  const latestDay = async () => {
    const scope = day()
    readLimit(scope)
    const total = await journal.read(scope, PAID_DAILY_BUDGET.accountId)
    if (scope !== day()) throw new Error(UI_TEXT.paidDailyStopped)
    if (total.hasUnknownHistoricalFees) throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
    authority.dispatch({
      type: 'day',
      day: scope,
      capUsd: readLimit(scope),
      spentUsd: total.spentUsd,
    })
    return { day: scope, capUsd: readLimit(scope), spentUsd: total.spentUsd }
  }
  const reserveExact = async (costUsd: UsdAmount) => {
    const scope = day()
    readLimit(scope)
    const claim = await reserveClaim(scope, costUsd)
    let checkAccount: (() => void) | undefined
    const check = () => {
      if (scope !== day()) throw new Error(UI_TEXT.paidDailyStopped)
      checkAccount?.()
      claim.check(readLimit(scope))
    }
    try {
      checkAccount = deps.accountAdmission?.(claim)
      check()
    } catch (error: unknown) {
      await claim.settle(Usd.from(0).toAmount())
      throw error
    }
    return { ...claim, check }
  }
  /** D95: reserve both caps, never open D78's Raise dialog during unattended work. */
  const reserveSchedule = async (
    schedule: ScheduleV2,
    costUsd: UsdAmount,
    signal: AbortSignal,
  ): Promise<SessionBudgetClaim> => {
    scheduleV2Schema.parse(schedule)
    signal.throwIfAborted()
    const consent = schedule.paidConsent
    const zero = Usd.from(0)
    if (
      consent === undefined ||
      Usd.from(costUsd).compare(zero) <= 0 ||
      schedule.action.kind !== 'prompt'
    )
      throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
    // The schedule record keeps its validated numeric caps; they enter exact money here once.
    let ownCap = Usd.from(consent.dailyCapUsd)
    for (const amount of [schedule.paidCapUsd, schedule.grant.paidCapUsd]) {
      const cap = Usd.from(amount)
      if (cap.compare(ownCap) < 0) ownCap = cap
    }
    const sharedBudget = Usd.from(consent.sharedDailyBudgetUsd)
    if (ownCap.compare(zero) <= 0 || sharedBudget.compare(zero) <= 0)
      throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
    const scope = day()
    const ownScope = `${scope}-schedule-${fingerprint(schedule.id)}`
    const shared = await reserveClaim(scope, costUsd)
    let own: Awaited<ReturnType<typeof journal.reserve>> | undefined
    try {
      signal.throwIfAborted()
      const checkAccount = deps.accountAdmission?.(shared)
      own = await journal.reserve(ownScope, PAID_DAILY_BUDGET.accountId, costUsd)
      const scheduleClaim = own
      const check = () => {
        signal.throwIfAborted()
        if (scope !== day()) throw new Error(UI_TEXT.paidDailyStopped)
        checkAccount?.()
        const limit = Usd.from(readLimit(scope))
        const total = shared.check(
          (limit.compare(sharedBudget) < 0 ? limit : sharedBudget).toAmount(),
        )
        scheduleClaim.check(ownCap.toAmount())
        return total
      }
      check()
      return {
        claimId: scheduleClaim.claimId,
        reservedUsd: scheduleClaim.reservedUsd,
        check,
        settle: async (actualCostUsd: UsdAmount, hasUnknownCost = false) => {
          await scheduleClaim.settle(actualCostUsd, hasUnknownCost)
          return await shared.settle(actualCostUsd, hasUnknownCost)
        },
      }
    } catch (error: unknown) {
      // Both nonsent liabilities are released even if one refund fails.
      const refunds = await Promise.allSettled([
        shared.settle(zero.toAmount()),
        own?.settle(zero.toAmount()),
      ])
      const failed = refunds.find((refund) => refund.status === 'rejected')
      if (failed?.status === 'rejected')
        throw new Error(UI_TEXT.paidDailyLedgerUnavailable, { cause: error })
      throw error
    }
  }
  const judgeLedger: JudgeDailyLedger = {
    remainingUsd: async () => {
      const current = await latestDay()
      const remaining = Usd.from(current.capUsd).subtract(Usd.from(current.spentUsd))
      return remaining.compare(Usd.from(0)) < 0 ? Usd.from(0).toAmount() : remaining.toAmount()
    },
    reserve: async (costUsd) => {
      const claim = await reserveExact(Usd.from(costUsd).toAmount())
      return {
        claimId: claim.claimId,
        reservedUsd: claim.reservedUsd,
        check: claim.check,
        settle: async (actualCostUsd) => {
          await claim.settle(actualCostUsd)
        },
      }
    },
  }
  return {
    reserveExact,
    capUsd,
    readToday,
    reserve,
    reserveSchedule,
    judgeLedger,
    latestDay,
    lookupByClaimId: (scope: string, claimId: string) =>
      journal.lookupByClaimId(scope, PAID_DAILY_BUDGET.accountId, claimId),
  }
}
