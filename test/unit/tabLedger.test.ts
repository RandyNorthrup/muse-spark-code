import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTabLedger } from '../../src/host/tab/tabLedger'
import { TAB_NO_BUDGET_USD } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'

const log = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

describe('Tab ledger without a budget (NOLIMITS5)', () => {
  let directory = ''
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'nolimits5-tab-ledger-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('admits past the old $1 default when no budget is set, and still accounts spend', async () => {
    const ledger = createTabLedger({
      directory,
      windowId: 'no-budget-window',
      now: () => Date.now(),
      sleep: () => Promise.resolve(),
      log,
    })
    const worstCase = Usd.from(0.6).toAmount()
    for (let n = 0; n < 2; n += 1) {
      const admission = await ledger.admit(worstCase, Usd.from(TAB_NO_BUDGET_USD).toAmount())
      expect(admission.admitted).toBe(true)
    }
    const total = await ledger.todayUsage()
    expect(total.ok).toBe(true)
    if (!total.ok) throw new Error(total.detail)
    expect(total.totalUsd).toBe(Usd.from(1.2).toAmount())
  })

  it('still refuses past a budget the person set', async () => {
    const ledger = createTabLedger({
      directory,
      windowId: 'capped-window',
      now: () => Date.now(),
      sleep: () => Promise.resolve(),
      log,
    })
    const budget = Usd.from(1).toAmount()
    const first = await ledger.admit(Usd.from(0.6).toAmount(), budget)
    expect(first.admitted).toBe(true)
    const second = await ledger.admit(Usd.from(0.6).toAmount(), budget)
    expect(second).toMatchObject({ admitted: false, reason: 'budgetReached' })
  })
})
