import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { createPaidDailyBudget } from '../../src/host/paid/paidDailyBudget'
import { createRuntimeDailyBudget } from '../../src/runtime/runtimeAccountingEntry'
import { PAID_DAILY_BUDGET } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'

it('carries earlier window spend and retained liability once into an already opened common day', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'schedule-legacy-budget-'))
  const now = new Date(2026, 9, 11, 12).getTime()
  const settings = {
    now: () => now,
    capUsd: () => Usd.from(1).toAmount(),
    sleep: () => Promise.resolve(),
    isModelApi: () => true,
  }
  const directory = path.join(root, 'common', PAID_DAILY_BUDGET.directory)
  const legacyDirectory = path.join(root, 'old-window')
  try {
    const legacy = createPaidDailyBudget({ ...settings, directory: legacyDirectory })
    const prior = await legacy.reserveExact(Usd.from('0.4').toAmount())
    await prior.settle(Usd.from('0.2').toAmount())
    await legacy.reserveExact(Usd.from('0.4').toAmount())
    const common = createPaidDailyBudget({ ...settings, directory })
    const earlier = await common.reserveExact(Usd.from('0.1').toAmount())
    await earlier.settle(Usd.from('0.1').toAmount())
    const first = createPaidDailyBudget({ ...settings, directory, legacyDirectory })
    const second = createPaidDailyBudget({ ...settings, directory, legacyDirectory })
    const initial = await first.readToday()
    expect(initial[0]?.budget.spentUsd).toBe('0.7')
    const repeated = await second.readToday()
    expect(repeated[0]?.budget.spentUsd).toBe('0.7')
    const migrated = await first.reserveExact(Usd.from('0.2').toAmount())
    await migrated.settle(Usd.from('0.2').toAmount())
    const after = await second.readToday()
    expect(after[0]?.budget.spentUsd).toBe('0.9')
    const agent = createRuntimeDailyBudget({
      dataFolder: path.join(root, 'common'),
      now: () => now,
      sleep: () => Promise.resolve(),
    })
    // The remaining tenth of a dollar is the same for the runtime family.
    const claim = await agent.reserve(Usd.from('0.1').toAmount(), new AbortController().signal)
    await claim.settle(Usd.from('0.1').toAmount())
    await expect(first.reserveExact(Usd.from('0.1').toAmount())).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
