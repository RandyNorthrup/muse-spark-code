// D78: daily interactive extras share M82's durable claims across windows.
import { mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'
import * as vscode from 'vscode'
import * as z from 'zod/mini'
import type { JudgeDailyLedger } from '../../core/judge/admission'
import type { ModelApiClientDeps } from '../../core/backends/modelapi/client'
import type { AccountBudgetAdmission } from '../../core/backends/modelapi/sessionBudget'
import { unlessAborted } from '../../core/timeouts'
import {
  MODEL_API_PRICES_PER_MILLION,
  PAID_DAILY_BUDGET,
  PAID_PRICES_USD,
  TOKENS_PER_MILLION,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { modelApiPaidTier } from '../../shared/paid'
import {
  compareUsd,
  formatUsd,
  multiplyUsd,
  parseUsd,
  subtractUsd,
  sumUsd,
  usdNumber,
} from '../../shared/accountUsd'
import { createSessionBudgetJournal } from '../backend/sessionBudgetJournal'
import { storeErrorCode } from '../backend/storeErrors'
import { writeFileAtomically } from '../fsAtomic'
import type { UsageBudgetRead } from '../../core/usage/usageService'

const ZERO = 0n
const DOUBLE = 2n

const limitSchema = z.object({
  limitUsd: z
    .number()
    .check(z.minimum(PAID_DAILY_BUDGET.minimumUsd), z.maximum(PAID_DAILY_BUDGET.maximumUsd)),
  stopped: z.boolean(),
})

const parseLimit = (value: string | undefined) => {
  let limitUsd = NaN
  try {
    if (value !== undefined) limitUsd = usdNumber(parseUsd(value, 'floor'))
  } catch {
    // Invalid decimal input remains a failed schema result for both UI and publication.
  }
  return limitSchema.safeParse({ limitUsd, stopped: false })
}

export function createPaidDailyBudget(deps: {
  readonly directory: string
  readonly now: () => number
  readonly capUsd: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly isModelApi: () => boolean
  /** P's account-bound guard; shared daily claims still use one fixed scope. */
  readonly accountAdmission?: AccountBudgetAdmission
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
              budget: formatUsd(parseUsd(readLimit(scope), 'floor'), 2),
              needed: formatUsd(parseUsd(neededUsd), 2),
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
    const needed = parseUsd(neededUsd)
    const doubled = multiplyUsd(parseUsd(readLimit(scope), 'floor'), DOUBLE)
    const proposed = compareUsd(doubled, needed) > 0 ? doubled : needed
    const maximum = parseUsd(PAID_DAILY_BUDGET.maximumUsd)
    const entered = await unlessAborted(
      Promise.resolve(
        vscode.window.showInputBox({
          title: raiseTitle,
          prompt: UI_TEXT.paidDailyRaisePrompt,
          value: String(usdNumber(compareUsd(proposed, maximum) < 0 ? proposed : maximum)),
          validateInput: (value) => {
            const parsed = parseLimit(value)
            if (!parsed.success || compareUsd(parseUsd(parsed.data.limitUsd, 'floor'), needed) < 0)
              return UI_TEXT.paidDailyRaisePrompt
            return
          },
        }),
      ),
      signal,
    )
    assertActive()
    const parsed = parseLimit(entered)
    if (
      entered === undefined ||
      !parsed.success ||
      compareUsd(parseUsd(parsed.data.limitUsd, 'floor'), parseUsd(neededUsd)) < 0
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
        const tier = modelApiPaidTier(body.model)
        if (tier === undefined) throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
        if (estimatedInputTokens === undefined) throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
        if (
          !Number.isSafeInteger(estimatedInputTokens) ||
          estimatedInputTokens < 0 ||
          !Number.isSafeInteger(body.max_output_tokens) ||
          body.max_output_tokens < 0
        )
          throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
        const tariff = MODEL_API_PRICES_PER_MILLION[tier]
        costUsd = usdNumber(
          sumUsd([
            multiplyUsd(
              parseUsd(tariff.input),
              BigInt(estimatedInputTokens),
              BigInt(TOKENS_PER_MILLION),
            ),
            multiplyUsd(
              parseUsd(tariff.output),
              BigInt(body.max_output_tokens),
              BigInt(TOKENS_PER_MILLION),
            ),
          ]),
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
      if (compareUsd(parseUsd(total.spentUsd), parseUsd(readLimit(scope), 'floor')) > 0)
        await unlessAborted(raise(scope, total.spentUsd, signal), signal)
      signal.throwIfAborted()
      return admittedClaim
    } catch (error: unknown) {
      await claim.settle(0)
      throw error
    }
  }
  const readToday = async (): Promise<readonly UsageBudgetRead[]> => {
    const scope = day()
    const total = await journal.readExisting(scope, PAID_DAILY_BUDGET.accountId)
    let isStopped = false
    let cap: number
    try {
      cap = readLimit(scope)
    } catch (error: unknown) {
      if (!(error instanceof Error) || error.message !== UI_TEXT.paidDailyStopped) throw error
      isStopped = true
      cap = readLimit(scope, true)
    }
    const reset = new Date(deps.now())
    reset.setHours(0, 0, 0, 0)
    reset.setDate(reset.getDate() + 1)
    return [
      {
        budget: {
          id: scope,
          kind: 'paidDaily',
          spentUsd: total?.spentUsd ?? 0,
          ...(total?.uncertainUsd !== undefined && { uncertainUsd: total.uncertainUsd }),
          capUsd: cap,
          stopped: isStopped,
          raisedToday: cap > deps.capUsd(),
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
    return { day: scope, capUsd: readLimit(scope), spentUsd: total.spentUsd }
  }
  const judgeLedger: JudgeDailyLedger = {
    remainingUsd: async () => {
      const current = await latestDay()
      const remaining = subtractUsd(parseUsd(current.capUsd, 'floor'), parseUsd(current.spentUsd))
      return usdNumber(compareUsd(remaining, ZERO) > 0 ? remaining : ZERO)
    },
    reserve: async (costUsd) => {
      const scope = day()
      readLimit(scope)
      const claim = await journal.reserve(scope, PAID_DAILY_BUDGET.accountId, costUsd)
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
    readToday,
    reserve,
    judgeLedger,
    latestDay,
    lookupByClaimId: (scope: string, claimId: string) =>
      journal.lookupByClaimId(scope, PAID_DAILY_BUDGET.accountId, claimId),
  }
}
