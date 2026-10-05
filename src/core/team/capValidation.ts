// Cap validation (M96 lane F, PLAN.md D75): inline validation, as the
// user types, over each entry's caps. Each case D75 lists refuses or warns
// with its own reason. Pure; no `vscode` import.
//
// Severity follows the panel's contract (lane U1): `error` refuses the
// value, `warning` shows beside it and still saves.

import { UI_TEXT } from '../../shared/constants'
import { fill, formatUsd } from '../../shared/l10n/text'

/** One request's minimum tokens (D75): the role's prefix plus this. */
export const TEAM_MIN_REQUEST_TOKENS = 2048

export type TeamCapMeasure = 'tokens' | 'usd' | 'tasks' | 'minutes'
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
  readonly teamDailyBudgetUsd: number
}

export type TeamCapIssueCode =
  | 'tokenCapTooSmall'
  | 'taskAboveDay'
  | 'dollarCapUnpriced'
  | 'unpricedKeyNeedsCaps'
  | 'concurrentAboveGlobal'
  | 'dayAboveBudget'

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
  if (cap.measure === 'tokens' && cap.amount < cap.prefixTokens + TEAM_MIN_REQUEST_TOKENS) {
    issues.push(tokenCapTooSmall(cap.prefixTokens + TEAM_MIN_REQUEST_TOKENS))
  }
  if (
    siblingDayAmount !== undefined &&
    cap.measure === 'tokens' &&
    cap.window === 'task' &&
    cap.amount > siblingDayAmount
  ) {
    issues.push({ code: 'taskAboveDay', severity: 'error', message: UI_TEXT.teamCapTaskAboveDay })
  }
  if (
    siblingTaskAmount !== undefined &&
    cap.measure === 'tokens' &&
    cap.window === 'day' &&
    siblingTaskAmount > cap.amount
  ) {
    issues.push({ code: 'taskAboveDay', severity: 'error', message: UI_TEXT.teamCapTaskAboveDay })
  }
  if (cap.measure === 'usd' && model.usdPerMTok === undefined) {
    issues.push({
      code: 'dollarCapUnpriced',
      severity: 'error',
      message: UI_TEXT.teamCapDollarUnpriced,
    })
  }
  if (cap.window === 'day' && cap.measure === 'usd' && cap.amount > budgets.teamDailyBudgetUsd) {
    issues.push({
      code: 'dayAboveBudget',
      severity: 'error',
      message: fill(UI_TEXT.teamCapDayAboveBudget, {
        budget: formatUsd(budgets.teamDailyBudgetUsd, 2),
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
  if (concurrent > budgets.maxConcurrent) {
    issues.push({
      code: 'concurrentAboveGlobal',
      severity: 'error',
      message: fill(UI_TEXT.teamCapConcurrentAboveGlobal, { maximum: budgets.maxConcurrent }),
    })
  }
  if (model.billedToKey && model.usdPerMTok === undefined) {
    const hasTask = caps.some((cap) => cap.measure === 'tokens' && cap.window === 'task')
    const hasDay = caps.some((cap) => cap.measure === 'tokens' && cap.window === 'day')
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
