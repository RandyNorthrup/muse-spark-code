// The agent's daily limit (PLAN.md D208) over its real settings file and data
// folder: with none set nothing is written and no spend record is read for a
// request; with one,
// a request whose estimate would pass what is left is refused in plain words,
// and only reported costs are counted, never an estimate.
// Every budget on one data folder reads the one shared cap from the
// settings file, and spend settled through one instance is enforced
// against the others.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createRuntimeDailyBudget } from '../../src/runtime/runtimeAccountingEntry'
import {
  DAILY_SPEND_FOLDER,
  PAID_DAILY_BUDGET,
  RUNTIME_SETTINGS_FILE,
  UI_TEXT,
} from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import { canonicalUsd } from '../../src/shared/usdSchema'
import { scheduleV2Schema } from '../../src/shared/scheduleV2'
import { onceScheduleRouting } from './helpers/scheduleRouting'
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

const noon = new Date(2026, 9, 11, 12).getTime()

function budget(dataFolder: string) {
  return createRuntimeDailyBudget({
    dataFolder,
    now: () => noon,
    sleep: () => Promise.resolve(),
  })
}

async function cappedFolder(capUsd = 1) {
  const root = await mkdtemp(path.join(tmpdir(), 'runtime-daily-budget-'))
  await writeFile(
    path.join(root, RUNTIME_SETTINGS_FILE),
    JSON.stringify({ paidDailyBudgetUsd: capUsd }),
  )
  return root
}

describe('runtime daily budget', () => {
  it('reads the shared cap from the data-folder settings file', async () => {
    const root = await cappedFolder()
    try {
      expect(budget(root).capUsd()).toBe('1')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reserveSchedule counts what was spent against the schedule own cap', async () => {
    const root = await cappedFolder(10)
    try {
      const daily = budget(root)
      const schedule = scheduleV2Schema.parse({
        version: 2,
        revision: 0,
        id: 'test-schedule',
        name: 'Test schedule',
        workspaceKey: 'test-workspace',
        action: { kind: 'prompt', prompt: 'Summarize the inbox' },
        ...onceScheduleRouting(noon, canonicalUsd('1')),
        paidConsent: {
          modelId: 'test-model',
          accountId: 'test-account',
          priceTier: 'test-tier',
          grantedAtMs: noon,
          dailyCapUsd: canonicalUsd('1'),
          sharedDailyBudgetUsd: canonicalUsd('10'),
          extras: [],
        },
        paidCapUsd: canonicalUsd('1'),
        parallel: false,
        creator: { kind: 'user' },
        depth: 0,
        allowAgentReschedule: false,
        pinned: false,
        zone: 'America/Los_Angeles',
        createdAtMs: noon,
        updatedAtMs: noon,
        fireCount: 0,
        consecutiveFailures: 0,
        paused: false,
      })
      const signal = new AbortController().signal
      const claim = await daily.reserve(Usd.from('0.6').toAmount(), signal)
      await claim?.settle(Usd.from('0.6').toAmount())
      // The estimate alone fits the schedule's own cap, but with what was
      // spent today it no longer does: the fire is refused, like live billing.
      await expect(
        daily.reserveSchedule(schedule, Usd.from('0.5').toAmount(), signal),
      ).rejects.toThrow(UI_TEXT.scheduleV2.messages.capReached)
      // What still fits is admitted.
      const fits = await daily.reserveSchedule(schedule, Usd.from('0.4').toAmount(), signal)
      expect(fits.estimateUsd).toBe('0.4')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('enforces spend settled through one instance against another on the same folder', async () => {
    const root = await cappedFolder()
    try {
      const first = budget(root)
      const second = budget(root)
      const claim = await first.reserve(Usd.from('0.6').toAmount(), new AbortController().signal)
      await claim?.settle(Usd.from('0.6').toAmount())
      await expect(
        second.reserve(Usd.from('0.5').toAmount(), new AbortController().signal),
      ).rejects.toThrow()
      const fits = await second.reserve(Usd.from('0.4').toAmount(), new AbortController().signal)
      await fits?.settle(Usd.from('0.4').toAmount())
      await expect(
        first.reserve(Usd.from('0.1').toAmount(), new AbortController().signal),
      ).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
