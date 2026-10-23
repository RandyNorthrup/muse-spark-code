import { describe, expect, it } from 'vitest'
import { createTabLedger, type TabLedger } from '../../src/host/tab/tabLedger'
import { Usd } from '../../src/shared/usd'
import { collectingLogger } from './helpers/collectingLogger'
import { usingTempDir } from './helpers/temporaryFolders'

// M94 acceptance 10 (the daily budget across windows): two writers on one
// folder never pass the budget together, an open reservation survives a
// crash, and a new local day starts a new total. Real files in a real
// temp folder; only the clock is controlled.

function ledgerOf(directory: string, windowId: string, now: () => number): TabLedger {
  return createTabLedger({
    directory,
    windowId,
    now,
    sleep: () => Promise.resolve(),
    log: collectingLogger([]),
  })
}

describe('Tab ledger across windows and days', () => {
  it('never passes the budget with two writers, racing or in turn', async () => {
    await usingTempDir('muse-tab-ledger-race-', async (root) => {
      const now = Date.now()
      const budget = Usd.from(1).toAmount()
      const worst = Usd.from(0.6).toAmount()
      // In turn: the first writer admits, the second refuses.
      const first = ledgerOf(root, 'window1', () => now)
      const second = ledgerOf(root, 'window2', () => now)
      const admitted = await first.admit(worst, budget)
      expect(admitted.admitted).toBe(true)
      const refused = await second.admit(worst, budget)
      expect(refused.admitted).toBe(false)
      if (refused.admitted) throw new Error('the second writer passed the budget')
      expect(refused.reason).toBe('budgetReached')
    })
  })

  it('never passes the budget when two writers race', async () => {
    const now = Date.now()
    const budget = Usd.from(1).toAmount()
    const worst = Usd.from(0.6).toAmount()
    // Each round races two fresh admissions on a fresh folder.
    for (let round = 0; round < 10; round += 1) {
      await usingTempDir('muse-tab-ledger-race-', async (root) => {
        const left = ledgerOf(root, 'race-left', () => now)
        const right = ledgerOf(root, 'race-right', () => now)
        const [one, two] = await Promise.all([
          left.admit(worst, budget),
          right.admit(worst, budget),
        ])
        const passed = [one, two].filter((admission) => admission.admitted)
        // Both writers write before either checks, so at most one passes;
        // under contention both may refuse, never both pass.
        expect(passed.length).toBeLessThanOrEqual(1)
        const total = await left.todayTotal()
        expect(total.ok).toBe(true)
        if (!total.ok) throw new Error(total.detail)
        expect(Number(total.totalUsd)).toBeLessThanOrEqual(Number(budget))
      })
    }
  })

  it('keeps an open reservation across a restart, then settles it', async () => {
    await usingTempDir('muse-tab-ledger-crash-', async (root) => {
      const now = Date.now()
      const before = ledgerOf(root, 'crash-window', () => now)
      const admitted = await before.admit(Usd.from(0.4).toAmount(), Usd.from(10).toAmount())
      expect(admitted.admitted).toBe(true)
      if (!admitted.admitted) throw new Error('the request was refused')
      // The process dies with the reservation open; a new instance reads
      // the same file and sees the same worst case.
      const after = ledgerOf(root, 'crash-window', () => now)
      const kept = await after.todayTotal()
      expect(kept.ok).toBe(true)
      if (!kept.ok) throw new Error(kept.detail)
      expect(Number(kept.totalUsd)).toBeCloseTo(0.4, 10)
      // Another window sees it too: the total is cross-window.
      const other = ledgerOf(root, 'other-window', () => now)
      const shared = await other.todayTotal()
      expect(shared.ok).toBe(true)
      if (!shared.ok) throw new Error(shared.detail)
      expect(Number(shared.totalUsd)).toBeCloseTo(0.4, 10)
      // The usage lands late; the reported cost replaces the reservation.
      await after.settle(admitted.reservation, Usd.from(0.05).toAmount())
      const settled = await other.todayTotal()
      expect(settled.ok).toBe(true)
      if (!settled.ok) throw new Error(settled.detail)
      expect(Number(settled.totalUsd)).toBeCloseTo(0.05, 10)
    })
  })

  it('starts a new total on a new local day', async () => {
    await usingTempDir('muse-tab-ledger-day-', async (root) => {
      let now = new Date(2026, 9, 4, 23, 59).getTime()
      const ledger = ledgerOf(root, 'day-window', () => now)
      const budget = Usd.from(0.5).toAmount()
      const admitted = await ledger.admit(Usd.from(0.4).toAmount(), budget)
      expect(admitted.admitted).toBe(true)
      now = new Date(2026, 9, 5, 0, 1).getTime()
      const fresh = await ledger.todayTotal()
      expect(fresh.ok).toBe(true)
      if (!fresh.ok) throw new Error(fresh.detail)
      expect(Number(fresh.totalUsd)).toBe(0)
      // Yesterday's spend does not block today's admission.
      const next = await ledger.admit(Usd.from(0.4).toAmount(), budget)
      expect(next.admitted).toBe(true)
    })
  })
})
