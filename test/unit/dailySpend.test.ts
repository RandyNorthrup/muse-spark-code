// The daily running total (PLAN.md D208) over real files and real processes:
// each process writes only its own file after a call, the day's total is the
// sum of every file, and nothing is written before a call ends.
import { fork } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDailySpend } from '../../src/host/paid/dailySpend'
import { isSpendLedgerError } from '../../src/core/paid/spendLedgerError'
import { withoutCredentials } from '../../src/runtime/credentialVariables'
import { DAILY_SPEND_FOLDER } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import { removeFolder } from './helpers/temporaryFolders'

const root = mkdtempSync(path.join(tmpdir(), 'daily-spend-'))
const PROCESSES = 3
const CALLS = 20
const UNKNOWN_CALLS = 2
const CALL_COST = '0.01'
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

beforeAll(async () => {
  await build({
    entryPoints: [path.join(process.cwd(), 'src/host/paid/dailySpend.ts')],
    outfile: path.join(root, 'dailySpend.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  // Each child is a real process of its own with its own running total.
  writeFileSync(
    path.join(root, 'child.cjs'),
    `const { createDailySpend } = require('./dailySpend.cjs')
const [directory, scope, calls, unknownCalls, cost] = process.argv.slice(2)
const spend = createDailySpend({ directory, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) })
Promise.all([
  ...Array.from({ length: Number(calls) }, () => spend.add(scope, cost)),
  ...Array.from({ length: Number(unknownCalls) }, () => spend.add(scope, undefined)),
]).then(() => process.exit(0), (error) => { console.error(error); process.exit(1) })
`,
  )
})
afterAll(async () => {
  await removeFolder(root)
})

/** One real process adds its calls to the day, all at once, then exits. */
function runProcess(directory: string, scope: string): Promise<number | null> {
  const child = fork(
    path.join(root, 'child.cjs'),
    [directory, scope, String(CALLS), String(UNKNOWN_CALLS), CALL_COST],
    { env: withoutCredentials(process.env), silent: true },
  )
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code) => {
      resolve(code)
    })
  })
}

