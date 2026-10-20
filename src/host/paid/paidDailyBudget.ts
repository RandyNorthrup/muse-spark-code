import { SpendLedgerError } from '../../core/paid/spendLedgerError'
import { UserRefusalError, isUserRefusal } from '../../core/refusal'
import {
  Usd,
  isPositiveUsd,
  legacyUsdSchema,
  usdInputSchema,
  type UsdAmount,
} from '../../shared/usd'
// The editor's shared daily limit for interactive paid extras (D78; PLAN.md
// D208): `museSpark.paidDailyBudgetUsd`, set by the person, none by default.
// With no limit nothing is read or written for a paid request. With one, a
// request whose estimate would pass what is left of today asks to raise the
// limit for today or stop paid extras until tomorrow; each request's reported
// cost joins today's running total after it ends, shared across windows by
// one file per window (dailySpend.ts). Nothing is held for a request in
// flight, and a request that reported no usage is counted as cost unknown.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'
import * as vscode from 'vscode'
import * as z from 'zod/mini'
import type { JudgeDailyLedger } from '../../core/judge/admission'
import type { ModelApiClientDeps } from '../../core/backends/modelapi/client'
import { SessionBudgetExceededError } from '../../core/backends/modelapi/sessionBudget'
import type { SpendClaim } from '../../core/paid/spendClaim'
import { estimateCostUsd } from '../../core/usage/insights'
import { unlessAborted } from '../../core/timeouts'
import { PAID_DAILY_BUDGET, PAID_PRICES_USD, UI_TEXT } from '../../shared/constants'
import { fill, formatDateTime } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'
import { modelApiPaidTier } from '../../shared/paid'
import { storeErrorCode } from '../backend/storeErrors'
import { writeFileAtomically } from '../fsAtomic'
import type { UsageBudgetRead } from '../../core/usage/usageService'
import { createDailySpend, paidDailyBudgetRow } from './dailySpend'

const limitSchema = z.object({
  limitUsd: legacyUsdSchema.check(z.refine((amount) => Usd.from(amount).compare(Usd.from(0)) > 0)),
  stopped: z.boolean(),
})

