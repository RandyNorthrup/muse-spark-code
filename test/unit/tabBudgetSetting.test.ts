import { describe, expect, it } from 'vitest'
import { readSettings } from '../../src/host/settings'
import { Usd } from '../../src/shared/usd'

const log = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

function budgetOf(value: unknown) {
  return readSettings(
    {
      get: (key: string) => (key === 'tabDailyBudgetUsd' ? value : undefined),
    },
    log,
  ).tabDailyBudgetUsd
}

describe('Tab daily budget setting (NOLIMITS5)', () => {
  it('takes 0 as no budget, keeps a set budget, and has no ceiling', () => {
    expect(budgetOf(undefined)).toBe(Usd.from(0).toAmount())
    expect(budgetOf(0)).toBe(Usd.from(0).toAmount())
    expect(budgetOf(1)).toBe(Usd.from(1).toAmount())
    expect(budgetOf(500)).toBe(Usd.from(500).toAmount())
  })

  it('falls back to no budget below the dust floor', () => {
    expect(budgetOf(0.03)).toBe(Usd.from(0).toAmount())
  })
})
