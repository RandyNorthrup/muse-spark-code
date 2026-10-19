// The agent's daily limit (PLAN.md D121) over its real settings file and data
// folder: with none set nothing is written and no spend record is read for a
// request; with one,
// a request whose estimate would pass what is left is refused in plain words,
// and only reported costs are counted, never an estimate.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createRuntimeDailyBudget } from '../../src/runtime/runtimeAccountingEntry'
import {
  DAILY_SPEND_FOLDER,
  PAID_DAILY_BUDGET,
  RUNTIME_SETTINGS_FILE,
} from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import { removeFolder } from './helpers/temporaryFolders'

const root = mkdtempSync(path.join(tmpdir(), 'runtime-daily-'))
afterAll(async () => {
  await removeFolder(root)
})
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

function dataFolder(name: string, settings?: string): string {
  const folder = path.join(root, name)
  mkdirSync(folder)
  if (settings !== undefined) writeFileSync(path.join(folder, RUNTIME_SETTINGS_FILE), settings)
  return folder
}

function today(): string {
  const date = new Date()
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-')
}

/** A refusal over the daily limit says so in the stop sentence. */
function expectStopped(refusal: unknown): void {
  expect(refusal).toBeInstanceOf(Error)
  expect(refusal).toMatchObject({ name: 'SessionBudgetExceededError' })
  expect(refusal instanceof Error ? refusal.message : '').toMatch(
    /^Stopped: the next request \(about \$0\.60\) would pass the daily budget of \$1\.00 \(\$0\.50 used today\)\. It was not sent\. The budget resets .+; raise paidDailyBudgetUsd to continue\.$/u,
  )
}

function spentFile(folder: string): unknown {
  const directory = path.join(folder, PAID_DAILY_BUDGET.directory, today(), DAILY_SPEND_FOLDER)
  const [name] = readdirSync(directory)
  if (name === undefined) throw new Error('no running total was written')
  return JSON.parse(readFileSync(path.join(directory, name), 'utf8'))
}

