import { Usd, type UsdAmount } from '../../shared/usd'
// Cap validation (M96 lane F, PLAN.md D75): inline validation, as the
// user types, over each entry's caps. Each case D75 lists refuses or warns
// with its own reason. Pure; no `vscode` import.
//
// Severity follows the panel's contract (lane U1): `error` refuses the
// value, `warning` shows beside it and still saves.

import { TEAM_MIN_REQUEST_TOKENS, UI_TEXT } from '../../shared/constants'
import { fill, formatNumber, formatUsd } from '../../shared/l10n/text'
import type { TeamCapDraft } from './templates'

/** One request's minimum tokens (D75): the role's prefix plus this. */
export { TEAM_MIN_REQUEST_TOKENS } from '../../shared/constants'

export type TeamCapMeasure = TeamCapDraft['measure']
export type TeamCapWindow = 'task' | 'day' | 'lifetime'

/** One cap the user typed, with the role's prefix for the minimum. */
export interface TeamCapInput {
  readonly measure: TeamCapMeasure
  readonly window: TeamCapWindow
  readonly amount: number
  /** The role's request prefix in tokens (lane U1 reads it off the roster). */
  readonly prefixTokens: number
}

/** What the entry's model bills, from M95's price card. */
export interface TeamCapModelInfo {
  /** Absent when M95 never priced the model: M95 never guesses a price. */
  readonly usdPerMTok: number | undefined
  /** True for entries billed to a key (a paid use). */
  readonly billedToKey: boolean
}

/** The budgets the cap must fit beneath. */
export interface TeamCapBudgets {
  /** The entry's global concurrency ceiling (lane A computes it). */
  readonly maxConcurrent: number
  /** The team's daily budget in dollars (`museSpark.teamDailyBudgetUsd`). */
  readonly teamDailyBudgetUsd: UsdAmount
  readonly teamDailyBudgetTokens: number
}

export type TeamCapIssueCode =
  | 'tokenCapTooSmall'
  | 'taskAboveDay'
  | 'dollarCapUnpriced'
  | 'unpricedKeyNeedsCaps'
  | 'concurrentAboveGlobal'
  | 'dayAboveBudget'
  | 'invalidAmount'
  | 'invalidConcurrent'

export interface TeamCapIssue {
  readonly code: TeamCapIssueCode
  readonly severity: 'error' | 'warning'
  /** The reason in the display language. */
  readonly message: string
}

function tokenCapTooSmall(minimum: number): TeamCapIssue {
  return {
    code: 'tokenCapTooSmall',
    severity: 'error',
    message: fill(UI_TEXT.teamCapTokenTooSmall, { minimum }),
  }
}

/**
 * Validates one cap as the user types it. `siblingDayAmount` is the same
 * measure's `day` cap for the task-above-day case; `siblingTaskAmount` is
 * the `task` cap when validating a `day` cap.
 */
export function validateCap(
  cap: TeamCapInput,
  model: TeamCapModelInfo,
  budgets: TeamCapBudgets,
  siblingDayAmount: number | undefined,
  siblingTaskAmount: number | undefined,
): readonly TeamCapIssue[] {
  const issues: TeamCapIssue[] = []
  if (
    !Number.isFinite(cap.amount) ||
    cap.amount <= 0 ||
    (cap.measure !== 'spendUsd' && !Number.isSafeInteger(cap.amount))
  ) {
    issues.push({ code: 'invalidAmount', severity: 'error', message: UI_TEXT.teamCapInvalidAmount })
    return issues
  }
  if (cap.measure === 'tokens' && cap.amount < cap.prefixTokens + TEAM_MIN_REQUEST_TOKENS) {
    issues.push(tokenCapTooSmall(cap.prefixTokens + TEAM_MIN_REQUEST_TOKENS))
  }
  if (siblingDayAmount !== undefined && cap.window === 'task' && cap.amount > siblingDayAmount) {
    issues.push({ code: 'taskAboveDay', severity: 'error', message: UI_TEXT.teamCapTaskAboveDay })
  }
  if (siblingTaskAmount !== undefined && cap.window === 'day' && siblingTaskAmount > cap.amount) {
    issues.push({ code: 'taskAboveDay', severity: 'error', message: UI_TEXT.teamCapTaskAboveDay })
  }
  if (cap.measure === 'spendUsd' && model.usdPerMTok === undefined) {
    issues.push({
      code: 'dollarCapUnpriced',
      severity: 'error',
      message: UI_TEXT.teamCapDollarUnpriced,
    })
  }
  const isOverBudget =
    cap.measure === 'spendUsd'
      ? Usd.from(cap.amount).compare(Usd.from(budgets.teamDailyBudgetUsd)) > 0
      : cap.amount > budgets.teamDailyBudgetTokens
  if (isOverBudget && cap.window === 'day' && cap.measure !== 'tasks') {
    issues.push({
      code: 'dayAboveBudget',
      severity: 'error',
      message: fill(UI_TEXT.teamCapDayAboveBudgetDetail, {
        budget:
          cap.measure === 'spendUsd'
            ? formatUsd(budgets.teamDailyBudgetUsd, 2)
            : formatNumber(budgets.teamDailyBudgetTokens),
      }),
    })
  }
  return issues
}

/**
 * Validates the entry's whole cap set: an unpriced key model needs both a
 * `task` and a `day` token cap (D75), and `concurrent` never passes the
 * global caps.
 */
export function validateEntryCaps(
  caps: readonly TeamCapInput[],
  model: TeamCapModelInfo,
  budgets: TeamCapBudgets,
  concurrent: number,
): readonly TeamCapIssue[] {
  const issues: TeamCapIssue[] = caps.flatMap((cap) =>
    validateCap(
      cap,
      model,
      budgets,
      dayAmountFor(caps, cap.measure),
      taskAmountFor(caps, cap.measure),
    ),
  )
  if (!Number.isSafeInteger(concurrent) || concurrent < 1) {
    issues.push({
      code: 'invalidConcurrent',
      severity: 'error',
      message: UI_TEXT.teamCapInvalidConcurrent,
    })
  } else if (concurrent > budgets.maxConcurrent) {
    issues.push({
      code: 'concurrentAboveGlobal',
      severity: 'error',
      message: fill(UI_TEXT.teamCapConcurrentAboveGlobalDetail, { maximum: budgets.maxConcurrent }),
    })
  }
  if (model.billedToKey && model.usdPerMTok === undefined) {
    const hasTask = caps.some(
      (cap) =>
        cap.measure === 'tokens' &&
        cap.window === 'task' &&
        Number.isSafeInteger(cap.amount) &&
        cap.amount >= cap.prefixTokens + TEAM_MIN_REQUEST_TOKENS,
    )
    const hasDay = caps.some(
      (cap) =>
        cap.measure === 'tokens' &&
        cap.window === 'day' &&
        Number.isSafeInteger(cap.amount) &&
        cap.amount >= cap.prefixTokens + TEAM_MIN_REQUEST_TOKENS,
    )
    if (!hasTask || !hasDay) {
      issues.push({
        code: 'unpricedKeyNeedsCaps',
        severity: 'error',
        message: UI_TEXT.teamCapUnpricedKeyNeedsCaps,
      })
    }
  }
  return issues
}

function dayAmountFor(caps: readonly TeamCapInput[], measure: TeamCapMeasure): number | undefined {
  return caps.find((cap) => cap.measure === measure && cap.window === 'day')?.amount
}

function taskAmountFor(caps: readonly TeamCapInput[], measure: TeamCapMeasure): number | undefined {
  return caps.find((cap) => cap.measure === measure && cap.window === 'task')?.amount
}
