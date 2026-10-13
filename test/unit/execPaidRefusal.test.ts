import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, describe, expect, it } from 'vitest'
import { isPaidStop, isUserRefusal, UserRefusalError } from '../../src/core/refusal'
import { SpendLedgerError } from '../../src/core/paid/spendLedger'
import { createSessionBudgetJournal } from '../../src/host/backend/sessionBudgetJournal'
import { createRuntimeDailyBudget } from '../../src/runtime/runtimeAccountingEntry'
import { PAID_DAILY_BUDGET, UI_TEXT } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import { removeFolder } from './helpers/temporaryFolders'
const roots: string[] = []
const money = (value: number | string) => Usd.from(value).toAmount()
function root() {
  const value = mkdtempSync(path.join(tmpdir(), 'typed-budget-'))
  roots.push(value)
  return value
}
afterAll(async () => {
  for (const value of roots) await removeFolder(value)
})
describe('typed money refusals', () => {
  it.each(['busy', 'damaged', 'unreadable', 'recovery', 'integrity', 'legacy'] as const)(
    'keeps %s through lazy-bundle classifier without comparing its sentence',
    (kind) => {
      const error = new SpendLedgerError(kind, {
        scope: 'daily',
        file: 'state',
        errno: 'EACCES',
        total: money(1),
      })
      expect(isUserRefusal(error)).toBe(true)
      expect(isPaidStop(error)).toBe(false)
      const separateBundle = new SpendLedgerError(kind, error.facts)
      Object.defineProperty(separateBundle, 'message', {
        value: 'An independently translated sentence',
      })
      expect(isUserRefusal(separateBundle)).toBe(true)
    },
  )
  it('a remote error code cannot impersonate a typed daily stop', () => {
    expect(isPaidStop(Object.assign(new Error('remote'), { code: 'daily_stopped' }))).toBe(false)
    expect(isPaidStop(new UserRefusalError(UI_TEXT.paidDailyStopped, 'daily_stopped'))).toBe(true)
  })
  it('daily cap refusal keeps its own budget and amounts without writing a hold', async () => {
    const directory = root()
    const journal = createSessionBudgetJournal({
      directory,
      sleep: delay,
      dailyStop: { setting: 'paidDailyBudgetUsd', nowMs: () => 0 },
      initialBudget: () => Promise.resolve({ spentUsd: money(0), hasUnknownHistoricalFees: false }),
    })
    const account = PAID_DAILY_BUDGET.accountId
    const claim = await journal.reserve('day', account, money(1), money(1))
    const before = readFileSync(
      path.join(directory, 'spend-ledger-v3', account, 'day', 'state.json'),
      'utf8',
    )
    let refusal: unknown
    try {
      await journal.reserve('day', account, money(1), money(1))
    } catch (error: unknown) {
      refusal = error
    }
    expect(isPaidStop(refusal)).toBe(true)
    expect(refusal).toMatchObject({
      budget: 'daily',
      details: { limitUsd: '1', spentUsd: '0', heldUsd: '1', openClaims: 1 },
    })
    expect(
      readFileSync(path.join(directory, 'spend-ledger-v3', account, 'day', 'state.json'), 'utf8'),
    ).toBe(before)
    await claim.settle(money(0))
  })
  it('malformed settings are damaged data, never a reached cap or zero limit', async () => {
    const directory = root()
    writeFileSync(path.join(directory, 'settings.json'), '{')
    const daily = createRuntimeDailyBudget({ dataFolder: directory, now: () => 0, sleep: delay })
    await expect(daily.reserve(money(1), new AbortController().signal)).rejects.toMatchObject({
      kind: 'damaged',
      facts: { file: 'settings' },
    })
  })
  it('midnight keeps its own typed cause and releases an unsent claim', async () => {
    const directory = root()
    let now = new Date(2026, 9, 4, 23, 59).getTime()
    const daily = createRuntimeDailyBudget({ dataFolder: directory, now: () => now, sleep: delay })
    const claim = await daily.reserve(money(1), new AbortController().signal)
    now = new Date(2026, 9, 5, 0, 1).getTime()
    expect(() => claim.check(money(0))).toThrow(expect.objectContaining({ code: 'midnight' }))
    await claim.settle(money(0))
  })
  it('a damaged current snapshot names its file kind', async () => {
    const directory = root()
    const daily = createRuntimeDailyBudget({ dataFolder: directory, now: () => 0, sleep: delay })
    const claim = await daily.reserve(money(1), new AbortController().signal)
    const folder = path.join(
      directory,
      'paid-daily',
      'spend-ledger-v3',
      PAID_DAILY_BUDGET.accountId,
      [new Date(0).getFullYear(), new Date(0).getMonth() + 1, new Date(0).getDate()].join('-'),
    )
    mkdirSync(folder, { recursive: true })
    writeFileSync(path.join(folder, 'state.json'), '{')
    expect(() => claim.check(money(0))).toThrow(expect.objectContaining({ kind: 'damaged' }))
  })
})