export function createPaidDailyBudget(deps: {
  readonly directory: string
  readonly now: () => number
  /** The setting, read live; zero is no limit. */
  readonly capUsd: () => UsdAmount
  readonly sleep: (ms: number) => Promise<void>
  readonly isModelApi: () => boolean
}) {
  const spend = createDailySpend({ directory: deps.directory, sleep: deps.sleep })
  const day = () => {
    const today = new Date(deps.now())
    return [today.getFullYear(), today.getMonth() + 1, today.getDate()].join('-')
  }
  const nextMidnight = () => {
    const reset = new Date(deps.now())
    reset.setHours(0, 0, 0, 0)
    reset.setDate(reset.getDate() + 1)
    return reset.getTime()
  }
  const limitPath = (scope: string) =>
    path.join(deps.directory, scope, PAID_DAILY_BUDGET.overrideFile)
  const stopPath = (scope: string) =>
    path.join(deps.directory, scope, PAID_DAILY_BUDGET.stopDirectory)
  /** Today's limit: a raise written for today, else the setting; zero is none. */
  const readLimit = (scope: string, isDisplay = false): UsdAmount => {
    const settingsFailure = (error: unknown): never => {
      throw new SpendLedgerError(
        storeErrorCode(error) === undefined ? 'damaged' : 'unreadable',
        { scope, file: 'daily settings', errno: storeErrorCode(error) },
        error,
      )
    }
    let isStopped = false
    try {
      statSync(stopPath(scope))
      isStopped = true
    } catch (error: unknown) {
      if (storeErrorCode(error) !== 'ENOENT') settingsFailure(error)
    }
    if (isStopped && !isDisplay)
      throw new UserRefusalError(UI_TEXT.paidDailyStopped, 'daily_stopped')
    let limit: z.infer<typeof limitSchema>
    try {
      limit = limitSchema.parse(JSON.parse(readFileSync(limitPath(scope), 'utf8')))
    } catch (error: unknown) {
      if (storeErrorCode(error) !== 'ENOENT') settingsFailure(error)
      limit = { limitUsd: deps.capUsd(), stopped: false }
    }
    if (!isDisplay && limit.stopped)
      throw new UserRefusalError(UI_TEXT.paidDailyStopped, 'daily_stopped')
    return limit.limitUsd
  }
  const stopError = (estimateUsd: UsdAmount, limitUsd: UsdAmount, spentUsd: UsdAmount) =>
    new SessionBudgetExceededError(
      fill(UI_TEXT.execPaidDailyStopped, {
        estimate: formatUsd(estimateUsd),
        cap: formatUsd(limitUsd),
        spent: formatUsd(spentUsd),
        reset: formatDateTime(nextMidnight()),
        setting: 'museSpark.paidDailyBudgetUsd',
      }),
    )
  const isWithinLimit = (scope: string, estimateUsd: UsdAmount, limitUsd: UsdAmount): boolean =>
    Usd.from(spend.read(scope).spentUsd).add(Usd.from(estimateUsd)).compare(Usd.from(limitUsd)) <= 0
  /** The person raises today's limit above what is needed, or stops paid extras until tomorrow. */
  const raise = async (scope: string, neededUsd: UsdAmount, signal: AbortSignal): Promise<void> => {
    const assertActive = () => {
      signal.throwIfAborted()
      if (scope !== day()) throw new UserRefusalError(UI_TEXT.spendLedgerMidnight, 'midnight')
      readLimit(scope)
    }
    const stop = (): never => {
      assertActive()
      // Synchronous publication owns cancellation; this marker is never
      // removed or overwritten by a raise, even one already in rename().
      mkdirSync(stopPath(scope), { recursive: true })
      throw new UserRefusalError(UI_TEXT.paidDailyStopped, 'daily_stopped')
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
    const suggestedLimit =
      Usd.from(neededUsd).compare(doubledLimit) > 0 ? neededUsd : doubledLimit.toAmount()
    const enoughLimit = (value: string | undefined) => {
      const parsed = limitSchema.safeParse({
        limitUsd: usdInputSchema.safeParse(value).data,
        stopped: false,
      })
      return parsed.success && Usd.from(parsed.data.limitUsd).compare(Usd.from(neededUsd)) >= 0
        ? parsed.data
        : undefined
    }
    const entered = await unlessAborted(
      Promise.resolve(
        vscode.window.showInputBox({
          title: raiseTitle,
          prompt: UI_TEXT.paidDailyRaisePrompt,
          value: suggestedLimit,
          validateInput: (value) =>
            enoughLimit(value) === undefined ? UI_TEXT.paidDailyRaisePrompt : undefined,
        }),
      ),
      signal,
    )
    assertActive()
    const raised = enoughLimit(entered) ?? stop()
    await writeFileAtomically(limitPath(scope), JSON.stringify(raised), {
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
  /**
  One paid request under today's limit: `undefined` when the person set
  none (nothing is read or written); otherwise its claim. An estimate that
  would pass what is left asks to raise the limit when the person can
  answer (a signal), and refuses with the stop sentence otherwise.
  */
  const admit = async (
    estimateUsd: UsdAmount,
    signal?: AbortSignal,
  ): Promise<SpendClaim | undefined> => {
    const scope = day()
    const limitUsd = readLimit(scope)
    if (!isPositiveUsd(limitUsd)) return undefined
    if (!isWithinLimit(scope, estimateUsd, limitUsd)) {
      const spentUsd = spend.read(scope).spentUsd
      if (signal === undefined) throw stopError(estimateUsd, limitUsd, spentUsd)
      await unlessAborted(
        raise(scope, Usd.from(spentUsd).add(Usd.from(estimateUsd)).toAmount(), signal),
        signal,
      )
    }
    let isSettled = false
    return {
      estimateUsd,
      check: () => {
        signal?.throwIfAborted()
        if (scope !== day()) throw new UserRefusalError(UI_TEXT.spendLedgerMidnight, 'midnight')
        const live = readLimit(scope)
        if (isPositiveUsd(live) && !isWithinLimit(scope, estimateUsd, live))
          throw stopError(estimateUsd, live, spend.read(scope).spentUsd)
      },
      settle: async (costUsd) => {
        if (isSettled) return
        isSettled = true
        await spend.add(scope, costUsd)
      },
    }
  }
  /** A stop marker refuses with today's numbers, never a bare sentence. */
  const describeStop = (error: unknown): unknown => {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'daily_stopped')
      return error
    const scope = day()
    return stopError(Usd.from(0).toAmount(), readLimit(scope, true), spend.read(scope).spentUsd)
  }
  const reserve: NonNullable<ModelApiClientDeps['reservePaidRequest']> = async (
    body,
    feature,
    estimatedInputTokens,
    signal = new AbortController().signal,
  ) => {
    signal.throwIfAborted()
    if (feature !== 'legalExplanation' && !deps.isModelApi()) return
    try {
      if (!isPositiveUsd(readLimit(day()))) return
      // Hosted search bills a query count with no verified bound: a limit
      // cannot be kept for it.
      if (
        feature === 'webSearch' ||
        ('tools' in body && body.tools.some((tool) => tool.type === 'web_search'))
      )
        throw new UserRefusalError(UI_TEXT.sessionBudgetSearchUnavailable, 'search_unbounded')
      let costUsd = Usd.from(PAID_PRICES_USD.imageGeneration).toAmount()
      if ('input' in body) {
        if (modelApiPaidTier(body.model) === undefined)
          throw new UserRefusalError(UI_TEXT.execModelUnpriced, 'unpriced')
        if (
          estimatedInputTokens === undefined ||
          !Number.isSafeInteger(estimatedInputTokens) ||
          estimatedInputTokens < 0 ||
          !Number.isSafeInteger(body.max_output_tokens) ||
          body.max_output_tokens < 0
        )
          throw new SpendLedgerError('integrity', { scope: 'daily', file: 'paid admission' })
        costUsd = estimateCostUsd(
          {
            inputTokens: Math.max(
              estimatedInputTokens,
              Buffer.byteLength(JSON.stringify(body), 'utf8'),
            ),
            outputTokens: body.max_output_tokens,
            cachedTokens: 0,
          },
          body.model,
        )
      }
      return await admit(costUsd, signal)
    } catch (error: unknown) {
      signal.throwIfAborted()
      const described = describeStop(error)
      if (isUserRefusal(described)) throw described
      throw new SpendLedgerError(
        storeErrorCode(error) === undefined ? 'damaged' : 'unreadable',
        { scope: day(), file: 'daily settings', errno: storeErrorCode(error) },
        error,
      )
    }
  }
  /** An exact amount (an automatic compaction, a judge call): never asks to raise. */
  const reserveExact = async (costUsd: UsdAmount): Promise<SpendClaim | undefined> => {
    try {
      return await admit(costUsd)
    } catch (error: unknown) {
      throw describeStop(error)
    }
  }
  const readToday = (): Promise<readonly UsageBudgetRead[]> => {
    const scope = day()
    let isStopped = false
    let cap: UsdAmount
    try {
      cap = readLimit(scope)
    } catch (error: unknown) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'daily_stopped')
        throw error
      isStopped = true
      cap = readLimit(scope, true)
    }
    if (!isPositiveUsd(cap)) return Promise.resolve([])
    const total = spend.read(scope)
    return Promise.resolve([
      paidDailyBudgetRow({
        scope,
        total,
        capUsd: cap,
        stopped: isStopped,
        raisedToday: Usd.from(cap).compare(Usd.from(deps.capUsd())) > 0,
        resetsAt: nextMidnight(),
      }),
    ])
  }
  const judgeLedger: JudgeDailyLedger = {
    remainingUsd: () => {
      const scope = day()
      const limitUsd = readLimit(scope)
      if (!isPositiveUsd(limitUsd)) return Promise.resolve(undefined)
      const remaining = Usd.from(limitUsd).subtract(Usd.from(spend.read(scope).spentUsd))
      return Promise.resolve(
        remaining.compare(Usd.from(0)) < 0 ? Usd.from(0).toAmount() : remaining.toAmount(),
      )
    },
    reserve: async (costUsd) => {
      const claim = await reserveExact(Usd.from(costUsd).toAmount())
      return claim === undefined
        ? undefined
        : {
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
    reserveExact,
    capUsd: () => readLimit(day()),
    readToday,
    reserve,
    judgeLedger,
  }
}
