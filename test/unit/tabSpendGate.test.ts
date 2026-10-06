// Tab's spend gate over lane L's ledger (M94, PLAN.md D73): the provider's
// reservation carries its own worst case to the settlement, a refused
// admission sends nothing, and the status bar's total follows the ledger.

import { describe, expect, it, vi } from 'vitest'

import type { TabAdmission, TabDayTotal, TabLedger } from '../../src/host/tab/tabLedger'
import { createTabSpendGate } from '../../src/host/tab/tabSpendGate'
import { estimateCostUsd } from '../../src/core/usage/insights'
import { FakeLogOutputChannel } from './helpers/fakes'

const MODEL = 'muse-spark-1.3'
const FACTS = { model: MODEL, inputBytes: 4000, maxOutputTokens: 608 }
const WORST = estimateCostUsd({ inputTokens: 4000, outputTokens: 608, cachedTokens: 0 }, MODEL)
const DATE = '2026-10-04'

function fakeLedger(admission: TabAdmission, total?: TabDayTotal) {
  const day: TabDayTotal = total ?? { ok: true, totalUsd: 0 }
  const ledger = {
    admit: vi.fn((): Promise<TabAdmission> => Promise.resolve(admission)),
    settle: vi.fn((): Promise<void> => Promise.resolve()),
    todayTotal: vi.fn((): Promise<TabDayTotal> => Promise.resolve(day)),
  }
  const typed: TabLedger = ledger
  return { ledger, typed }
}

/** The gate's clock: noon on 2026-10-04 unless a test moves it. */
const clock = { now: new Date(2026, 9, 4, 12).getTime() }

function gate(ledger: TabLedger, onTotalChanged = vi.fn()) {
  clock.now = new Date(2026, 9, 4, 12).getTime()
  return createTabSpendGate({
    ledger,
    budgetUsd: () => 1,
    now: () => clock.now,
    onTotalChanged,
    log: new FakeLogOutputChannel(),
  })
}

describe('createTabSpendGate', () => {
  it('admits the worst case through the ledger and settles that same reservation', async () => {
    const { ledger, typed } = fakeLedger({
      admitted: true,
      totalUsd: WORST,
      reservation: { date: DATE, worstCaseUsd: WORST },
    })
    const spend = gate(typed)
    const reservation = await spend.reserve(FACTS)
    expect(ledger.admit).toHaveBeenCalledWith(WORST, 1)
    expect(reservation).toEqual({ model: MODEL, worstCaseUsd: WORST, date: DATE })
    expect(spend.todayTotalUsd()).toBe(WORST)
    expect(spend.todayRequests()).toBe(1)
    if (reservation === undefined) {
      throw new Error('admitted without a reservation')
    }
    const usage = { inputTokens: 1000, cachedTokens: 500, outputTokens: 40 }
    // The usage arrives after midnight (RVM94LC finding 1).
    clock.now = new Date(2026, 9, 5, 0, 1).getTime()
    spend.settle(reservation, usage)
    await vi.waitFor(() => {
      // The admission's own day, whatever the clock says by then.
      expect(ledger.settle).toHaveBeenCalledWith(
        { date: DATE, worstCaseUsd: WORST },
        estimateCostUsd(usage, MODEL),
      )
    })
  })

  it('refuses at the budget: no reservation, the total shown, nothing counted', async () => {
    const onTotalChanged = vi.fn()
    const { typed } = fakeLedger({
      admitted: false,
      reason: 'budgetReached',
      detail: 'w.json',
      totalUsd: 0.99,
    })
    const spend = gate(typed, onTotalChanged)
    await expect(spend.reserve(FACTS)).resolves.toBeUndefined()
    expect(spend.todayTotalUsd()).toBe(0.99)
    expect(spend.todayRequests()).toBe(0)
    expect(onTotalChanged).toHaveBeenCalled()
  })

  it('refuses an unreadable ledger', async () => {
    const { typed } = fakeLedger({ admitted: false, reason: 'ledgerUnreadable', detail: 'w.json' })
    await expect(gate(typed).reserve(FACTS)).resolves.toBeUndefined()
  })

  it('reads today’s cross-window total at start for the status bar', async () => {
    const { typed } = fakeLedger(
      { admitted: true, totalUsd: 0, reservation: { date: DATE, worstCaseUsd: 0 } },
      { ok: true, totalUsd: 0.42 },
    )
    const spend = gate(typed)
    await vi.waitFor(() => {
      expect(spend.todayTotalUsd()).toBe(0.42)
    })
  })
})
