// The daily running total (PLAN.md D121) over real files and real processes:
// each process writes only its own file after a call, the day's total is the
// sum of every file, and nothing is written before a call ends.
import { fork } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
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
    expect(total.unknownCostCalls).toBe(PROCESSES * UNKNOWN_CALLS)
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
      unknownCostCalls: 0,
    })
    expect(existsSync(directory)).toBe(false)
    expect(await spend.add('2026-10-17', undefined)).toEqual({
      spentUsd: '0',
      unknownCostCalls: 1,
    })
    expect(await spend.add('2026-10-17', Usd.from('0.25').toAmount())).toEqual({
      spentUsd: '0.25',
      unknownCostCalls: 1,
    })
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
