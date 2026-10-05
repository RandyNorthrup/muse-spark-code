// Cap validation (M96 lane F): each case D75 lists, refused or warned
// with its own reason.

import { describe, expect, it } from 'vitest'
import {
  TEAM_MIN_REQUEST_TOKENS,
  validateCap,
  validateEntryCaps,
  type TeamCapBudgets,
  type TeamCapInput,
  type TeamCapModelInfo,
} from '../../src/core/team/capValidation'
import { formatNumber } from '../../src/shared/l10n/text'

const PRICED: TeamCapModelInfo = { usdPerMTok: 3, billedToKey: true }
const UNPRICED_KEY: TeamCapModelInfo = { usdPerMTok: undefined, billedToKey: true }
const LOCAL: TeamCapModelInfo = { usdPerMTok: undefined, billedToKey: false }
const BUDGETS: TeamCapBudgets = { maxConcurrent: 8, teamDailyBudgetUsd: 50 }

function tokens(window: 'task' | 'day' | 'lifetime', amount: number): TeamCapInput {
  return { measure: 'tokens', window, amount, prefixTokens: 500 }
}

describe('validateCap', () => {
  it('refuses a token cap below one request minimum', () => {
    const floor = 500 + TEAM_MIN_REQUEST_TOKENS
    const issues = validateCap(tokens('task', floor - 1), PRICED, BUDGETS, 1_000_000, undefined)
    expect(issues.map((issue) => issue.code)).toContain('tokenCapTooSmall')
    expect(issues.every((issue) => issue.severity === 'error')).toBe(true)
    expect(issues[0]?.message).toContain(formatNumber(floor))
  })

  it('accepts a token cap at exactly the minimum', () => {
    const floor = 500 + TEAM_MIN_REQUEST_TOKENS
    expect(validateCap(tokens('task', floor), PRICED, BUDGETS, 1_000_000, undefined)).toEqual([])
  })

  it('refuses a task cap above the day cap, either direction', () => {
    const taskSide = validateCap(tokens('task', 500_000), PRICED, BUDGETS, 400_000, undefined)
    expect(taskSide.map((issue) => issue.code)).toContain('taskAboveDay')
    const daySide = validateCap(tokens('day', 400_000), PRICED, BUDGETS, undefined, 500_000)
    expect(daySide.map((issue) => issue.code)).toContain('taskAboveDay')
  })

  it('refuses a dollar cap on an unpriced model', () => {
    const cap: TeamCapInput = { measure: 'usd', window: 'day', amount: 5, prefixTokens: 500 }
    const issues = validateCap(cap, UNPRICED_KEY, BUDGETS, undefined, undefined)
    expect(issues.map((issue) => issue.code)).toContain('dollarCapUnpriced')
  })

  it('refuses a day dollar cap above the team daily budget', () => {
    const cap: TeamCapInput = { measure: 'usd', window: 'day', amount: 60, prefixTokens: 500 }
    const issues = validateCap(cap, PRICED, BUDGETS, undefined, undefined)
    expect(issues.map((issue) => issue.code)).toContain('dayAboveBudget')
  })

  it('passes a fitting priced cap set', () => {
    const issues = validateEntryCaps(
      [tokens('task', 400_000), tokens('day', 5_000_000)],
      PRICED,
      BUDGETS,
      4,
    )
    expect(issues).toEqual([])
  })
})

describe('validateEntryCaps', () => {
  it('refuses concurrent above the global caps', () => {
    const issues = validateEntryCaps([tokens('task', 400_000)], PRICED, BUDGETS, 9)
    expect(issues.map((issue) => issue.code)).toContain('concurrentAboveGlobal')
    expect(issues[0]?.message).toContain('8')
  })

  it('needs task and day token caps on an unpriced key model', () => {
    expect(
      validateEntryCaps([tokens('task', 60_000)], UNPRICED_KEY, BUDGETS, 1).map((i) => i.code),
    ).toContain('unpricedKeyNeedsCaps')
    expect(
      validateEntryCaps([tokens('day', 1_000_000)], UNPRICED_KEY, BUDGETS, 1).map((i) => i.code),
    ).toContain('unpricedKeyNeedsCaps')
    expect(
      validateEntryCaps(
        [tokens('task', 60_000), tokens('day', 1_000_000)],
        UNPRICED_KEY,
        BUDGETS,
        1,
      ),
    ).toEqual([])
  })

  it('asks nothing of a local model without caps', () => {
    expect(validateEntryCaps([], LOCAL, BUDGETS, 1)).toEqual([])
  })
})
