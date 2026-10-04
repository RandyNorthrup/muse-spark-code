import { mkdtempSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createTabLedger, tabLocalDate, type TabLedgerDeps } from '../../src/host/tab/tabLedger'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

const root = mkdtempSync(path.join(tmpdir(), 'muse-tab-ledger-'))

afterAll(() => removeFolder(root))

/** Noon local time, safely inside one local day. */
const DAY_ONE = new Date(2026, 9, 4, 12, 0, 0).getTime()
const DAY_TWO = new Date(2026, 9, 5, 12, 0, 0).getTime()

function ledgerAt(
  directory: string,
  windowId: string,
  nowMs: number,
  nowRef?: { nowMs: number },
): { ledger: ReturnType<typeof createTabLedger>; log: FakeLogOutputChannel } {
  const log = new FakeLogOutputChannel()
  const deps: TabLedgerDeps = {
    directory,
    windowId,
    now: () => (nowRef === undefined ? nowMs : nowRef.nowMs),
    sleep: () => Promise.resolve(),
    log,
  }
  return { ledger: createTabLedger(deps), log }
}

function todayFile(directory: string, windowId: string, nowMs: number): string {
  return path.join(directory, tabLocalDate(nowMs), `${windowId}.json`)
}

describe('tabLocalDate (M94, PLAN.md D73)', () => {
  it('names the local calendar day', () => {
    expect(tabLocalDate(DAY_ONE)).toBe('2026-10-04')
    expect(tabLocalDate(DAY_TWO)).toBe('2026-10-05')
  })
})

