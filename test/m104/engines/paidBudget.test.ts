import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { malformedUsd } from '../../unit/helpers/malformedUsd'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimePaidBudget } from '../../../src/runtime/features/paidBudget'
import { PAID_DAILY_BUDGET, UI_TEXT } from '../../../src/shared/constants'
import * as atomic from '../../../src/host/fsAtomic'
import { Usd, usdToNanoUsd, nanoUsdToUsd, type UsdAmount } from '../../../src/shared/usd'

// 0.17 keeps money as exact decimal strings (CAPS017).
const usd = (value: number): UsdAmount => Usd.from(value).toAmount()

const roots: string[] = []
const budgets: ReturnType<typeof createRuntimePaidBudget>[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(budgets.splice(0).map((budget) => budget.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'm104-pb-paid-'))
  roots.push(directory)
  const state = {
    now: new Date(2026, 9, 6, 12).getTime(),
    cap: usd(0.5),
    isCurrent: true,
    isLocal: true,
  }
  const create = () => {
    const budget = createRuntimePaidBudget(
      {
        directory,
        now: () => state.now,
        capUsd: () => state.cap,
        sleep: () => Promise.resolve(),
        isLocalStorage: () => state.isLocal,
        assertCurrent: () => {
          if (!state.isCurrent) throw new Error('replaced')
        },
      },
      UI_TEXT,
      'en',
    )
    budgets.push(budget)
    return budget
  }
  const budget = create()
  await budget.latestDay()
  return { directory, state, create, budget }
}