describe('the agent daily limit', () => {
  it('with no limit set, writes nothing and holds nothing for a request', () => {
    const folder = dataFolder('none')
    const daily = createRuntimeDailyBudget({ dataFolder: folder, now: Date.now, sleep })
    expect(daily.capUsd()).toBe('0')
    expect(daily.admit(Usd.from(5).toAmount(), new AbortController().signal)).toBeUndefined()
    expect(readdirSync(folder)).toEqual([])
  })

  it('with no limit set, never reads the spend records', () => {
    const folder = dataFolder('unread')
    const records = path.join(folder, PAID_DAILY_BUDGET.directory, today(), DAILY_SPEND_FOLDER)
    mkdirSync(records, { recursive: true })
    writeFileSync(path.join(records, 'damaged.json'), '{')
    const daily = createRuntimeDailyBudget({ dataFolder: folder, now: Date.now, sleep })
    // A damaged record refuses any read of the day's total; no limit reads none.
    expect(daily.admit(Usd.from(5).toAmount(), new AbortController().signal)).toBeUndefined()
    writeFileSync(path.join(folder, RUNTIME_SETTINGS_FILE), '{"paidDailyBudgetUsd":10}')
    expect(() => daily.admit(Usd.from(5).toAmount(), new AbortController().signal)).toThrow(
      expect.objectContaining({ name: 'SpendLedgerError', kind: 'damaged' }),
    )
  })

  it('a limit of zero in the settings file is no limit', () => {
    const folder = dataFolder('zero', '{"paidDailyBudgetUsd":0}')
    const daily = createRuntimeDailyBudget({ dataFolder: folder, now: Date.now, sleep })
    expect(daily.admit(Usd.from(5).toAmount(), new AbortController().signal)).toBeUndefined()
    expect(readdirSync(folder)).toEqual([RUNTIME_SETTINGS_FILE])
  })

  it('stops a request whose estimate would pass the limit, saying so', async () => {
    const folder = dataFolder('limit', '{"paidDailyBudgetUsd":1}')
    const daily = createRuntimeDailyBudget({ dataFolder: folder, now: Date.now, sleep })
    const signal = new AbortController().signal
    const first = daily.admit(Usd.from('0.6').toAmount(), signal)
    expect(first).toBeDefined()
    // Admission holds nothing: no file exists until the call ends.
    expect(readdirSync(folder)).toEqual([RUNTIME_SETTINGS_FILE])
    await first?.settle(Usd.from('0.5').toAmount())
    let refusal: unknown
    try {
      daily.admit(Usd.from('0.6').toAmount(), signal)
    } catch (error: unknown) {
      refusal = error
    }
    expectStopped(refusal)
    // What still fits is admitted.
    expect(daily.admit(Usd.from('0.5').toAmount(), signal)).toBeDefined()
  })

  it('counts a call that reported no usage as cost unknown, never its estimate', async () => {
    const folder = dataFolder('unknown', '{"paidDailyBudgetUsd":1}')
    const daily = createRuntimeDailyBudget({ dataFolder: folder, now: Date.now, sleep })
    const signal = new AbortController().signal
    const claim = daily.admit(Usd.from('0.9').toAmount(), signal)
    await claim?.settle(undefined)
    expect(spentFile(folder)).toEqual({ spentUsd: '0', unknownChargeCalls: 1 })
    // The estimate was never counted, so the same request still fits.
    expect(daily.admit(Usd.from('0.9').toAmount(), signal)).toBeDefined()
  })

  it('counts a settled call once', async () => {
    const folder = dataFolder('once', '{"paidDailyBudgetUsd":1}')
    const daily = createRuntimeDailyBudget({ dataFolder: folder, now: Date.now, sleep })
    const claim = daily.admit(Usd.from('0.4').toAmount(), new AbortController().signal)
    await claim?.settle(Usd.from('0.3').toAmount())
    await claim?.settle(Usd.from('0.3').toAmount())
    expect(spentFile(folder)).toEqual({ spentUsd: '0.3', unknownChargeCalls: 0 })
  })

  it('a settlement the disk refuses stays a rejection, never a silent success', async () => {
    const folder = dataFolder('unwritable', '{"paidDailyBudgetUsd":1}')
    const daily = createRuntimeDailyBudget({ dataFolder: folder, now: Date.now, sleep })
    const claim = daily.admit(Usd.from('0.4').toAmount(), new AbortController().signal)
    // A file where the day's folder belongs makes the running-total write
    // fail on every platform, so the settlement must reject.
    mkdirSync(path.join(folder, PAID_DAILY_BUDGET.directory, today()), { recursive: true })
    writeFileSync(
      path.join(folder, PAID_DAILY_BUDGET.directory, today(), DAILY_SPEND_FOLDER),
      'blocked',
    )
    await expect(claim?.settle(Usd.from('0.3').toAmount())).rejects.toMatchObject({
      name: 'SpendLedgerError',
    })
  })

  it('with no limit set, reserve admits nothing and writes nothing', async () => {
    const folder = dataFolder('reserve-none')
    const daily = createRuntimeDailyBudget({ dataFolder: folder, now: Date.now, sleep })
    expect(
      await daily.reserve(Usd.from(5).toAmount(), new AbortController().signal),
    ).toBeUndefined()
    expect(readdirSync(folder)).toEqual([])
  })

  it('reserve admits an exact cost and refuses what no longer fits', async () => {
    const folder = dataFolder('reserve', '{"paidDailyBudgetUsd":1}')
    const daily = createRuntimeDailyBudget({ dataFolder: folder, now: Date.now, sleep })
    const signal = new AbortController().signal
    const claim = await daily.reserve(Usd.from('0.6').toAmount(), signal)
    expect(claim?.estimateUsd).toBe('0.6')
    claim?.check()
    await claim?.settle(Usd.from('0.5').toAmount())
    let refusal: unknown
    try {
      await daily.reserve(Usd.from('0.6').toAmount(), signal)
    } catch (error: unknown) {
      refusal = error
    }
    expectStopped(refusal)
  })

  it('reserve counts an unknown receipt without consuming the estimate', async () => {
    const folder = dataFolder('reserve-unknown', '{"paidDailyBudgetUsd":1}')
    const daily = createRuntimeDailyBudget({ dataFolder: folder, now: Date.now, sleep })
    const signal = new AbortController().signal
    const claim = await daily.reserve(Usd.from('0.9').toAmount(), signal)
    await claim?.settle(undefined)
    expect(spentFile(folder)).toEqual({ spentUsd: '0', unknownChargeCalls: 1 })
    // The estimate was never counted, so the same exact cost still fits.
    expect(await daily.reserve(Usd.from('0.9').toAmount(), signal)).toBeDefined()
  })

  it('readToday reads nothing without a limit and the row with one', async () => {
    const bare = dataFolder('today-none')
    const noCap = createRuntimeDailyBudget({ dataFolder: bare, now: Date.now, sleep })
    expect(await noCap.readToday()).toEqual([])
    const folder = dataFolder('today', '{"paidDailyBudgetUsd":1}')
    const daily = createRuntimeDailyBudget({ dataFolder: folder, now: Date.now, sleep })
    const claim = await daily.reserve(Usd.from('0.4').toAmount(), new AbortController().signal)
    await claim?.settle(Usd.from('0.3').toAmount())
    const rows = await daily.readToday()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.budget).toMatchObject({
      id: today(),
      kind: 'paidDaily',
      spentUsd: '0.3',
      capUsd: '1',
      stopped: false,
      raisedToday: false,
    })
    expect(typeof rows[0]?.budget.resetsAt).toBe('number')
  })
})
