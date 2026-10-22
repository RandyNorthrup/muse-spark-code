// Hitting Tab's daily budget is never silent: the first refusal of each
// local day calls onBudgetReached with the spend and the budget, later
// refusals the same day do not. Real spend gate over its real ledger in a
// real temp folder; only the clock and sleep are controlled.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Usd, type UsdAmount } from '../../src/shared/usd'
import { createTabLedger } from '../../src/host/tab/tabLedger'
import { createTabSpendGate } from '../../src/host/tab/tabSpendGate'

const MODEL = 'muse-spark-1.3'

function gateIn(
  directory: string,
  now: () => number,
  calls: { spent: UsdAmount; budget: UsdAmount }[],
) {
  const ledger = createTabLedger({
    directory,
    windowId: 'test-window',
    now,
    sleep: () => Promise.resolve(),
    log: {
      trace: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  })
  return createTabSpendGate({
    ledger,
    budgetUsd: () => Usd.from(0.01).toAmount(),
    now,
    onTotalChanged: () => undefined,
    onBudgetReached: (spent, budget) => {
      calls.push({ spent, budget })
    },
    log: {
      trace: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  })
}

describe('the spend gate at the daily budget', () => {
  it('announces the first refusal of the day once', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'rllimits-tab-'))
    try {
      let now = Date.now()
      const calls: { spent: UsdAmount; budget: UsdAmount }[] = []
      const gate = gateIn(directory, () => now, calls)
      // A request far past the one-cent budget is refused, and said.
      const refused = await gate.reserve({
        model: MODEL,
        inputBytes: 10_000_000,
        maxOutputTokens: 4096,
      })
      expect(refused).toBeUndefined()
      expect(calls).toHaveLength(1)
      expect(Number(calls[0]?.budget)).toBeCloseTo(0.01, 10)
      // A second refusal the same day stays silent.
      const refusedAgain = await gate.reserve({
        model: MODEL,
        inputBytes: 10_000_000,
        maxOutputTokens: 4096,
      })
      expect(refusedAgain).toBeUndefined()
      expect(calls).toHaveLength(1)
      // The next local day announces again.
      now += 24 * 60 * 60 * 1000
      const refusedNext = await gate.reserve({
        model: MODEL,
        inputBytes: 10_000_000,
        maxOutputTokens: 4096,
      })
      expect(refusedNext).toBeUndefined()
      expect(calls).toHaveLength(2)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