describe('portable hard shared daily ledger', () => {
  it('returns exact remaining nano-USD after decimal subtraction', async () => {
    const { budget } = await setup()
    const claim = await budget.reserve(usd(0.4))
    await claim.settle(usd(0.4))
    expect(await budget.judgeLedger.remainingUsd()).toBe(usd(0.1))
  })

  it('admits an exact sub-nano remainder and rejects any amount beyond it without a tolerance', async () => {
    const { budget, state } = await setup()
    state.cap = usd(0.6000000001)
    const claim = await budget.reserve(usd(0.6))
    expect(claim.check(state.cap).spentUsd).toBe(usd(0.6))
    const remainder = await budget.reserve(usd(0.0000000001))
    expect(remainder.check(state.cap).spentUsd).toBe(usd(0.6000000001))
    await expect(budget.reserve(usd(0.0000000001))).rejects.toThrow()
    const total = await budget.latestDay()
    expect(total.spentUsd).toBe(usd(0.6000000001))
    expect(usdToNanoUsd(0.000000001)).toBe(1n)
    expect(usdToNanoUsd(0.0000000001)).toBe(1n)
    expect(usdToNanoUsd(0.0000000001, 'down')).toBe(0n)
    expect(nanoUsdToUsd(usdToNanoUsd(0.6))).toBe(0.6)
    expect(() => usdToNanoUsd(Infinity)).toThrow()
    expect(() => nanoUsdToUsd(-1n)).toThrow()
    expect(() => nanoUsdToUsd(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow()
  })

  it('admits an exactly affordable decimal total and rejects one nano-USD more', async () => {
    const { budget, state, create } = await setup()
    state.cap = usd(0.6)
    const first = await budget.reserve(usd(0.1))
    await first.settle(usd(0.1))
    const second = await budget.reserve(usd(0.2))
    await second.settle(usd(0.2))
    const subtotal = await budget.latestDay()
    expect(subtotal.spentUsd).toBe(usd(0.3))
    expect(await budget.judgeLedger.remainingUsd()).toBe(usd(0.3))
    const other = create()
    const exact = await other.reserve(usd(0.3))
    expect(exact.check(usd(0.6)).spentUsd).toBe(usd(0.6))
    expect(await budget.judgeLedger.remainingUsd()).toBe(usd(0))
    await expect(budget.reserve(usd(0.000000001))).rejects.toThrow()
    const total = await budget.latestDay()
    expect(total.spentUsd).toBe(usd(0.6))
  })

  it('keeps uncertain liability across owners and only releases the verified difference', async () => {
    const { budget, create } = await setup()
    const claim = await budget.reserve(usd(0.4))
    const other = create()
    expect(await other.latestDay()).toMatchObject({ spentUsd: usd(0.4), capUsd: usd(0.5) })
    await expect(other.reserve(usd(0.2))).rejects.toThrow()
    const total1 = await other.latestDay()
    expect(total1.spentUsd).toBe(usd(0.4))
    await claim.settle(usd(0.1))
    await claim.settle(usd(0.1))
    await expect(claim.settle(usd(0.2))).rejects.toThrow()
    const total2 = await other.latestDay()
    expect(total2.spentUsd).toBe(usd(0.1))
    await other.reserve(usd(0.3))
    const total3 = await budget.latestDay()
    expect(total3.spentUsd).toBe(usd(0.4))
  })

  it('admits concurrent owners only within the shared cap', async () => {
    const { budget, create } = await setup()
    const results = await Promise.allSettled([budget.reserve(usd(0.4)), create().reserve(usd(0.4))])
    const admitted = results.filter((result) => result.status === 'fulfilled')
    expect(admitted.length).toBeLessThan(2)
    const total4 = await budget.latestDay()
    expect(Number(total4.spentUsd)).toBeLessThanOrEqual(0.5)
    for (const result of admitted)
      expect(Number(result.value.check(usd(0.5)).spentUsd)).toBeLessThanOrEqual(0.5)
  })

  it('rechecks the current cap, cancellation and owner at final dispatch', async () => {
    const { budget, state } = await setup()
    const signal = new AbortController()
    const claim = await budget.reserve(usd(0.4), signal.signal)
    expect(claim.check(usd(0.5)).spentUsd).toBe(usd(0.4))
    state.cap = usd(1)
    const expensive = await budget.reserve(usd(0.6))
    state.cap = usd(0.5)
    expect(() => expensive.check(usd(0))).toThrow()
    await expensive.settle(usd(0))
    signal.abort()
    expect(() => claim.check(usd(0.5))).toThrow()
    const another = await budget.reserve(usd(0))
    state.isCurrent = false
    expect(() => another.check(usd(0.5))).toThrow('replaced')
    // A settled old claim remains accountable after a profile rebind.
    await claim.settle(usd(0.1))
  })

  it('refuses yesterday’s admission while settling usage to its original day', async () => {
    const { budget, state } = await setup()
    const { day } = await budget.latestDay()
    const claim = await budget.reserve(usd(0.4))
    state.now = new Date(2026, 9, 7, 12).getTime()
    expect(() => claim.check(usd(0.5))).toThrow(UI_TEXT.paidDailyStopped)
    await claim.settle(usd(0.2))
    const total5 = await budget.latestDay()
    expect(total5.spentUsd).toBe(usd(0))
    expect(await budget.lookupByClaimId(day, claim.claimId)).toMatchObject({
      reservedUsd: usd(0.4),
      settledUsd: usd(0.2),
    })
  })

  it('shares Stop across owners and a later numeric override cannot clear it', async () => {
    const { budget, create, directory } = await setup()
    const claim = await budget.reserve(usd(0.2))
    const { day } = await budget.latestDay()
    create().stop()
    await writeFile(
      path.join(directory, day, PAID_DAILY_BUDGET.overrideFile),
      JSON.stringify({ limitUsd: 1, stopped: false }),
    )
    await expect(budget.reserve(usd(0.1))).rejects.toThrow(UI_TEXT.paidDailyStopped)
    expect(() => claim.check(usd(1))).toThrow(UI_TEXT.paidDailyStopped)
    await claim.settle(usd(0.1))
  })

  it('refuses corrupt limits, unknown storage locality and unusable amounts', async () => {
    const { budget, directory, state } = await setup()
    await expect(budget.reserve(malformedUsd(NaN))).rejects.toThrow(
      UI_TEXT.paidDailyLedgerUnavailable,
    )
    state.isLocal = false
    await expect(budget.reserve(usd(0.1))).rejects.toThrow(UI_TEXT.paidDailyLedgerUnavailable)
    state.isLocal = true
    const { day } = await budget.latestDay()
    await mkdir(path.join(directory, day), { recursive: true })
    await writeFile(path.join(directory, day, PAID_DAILY_BUDGET.overrideFile), 'broken')
    await expect(budget.reserve(usd(0.1))).rejects.toThrow()
  })

  it.each(['0.49999999999999999', '500.00000000000000001'])(
    'refuses an exact stored limit outside the daily bounds: %s',
    async (limitUsd) => {
      const { budget, directory } = await setup()
      const { day } = await budget.latestDay()
      await mkdir(path.join(directory, day), { recursive: true })
      await writeFile(
        path.join(directory, day, PAID_DAILY_BUDGET.overrideFile),
        JSON.stringify({ limitUsd, stopped: false }),
      )
      expect(() => budget.capUsd()).toThrow()
      await expect(budget.reserve(usd(0.1))).rejects.toThrow()
    },
  )

  it('refunds an undispatched late acquisition and drains it before release', async () => {
    const { budget, create } = await setup()
    const held = Promise.withResolvers<undefined>()
    const reached = Promise.withResolvers<undefined>()
    const write = atomic.writeFileAtomically
    vi.spyOn(atomic, 'writeFileAtomically').mockImplementation(async (...args) => {
      reached.resolve(undefined)
      await held.promise
      await write(...args)
    })
    const reserving = budget.reserve(usd(0.4))
    await reached.promise
    const closing = budget.dispose()
    expect(budget.dispose()).toBe(closing)
    held.resolve(undefined)
    await expect(reserving).rejects.toThrow('MHP_PAID_LEDGER_CLOSED')
    await closing
    const total6 = await create().latestDay()
    expect(total6.spentUsd).toBe(usd(0))
  })
})