describe('TabLedger admission and settlement (M94 lane L)', () => {
  it('refuses a window id that cannot name a file', () => {
    expect(() =>
      ledgerAt(path.join(root, 'ids'), '../escape', DAY_ONE),
    ).toThrow('cannot name a ledger file')
  })

  it('admits under the budget and counts the reservation in the total', async () => {
    const directory = path.join(root, 'admit')
    const { ledger } = ledgerAt(directory, 'window-a', DAY_ONE)
    const admitted = await ledger.admit(0.6, 1)
    expect(admitted).toEqual({ admitted: true, totalUsd: 0.6 })
    await expect(ledger.todayTotal()).resolves.toEqual({ ok: true, totalUsd: 0.6 })
  })

  it('blocks the request whose worst case would exceed the budget, and rolls back', async () => {
    const directory = path.join(root, 'block')
    const { ledger } = ledgerAt(directory, 'window-a', DAY_ONE)
    await expect(ledger.admit(0.6, 1)).resolves.toMatchObject({ admitted: true })
    const refused = await ledger.admit(0.6, 1)
    expect(refused).toMatchObject({ admitted: false, reason: 'budgetReached' })
    if (!refused.admitted) {
      expect(refused.totalUsd).toBeCloseTo(0.6)
    }
    // The refused reservation is rolled back: only the first counts.
    const total = await ledger.todayTotal()
    expect(total).toMatchObject({ ok: true })
    if (total.ok) {
      expect(total.totalUsd).toBeCloseTo(0.6)
    }
  })

  it('replaces the reservation with the reported usage on settlement', async () => {
    const directory = path.join(root, 'settle')
    const { ledger } = ledgerAt(directory, 'window-a', DAY_ONE)
    await ledger.admit(0.6, 1)
    await ledger.settle(0.6, 0.001)
    await expect(ledger.todayTotal()).resolves.toEqual({ ok: true, totalUsd: 0.001 })
  })

  it('keeps the whole reservation of a request that never reports usage', async () => {
    const directory = path.join(root, 'kept')
    const { ledger } = ledgerAt(directory, 'window-a', DAY_ONE)
    await ledger.admit(0.6, 1)
    await expect(ledger.todayTotal()).resolves.toEqual({ ok: true, totalUsd: 0.6 })
  })

  it('starts a new total on the next local day', async () => {
    const directory = path.join(root, 'day')
    const nowRef = { nowMs: DAY_ONE }
    const { ledger } = ledgerAt(directory, 'window-a', DAY_ONE, nowRef)
    await ledger.admit(0.6, 1)
    nowRef.nowMs = DAY_TWO
    await expect(ledger.todayTotal()).resolves.toEqual({ ok: true, totalUsd: 0 })
    await expect(ledger.admit(0.6, 1)).resolves.toMatchObject({ admitted: true, totalUsd: 0.6 })
  })

  it('two windows on one folder never pass the budget together', async () => {
    const directory = path.join(root, 'races')
    const first = ledgerAt(directory, 'window-a', DAY_ONE)
    const second = ledgerAt(directory, 'window-b', DAY_ONE)
    const [a, b] = await Promise.all([first.ledger.admit(0.6, 1), second.ledger.admit(0.6, 1)])
    const admitted = [a, b].filter((outcome) => outcome.admitted)
    // Whatever the interleave, at most one saw a total within budget.
    expect(admitted.length).toBeLessThanOrEqual(1)
    const total = await first.ledger.todayTotal()
    expect(total).toMatchObject({ ok: true })
    if (total.ok) {
      expect(total.totalUsd).toBeCloseTo(admitted.length * 0.6)
    }
  })

  it('two windows on one folder sum their spend without losing any', async () => {
    const directory = path.join(root, 'sum')
    const first = ledgerAt(directory, 'window-a', DAY_ONE)
    const second = ledgerAt(directory, 'window-b', DAY_ONE)
    await expect(first.ledger.admit(0.3, 1)).resolves.toMatchObject({ admitted: true })
    await expect(second.ledger.admit(0.3, 1)).resolves.toMatchObject({ admitted: true })
    const summed = await first.ledger.todayTotal()
    expect(summed).toMatchObject({ ok: true })
    if (summed.ok) {
      expect(summed.totalUsd).toBeCloseTo(0.6)
    }
    await first.ledger.settle(0.3, 0.002)
    await second.ledger.settle(0.3, 0.004)
    const settled = await second.ledger.todayTotal()
    expect(settled).toMatchObject({ ok: true })
    if (settled.ok) {
      expect(settled.totalUsd).toBeCloseTo(0.006)
    }
  })

  it('serialises one window\u2019s concurrent admissions, losing no reservation', async () => {
    const directory = path.join(root, 'same-window')
    const { ledger } = ledgerAt(directory, 'window-a', DAY_ONE)
    const outcomes = await Promise.all([
      ledger.admit(0.1, 10),
      ledger.admit(0.1, 10),
      ledger.admit(0.1, 10),
      ledger.admit(0.1, 10),
      ledger.admit(0.1, 10),
    ])
    expect(outcomes.every((outcome) => outcome.admitted)).toBe(true)
    const total = await ledger.todayTotal()
    expect(total).toMatchObject({ ok: true })
    if (total.ok) {
      expect(total.totalUsd).toBeCloseTo(0.5)
    }
  })

  it('refuses while another window\u2019s file is corrupt, never counting it as zero', async () => {
    const directory = path.join(root, 'corrupt')
    const first = ledgerAt(directory, 'window-a', DAY_ONE)
    await first.ledger.admit(0.1, 1)
    await writeFile(todayFile(directory, 'window-b', DAY_ONE), '{truncated', 'utf8')
    const refused = await first.ledger.admit(0.1, 1)
    expect(refused).toMatchObject({ admitted: false, reason: 'ledgerUnreadable' })
    await expect(first.ledger.todayTotal()).resolves.toMatchObject({ ok: false })
  })

  it('refuses a file whose window does not match its name', async () => {
    const directory = path.join(root, 'mismatch')
    const { ledger } = ledgerAt(directory, 'window-a', DAY_ONE)
    await ledger.admit(0.1, 1)
    const date = tabLocalDate(DAY_ONE)
    await writeFile(
      todayFile(directory, 'window-b', DAY_ONE),
      JSON.stringify({ date, window: 'window-c', reservedUsd: 0, reportedUsd: 0 }),
      'utf8',
    )
    await expect(ledger.todayTotal()).resolves.toMatchObject({ ok: false, detail: 'window-b.json' })
  })

  it('refuses on its own corrupt file without overwriting it', async () => {
    const directory = path.join(root, 'own-corrupt')
    const { ledger } = ledgerAt(directory, 'window-a', DAY_ONE)
    const file = todayFile(directory, 'window-a', DAY_ONE)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, 'not json', 'utf8')
    const refused = await ledger.admit(0.1, 1)
    expect(refused).toMatchObject({ admitted: false, reason: 'ledgerUnreadable' })
    await expect(readFile(file, 'utf8')).resolves.toBe('not json')
  })

  it('reads zero from a folder that does not exist yet', async () => {
    const { ledger } = ledgerAt(path.join(root, 'missing', 'deeper'), 'window-a', DAY_ONE)
    await expect(ledger.todayTotal()).resolves.toEqual({ ok: true, totalUsd: 0 })
  })

  it('never throws when the folder itself is unusable', async () => {
    const file = path.join(root, 'not-a-folder')
    await writeFile(file, 'spend', 'utf8')
    const { ledger, log } = ledgerAt(file, 'window-a', DAY_ONE)
    await expect(ledger.todayTotal()).resolves.toMatchObject({ ok: false })
    await expect(ledger.admit(0.1, 1)).resolves.toMatchObject({
      admitted: false,
      reason: 'ledgerUnreadable',
    })
    await expect(ledger.settle(0.1, 0.001)).resolves.toBeUndefined()
    expect(log.warn).toHaveBeenCalled()
  })

  it('refuses unusable amounts without throwing', async () => {
    const directory = path.join(root, 'amounts')
    const { ledger } = ledgerAt(directory, 'window-a', DAY_ONE)
    await expect(ledger.admit(Number.NaN, 1)).resolves.toMatchObject({
      admitted: false,
      reason: 'ledgerUnreadable',
    })
    await expect(ledger.admit(0.1, -1)).resolves.toMatchObject({ admitted: false })
    await expect(ledger.settle(Number.NaN, 0.001)).resolves.toBeUndefined()
    await expect(ledger.todayTotal()).resolves.toEqual({ ok: true, totalUsd: 0 })
  })
})
