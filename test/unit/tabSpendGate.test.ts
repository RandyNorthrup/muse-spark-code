import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createTabLedger } from '../../src/host/tab/tabLedger'
import { createTabSpendGate } from '../../src/host/tab/tabSpendGate'
import { tabSettleUsd } from '../../src/core/tab/tabSpend'
import { Usd, type UsdAmount } from '../../src/shared/usd'

// M94 acceptance 10 + 20 (the status half): the spend gate over the real
// cross-window ledger. Nothing here is scripted: the ledger writes its real
// files under a temp folder, the gate prices the real worst case, and the
// test only moves the shared clock and counts the status-bar callbacks.

const MODEL = 'muse-spark-1.3'
const FACTS = { model: MODEL, inputBytes: 4000, maxOutputTokens: 608 }
const USAGE = { inputTokens: 1000, cachedTokens: 500, outputTokens: 40 }
const NO_BUDGET = Usd.from(0).toAmount()

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

describe('Tab spend gate over the real ledger', () => {
  let directory = ''
  const clock = { now: new Date(2026, 9, 4, 12).getTime() }
  let redraws = 0
  const warnings: string[] = []

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'm94-tab-spend-gate-'))
    clock.now = new Date(2026, 9, 4, 12).getTime()
    redraws = 0
    warnings.length = 0
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  function gate(budget = NO_BUDGET) {
    const ledger = createTabLedger({
      directory,
      windowId: 'spend-gate-window',
      now: () => clock.now,
      sleep: () => Promise.resolve(),
      log: {
        trace: () => undefined,
        info: () => undefined,
        warn: (message: string) => {
          warnings.push(message)
        },
        error: () => undefined,
      },
    })
    const spend = createTabSpendGate({
      ledger,
      budgetUsd: () => budget,
      now: () => clock.now,
      onTotalChanged: () => {
        redraws += 1
      },
      log: {
        trace: () => undefined,
        info: () => undefined,
        warn: (message: string) => {
          warnings.push(message)
        },
        error: () => undefined,
      },
    })
    return { ledger, spend }
  }

  async function settledTotal(
    spend: ReturnType<typeof gate>['spend'],
    expected: number,
  ): Promise<UsdAmount> {
    // The gate settles off the call path: wait until the ledger's answer is
    // the reported cost, not the reservation's worst case.
    for (let n = 0; n < 50; n += 1) {
      const total = spend.todayTotalUsd()
      if (Number(total) === expected) return total
      await sleep(20)
    }
    return spend.todayTotalUsd()
  }

  it('admits the worst case, settles that same reservation, and moves the status total', async () => {
    const { spend } = gate()
    const reservation = await spend.reserve(FACTS)
    expect(reservation).toBeDefined()
    if (reservation === undefined) throw new Error('admitted without a reservation')
    expect(reservation.model).toBe(MODEL)
    // The status bar's number is the ledger's worst case until the usage lands.
    expect(Number(spend.todayTotalUsd())).toBeGreaterThan(0)
    expect(spend.todayRequests()).toBe(1)

    spend.settle(reservation, USAGE)
    const total = await settledTotal(spend, Number(tabSettleUsd(USAGE, MODEL)))
    expect(Number(total)).toBe(Number(tabSettleUsd(USAGE, MODEL)))
    expect(redraws).toBeGreaterThan(0)
    expect(warnings).toEqual([])
  })

  it('refuses past a budget the person set, with no reservation to send', async () => {
    const { spend } = gate(Usd.from(0.000001).toAmount())
    const reservation = await spend.reserve(FACTS)
    expect(reservation).toBeUndefined()
    expect(spend.todayRequests()).toBe(0)
    expect(redraws).toBeGreaterThan(0)
  })

  it('settles usage that arrives after midnight against the reservation day', async () => {
    const { ledger, spend } = gate()
    const reservation = await spend.reserve(FACTS)
    if (reservation === undefined) throw new Error('admitted without a reservation')
    // The usage lands the next morning; the reservation keeps its own date.
    clock.now = new Date(2026, 9, 5, 1).getTime()
    spend.settle(reservation, USAGE)
    // The new day's total stays empty: the settlement lands on the old date.
    await settledTotal(spend, 0)
    // Back on the reservation day the ledger shows the reported cost, and the
    // new day carries nothing of it.
    clock.now = new Date(2026, 9, 4, 12).getTime()
    const then = await ledger.todayTotal()
    expect(then.ok).toBe(true)
    if (!then.ok) throw new Error(then.detail)
    expect(Number(then.totalUsd)).toBe(Number(tabSettleUsd(USAGE, MODEL)))
    clock.now = new Date(2026, 9, 5, 1).getTime()
    const now = await ledger.todayTotal()
    expect(now.ok).toBe(true)
    if (!now.ok) throw new Error(now.detail)
    expect(Number(now.totalUsd)).toBe(0)
  })
})
