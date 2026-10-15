import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTabLedger } from '../../src/host/tab/tabLedger'
import { Usd } from '../../src/shared/usd'
import { removeFolder } from './helpers/temporaryFolders'

// Lane LIMITSFIX, F3 (D113): Tab follows the one cap rule. A request is
// admitted while the real spend already settled today is below the budget,
// whatever its worst case would cost; at or over the budget it is refused with
// that spend; a request lost before its usage is unknown, never guessed. Real
// ledger files in a real temporary folder; the clock and the log are data.
const NOON = new Date(2026, 9, 14, 12, 0, 0).getTime()
const silent = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}
const usd = (amount: number) => Usd.from(amount).toAmount()

async function withLedgers(
  run: (open: (windowId: string) => ReturnType<typeof createTabLedger>) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'muse-f3-tab-'))
  try {
    await run((windowId) =>
      createTabLedger({
        directory,
        windowId,
        now: () => NOON,
        sleep: () => Promise.resolve(),
        log: silent,
      }),
    )
  } finally {
    await removeFolder(directory)
  }
}

describe('Tab daily ledger admission', () => {
  it('admits while real spend is below the budget, whatever a request could cost', async () => {
    await withLedgers(async (open) => {
      const ledger = open('window-a')
      const first = await ledger.admit(usd(1))
      expect(first.admitted).toBe(true)
      if (!first.admitted) return
      await ledger.settle(first.reservation, usd(0.99))
      // $0.01 below the $1 budget: the next request goes, even though a
      // completion's worst case is far larger than $0.01.
      const second = await ledger.admit(usd(1))
      expect(second.admitted).toBe(true)
    })
  })

  it('refuses at the budget, naming the real spend, and never says reached below it', async () => {
    await withLedgers(async (open) => {
      const ledger = open('window-a')
      const first = await ledger.admit(usd(1))
      if (!first.admitted) throw new Error('expected admission')
      await ledger.settle(first.reservation, usd(1))
      const refused = await ledger.admit(usd(1))
      expect(refused).toMatchObject({ admitted: false, reason: 'budgetReached' })
      expect(refused.admitted ? undefined : Number(refused.totalUsd)).toBeCloseTo(1)
    })
  })

  it('counts every window on the machine toward the same budget', async () => {
    await withLedgers(async (open) => {
      const a = open('window-a')
      const b = open('window-b')
      const spent = await a.admit(usd(1))
      if (!spent.admitted) throw new Error('expected admission')
      await a.settle(spent.reservation, usd(1))
      const refused = await b.admit(usd(1))
      expect(refused.admitted).toBe(false)
    })
  })

  it('keeps a request lost before its usage visible as unknown, not as an invented amount', async () => {
    await withLedgers(async (open) => {
      const ledger = open('window-a')
      const lost = await ledger.admit(usd(1))
      expect(lost.admitted).toBe(true)
      // It never settles: no dollars are made up for it.
      const total = await ledger.todayTotal()
      expect(total.ok && total.unreportedRequests).toBe(1)
      expect(total.ok && Number(total.totalUsd)).toBe(0)
      const next = await ledger.admit(usd(1))
      if (!next.admitted) throw new Error('expected admission')
      await ledger.settle(next.reservation, usd(0.25))
      const after = await ledger.todayTotal()
      expect(after.ok && after.unreportedRequests).toBe(1)
      expect(after.ok && Number(after.totalUsd)).toBeCloseTo(0.25)
    })
  })
})
