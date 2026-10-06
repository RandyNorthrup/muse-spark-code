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
  limitUsd: z
    .number()
    .check(z.minimum(PAID_DAILY_BUDGET.minimumUsd), z.maximum(PAID_DAILY_BUDGET.maximumUsd)),
  stopped: z.boolean(),
})

export function createPaidDailyBudget(deps: {
  readonly directory: string
  readonly now: () => number
  readonly capUsd: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly isModelApi: () => boolean
}) {
  const day = () => {
    const today = new Date(deps.now())
    return [today.getFullYear(), today.getMonth() + 1, today.getDate()].join('-')
  }
  const journal = createSessionBudgetJournal({
    directory: deps.directory,
    sleep: deps.sleep,
    initialBudget: () => Promise.resolve({ spentUsd: 0, hasUnknownHistoricalFees: false }),
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
  const raise = async (scope: string, neededUsd: number, signal: AbortSignal): Promise<void> => {
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
    const entered = await unlessAborted(
      Promise.resolve(
        vscode.window.showInputBox({
          title: raiseTitle,
          prompt: UI_TEXT.paidDailyRaisePrompt,
          value: String(
            Math.min(PAID_DAILY_BUDGET.maximumUsd, Math.max(readLimit(scope) * 2, neededUsd)),
          ),
          validateInput: (value) => {
            const parsed = limitSchema.safeParse({ limitUsd: Number(value), stopped: false })
            if (!parsed.success || parsed.data.limitUsd < neededUsd)
              return UI_TEXT.paidDailyRaisePrompt
            return
          },
        }),
      ),
      signal,
    )
    assertActive()
    const parsed = limitSchema.safeParse({ limitUsd: Number(entered), stopped: false })
    if (entered === undefined || !parsed.success || parsed.data.limitUsd < neededUsd) {
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
    let claim: Awaited<ReturnType<typeof journal.reserve>>
    try {
      readLimit(scope)
      let costUsd: number = PAID_PRICES_USD.imageGeneration
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
      claim = await journal.reserve(scope, PAID_DAILY_BUDGET.accountId, costUsd)
    } catch (error: unknown) {
      signal.throwIfAborted()
      if (error instanceof Error && error.message === UI_TEXT.paidDailyStopped) throw error
      throw new Error(UI_TEXT.paidDailyLedgerUnavailable, { cause: error })
    }
    try {
      signal.throwIfAborted()
      const total = await journal.read(scope, PAID_DAILY_BUDGET.accountId)
      signal.throwIfAborted()
      if (total.spentUsd > readLimit(scope))
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
      await claim.settle(0)
      throw error
    }
  }
  const latestDay = async () => {
    const scope = day()
    readLimit(scope)
    const total = await journal.read(scope, PAID_DAILY_BUDGET.accountId)
    if (scope !== day()) throw new Error(UI_TEXT.paidDailyStopped)
    if (total.hasUnknownHistoricalFees) throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
    return { day: scope, capUsd: readLimit(scope), spentUsd: total.spentUsd }
  }
  const judgeLedger: JudgeDailyLedger = {
    remainingUsd: async () => {
      const current = await latestDay()
      return Math.max(0, current.capUsd - current.spentUsd)
    },
    reserve: async (costUsd) => {
      const scope = day()
      readLimit(scope)
      const claim = await journal.reserve(scope, PAID_DAILY_BUDGET.accountId, costUsd)
      const check = () => {
        if (scope !== day()) throw new Error(UI_TEXT.paidDailyStopped)
        claim.check(readLimit(scope))
      }
      try {
        check()
      } catch (error: unknown) {
        await claim.settle(0)
        throw error
      }
      return {
        claimId: claim.claimId,
        reservedUsd: claim.reservedUsd,
        check,
        settle: async (actualCostUsd) => {
          await claim.settle(actualCostUsd)
        },
      }
    },
  }
  return {
    capUsd,
    reserve,
    judgeLedger,
    latestDay,
    lookupByClaimId: (scope: string, claimId: string) =>
      journal.lookupByClaimId(scope, PAID_DAILY_BUDGET.accountId, claimId),
  }
}