describe('daily running total', () => {
  it('sums every process file, each written by its own process alone', async () => {
    const directory = path.join(root, 'processes')
    const scope = '2026-10-17'
    const codes = await Promise.all(
      Array.from({ length: PROCESSES }, () => runProcess(directory, scope)),
    )
    expect(codes).toEqual(Array.from({ length: PROCESSES }, () => 0))
    const total = createDailySpend({ directory, sleep }).read(scope)
    expect(total.spentUsd).toBe(
      Usd.from(CALL_COST)
        .times(PROCESSES * CALLS)
        .toAmount(),
    )
    expect(total.unknownChargeCalls).toBe(PROCESSES * UNKNOWN_CALLS)
    // One file per process, no lock, no journal and no staged leftovers.
    const names = readdirSync(path.join(directory, scope, DAILY_SPEND_FOLDER))
    expect(names).toHaveLength(PROCESSES)
    expect(names.every((name) => name.endsWith('.json'))).toBe(true)
    expect(readdirSync(path.join(directory, scope))).toEqual([DAILY_SPEND_FOLDER])
  })

  it('writes nothing for a call that cost nothing, and counts unknown cost apart', async () => {
    const directory = path.join(root, 'zero')
    const spend = createDailySpend({ directory, sleep })
    expect(await spend.add('2026-10-17', Usd.from(0).toAmount())).toEqual({
      spentUsd: '0',
      unknownChargeCalls: 0,
    })
    expect(existsSync(directory)).toBe(false)
    expect(await spend.add('2026-10-17', undefined)).toEqual({
      spentUsd: '0',
      unknownChargeCalls: 1,
    })
    expect(await spend.add('2026-10-17', Usd.from('0.25').toAmount())).toEqual({
      spentUsd: '0.25',
      unknownChargeCalls: 1,
    })
  })

  // The pre-D208 journal's records, transcribed field for field from the
  // writer this replaces (`src/host/backend/sessionBudgetJournal.ts` at
  // `b6ba93884^`): a v1 seed with a number total, a settled v1 claim and an
  // open one whose reservation the old total counted as spent.
  const legacyAccount = '0000000000000000000000000000000000000000000000000000000000000000'
  const legacyScope = '12121212-1212-1212-1212-121212121212'
  function seedLegacyDay(directory: string, scope: string, seed: unknown): void {
    const day = path.join(directory, 'budget-journal', legacyAccount, scope)
    mkdirSync(path.join(day, 'claims', 'c1'), { recursive: true })
    writeFileSync(path.join(day, 'seed.json'), JSON.stringify(seed))
    writeFileSync(
      path.join(day, 'claims', 'c1', 'claim.json'),
      JSON.stringify({
        version: 1,
        scopeId: legacyScope,
        claimId: 'c1',
        ownerId: 'o1',
        sessionId: scope,
        accountId: legacyAccount,
        reservedUsd: 0.5,
      }),
    )
    mkdirSync(path.join(day, 'claims', 'c2'), { recursive: true })
    writeFileSync(
      path.join(day, 'claims', 'c2', 'claim.json'),
      JSON.stringify({
        version: 1,
        scopeId: legacyScope,
        claimId: 'c2',
        ownerId: 'o1',
        sessionId: scope,
        accountId: legacyAccount,
        reservedUsd: 1.5,
        settledUsd: 1.25,
      }),
    )
  }

  const seedStandardDay = (directory: string, scope: string): void => {
    seedLegacyDay(directory, scope, {
      version: 1,
      scopeId: legacyScope,
      sessionId: scope,
      accountId: legacyAccount,
      spentUsd: 2.5,
      hasUnknownHistoricalFees: false,
    })
  }

  it('keeps the legacy current-day total instead of granting another allowance', async () => {
    const directory = path.join(root, 'legacy')
    const scope = '2026-10-18'
    seedStandardDay(directory, scope)
    // 2.5 settled before, 1.25 settled since, 0.5 still open: the first
    // request after upgrading sees 3.75, not zero — the open reservation is
    // held, never spend (D208), so it stays out of the migrated total.
    const spend = createDailySpend({ directory, sleep })
    expect(spend.read(scope)).toEqual({ spentUsd: '3.75', unknownChargeCalls: 0 })
    expect(await spend.add(scope, Usd.from('0.75').toAmount())).toEqual({
      spentUsd: '4.5',
      unknownChargeCalls: 0,
    })
  })

  it('counts a retained liability an open legacy claim kept', () => {
    const directory = path.join(root, 'legacy-retained')
    const scope = '2026-10-18'
    seedStandardDay(directory, scope)
    // Fees exceeded the reservation before final settlement: the claim
    // stayed open with the incurred liability retained, and the migrated
    // total counts it instead of dropping it.
    const day = path.join(directory, 'budget-journal', legacyAccount, scope)
    mkdirSync(path.join(day, 'claims', 'c3'), { recursive: true })
    writeFileSync(
      path.join(day, 'claims', 'c3', 'claim.json'),
      JSON.stringify({
        version: 1,
        scopeId: legacyScope,
        claimId: 'c3',
        ownerId: 'o1',
        sessionId: scope,
        accountId: legacyAccount,
        reservedUsd: 0.5,
        retainedUsd: 2,
      }),
    )
    // 2.5 settled before, 1.25 settled since, 2 retained; the open 0.5
    // stays out.
    const spend = createDailySpend({ directory, sleep })
    expect(spend.read(scope)).toEqual({ spentUsd: '5.75', unknownChargeCalls: 0 })
  })

  it('refuses a legacy claim detached from its journal', () => {
    const directory = path.join(root, 'legacy-misplaced')
    const scope = '2026-10-18'
    seedStandardDay(directory, scope)
    // A row filed under another claim's directory is damage, never spend.
    const day = path.join(directory, 'budget-journal', legacyAccount, scope)
    mkdirSync(path.join(day, 'claims', 'stray'), { recursive: true })
    writeFileSync(
      path.join(day, 'claims', 'stray', 'claim.json'),
      JSON.stringify({
        version: 1,
        scopeId: legacyScope,
        claimId: 'c2',
        ownerId: 'o1',
        sessionId: scope,
        accountId: legacyAccount,
        reservedUsd: 1.5,
        settledUsd: 1.25,
      }),
    )
    const spend = createDailySpend({ directory, sleep })
    let identityError: unknown
    try {
      spend.read(scope)
    } catch (error: unknown) {
      identityError = error
    }
    expect(isSpendLedgerError(identityError) && identityError.kind).toBe('damaged')
  })

  it('ignores a legacy journal of another day and refuses a damaged one', () => {
    const directory = path.join(root, 'legacy-other')
    seedLegacyDay(directory, '2026-10-19', {
      version: 1,
      scopeId: legacyScope,
      sessionId: '2026-10-19',
      accountId: legacyAccount,
      spentUsd: 9,
      hasUnknownHistoricalFees: false,
    })
    const spend = createDailySpend({ directory, sleep })
    expect(spend.read('2026-10-18')).toEqual({ spentUsd: '0', unknownChargeCalls: 0 })
    // A seed naming another scope is never mixed into this one's total.
    const day = path.join(directory, 'budget-journal', legacyAccount, '2026-10-18')
    mkdirSync(path.join(day, 'claims'), { recursive: true })
    writeFileSync(
      path.join(day, 'seed.json'),
      JSON.stringify({
        version: 1,
        scopeId: legacyScope,
        sessionId: '2026-10-19',
        accountId: legacyAccount,
        spentUsd: 9,
        hasUnknownHistoricalFees: false,
      }),
    )
    let identityError: unknown
    try {
      spend.read('2026-10-18')
    } catch (error: unknown) {
      identityError = error
    }
    expect(isSpendLedgerError(identityError) && identityError.kind).toBe('damaged')
  })

  it('refuses a scope that is not a day name and a negative amount', async () => {
    const spend = createDailySpend({ directory: path.join(root, 'refused'), sleep })
    let scopeError: unknown
    try {
      spend.read('../outside')
    } catch (error: unknown) {
      scopeError = error
    }
    expect(isSpendLedgerError(scopeError) && scopeError.kind).toBe('integrity')
    await expect(spend.add('2026-10-17', Usd.from('-1').toAmount())).rejects.toMatchObject({
      name: 'SpendLedgerError',
      kind: 'integrity',
    })
  })
})
