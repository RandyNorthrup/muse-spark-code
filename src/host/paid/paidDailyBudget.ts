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
import { estimateCostUsd } from '../../core/usage/insights'
import { unlessAborted } from '../../core/timeouts'
import { PAID_DAILY_BUDGET, PAID_PRICES_USD, UI_TEXT } from '../../shared/constants'
import { fill, formatUsd } from '../../shared/l10n/text'
import { modelApiPaidTier } from '../../shared/paid'
import { createSessionBudgetJournal } from '../backend/sessionBudgetJournal'
import { storeErrorCode } from '../backend/storeErrors'
import { writeFileAtomically } from '../fsAtomic'

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
  const readLimit = (scope: string) => {
    let isStopped = false
    try {
      statSync(stopPath(scope))
      isStopped = true
    } catch (error: unknown) {
      if (storeErrorCode(error) !== 'ENOENT')
        throw new Error(UI_TEXT.paidDailyLedgerUnavailable, { cause: error })
    }
    if (isStopped) throw new Error(UI_TEXT.paidDailyStopped)
    let limit: z.infer<typeof limitSchema>
    try {
      limit = limitSchema.parse(JSON.parse(readFileSync(limitPath(scope), 'utf8')))
    } catch (error: unknown) {
      if (storeErrorCode(error) !== 'ENOENT')
        throw new Error(UI_TEXT.paidDailyLedgerUnavailable, { cause: error })
      limit = { limitUsd: deps.capUsd(), stopped: false }
    }
    if (limit.stopped) throw new Error(UI_TEXT.paidDailyStopped)
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
    const pending = new Map<string, Promise<unknown>>()
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
    if (!deps.isModelApi()) return
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
      const total = await journal.read(scope, PAID_DAILY_BUDGET.accountId)
      signal.throwIfAborted()
      if (Usd.from(total.spentUsd).compare(Usd.from(readLimit(scope))) > 0)
        await unlessAborted(raise(scope, total.spentUsd, signal), signal)
      signal.throwIfAborted()
      return {
        ...claim,
        check: () => {
          signal.throwIfAborted()
          if (scope !== day()) throw new Error(UI_TEXT.paidDailyStopped)
          try {
            return claim.check(readLimit(scope))
          } catch (error: unknown) {
            throw new Error(UI_TEXT.paidDailyLedgerUnavailable, { cause: error })
          }
        },
      }
    } catch (error: unknown) {
      await claim.settle(Usd.from(0).toAmount())
      throw error
    }
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
    const check = () => {
      if (scope !== day()) throw new Error(UI_TEXT.paidDailyStopped)
      claim.check(readLimit(scope))
    }
    try {
      check()
    } catch (error: unknown) {
      await claim.settle(Usd.from(0).toAmount())
      throw error
    }
    return { ...claim, check }
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
    reserve,
    judgeLedger,
    latestDay,
    lookupByClaimId: (scope: string, claimId: string) =>
      journal.lookupByClaimId(scope, PAID_DAILY_BUDGET.accountId, claimId),
  }
}
