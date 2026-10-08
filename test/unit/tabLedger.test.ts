import { Usd, type UsdAmount } from '../../src/shared/usd'
import { mkdtempSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createTabLedger,
  tabLocalDate,
  type TabAdmission,
  type TabLedgerDeps,
  type TabLedgerReservation,
} from '../../src/host/tab/tabLedger'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

const root = mkdtempSync(path.join(tmpdir(), 'muse-tab-ledger-'))

afterAll(() => removeFolder(root))

/** Noon local time, safely inside one local day. */
const DAY_ONE = new Date(2026, 9, 4, 12, 0, 0).getTime()
const DAY_TWO = new Date(2026, 9, 5, 12, 0, 0).getTime()
/** The last millisecond of day one and the first of day two. */
const DAY_ONE_LAST = new Date(2026, 9, 4, 23, 59, 59, 999).getTime()
const DAY_TWO_FIRST = new Date(2026, 9, 5, 0, 0, 0, 0).getTime()
const DATE_ONE = '2026-10-04'
const DATE_TWO = '2026-10-05'

it('reads retained Tab liability separately without changing admission files', async () => {
  const directory = path.join(root, 'usage-read')
  const { ledger } = ledgerAt(directory, 'writer', DAY_ONE)
  const claim = reservationOf(await ledger.admit(Usd.from(0.25).toAmount(), Usd.from(1).toAmount()))
  const file = path.join(directory, DATE_ONE, 'writer.json')
  const original = await readFile(file)
  expect(await ledger.todayUsage()).toEqual({
    ok: true,
    totalUsd: Usd.from(0.25).toAmount(),
    uncertainUsd: Usd.from(0.25).toAmount(),
  })
  expect(await readFile(file)).toEqual(original)
  await ledger.settle(claim, Usd.from(0.05).toAmount())
  expect(await ledger.todayUsage()).toEqual({
    ok: true,
    totalUsd: Usd.from(0.05).toAmount(),
    uncertainUsd: Usd.from(0).toAmount(),
  })
})

function ledgerWithClock(
  directory: string,
  windowId: string,
  now: () => number,
): { ledger: ReturnType<typeof createTabLedger>; log: FakeLogOutputChannel } {
  const log = new FakeLogOutputChannel()
  const deps: TabLedgerDeps = { directory, windowId, now, sleep: () => Promise.resolve(), log }
  return { ledger: createTabLedger(deps), log }
}

function ledgerAt(
  directory: string,
  windowId: string,
  nowMs: number,
  nowRef?: { nowMs: number },
): { ledger: ReturnType<typeof createTabLedger>; log: FakeLogOutputChannel } {
  return ledgerWithClock(directory, windowId, () => (nowRef === undefined ? nowMs : nowRef.nowMs))
}

/** The admitted request's reservation; fails the test on a refusal. */
function reservationOf(admission: TabAdmission): TabLedgerReservation {
  if (!admission.admitted) {
    throw new Error(`expected an admission, got ${admission.reason}`)
  }
  return admission.reservation
}

/** A day's total in dollars; fails the test on a refusal. */
async function totalOn(
  ledger: ReturnType<typeof createTabLedger>,
  date?: string,
): Promise<UsdAmount> {
  const total = await ledger.todayTotal(date)
  if (!total.ok) {
    throw new Error(`expected a total, got a refusal for ${total.detail}`)
  }
  return total.totalUsd
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
    expect(() => ledgerAt(path.join(root, 'ids'), '../escape', DAY_ONE)).toThrow(
      'cannot name a ledger file',
    )
  })

  it('admits under the budget and counts the reservation in the total', async () => {
    const directory = path.join(root, 'admit')
    const { ledger } = ledgerAt(directory, 'window-a', DAY_ONE)
    const admitted = await ledger.admit(Usd.from(0.6).toAmount(), Usd.from(1).toAmount())
    expect(admitted).toEqual({
      admitted: true,
      totalUsd: Usd.from(0.6).toAmount(),
      reservation: { date: DATE_ONE, worstCaseUsd: Usd.from(0.6).toAmount() },
    })
    await expect(ledger.todayTotal()).resolves.toEqual({
      ok: true,
      totalUsd: Usd.from(0.6).toAmount(),
    })
  })

  it('blocks the request whose worst case would exceed the budget, and rolls back', async () => {
    const directory = path.join(root, 'block')
    const { ledger } = ledgerAt(directory, 'window-a', DAY_ONE)
    await expect(
      ledger.admit(Usd.from(0.6).toAmount(), Usd.from(1).toAmount()),
    ).resolves.toMatchObject({ admitted: true })
    const refused = await ledger.admit(Usd.from(0.6).toAmount(), Usd.from(1).toAmount())
    expect(refused).toMatchObject({ admitted: false, reason: 'budgetReached' })
    if (!refused.admitted) {
      expect(Number(refused.totalUsd)).toBeCloseTo(0.6)
    }
    // The refused reservation is rolled back: only the first counts.
    const total = await ledger.todayTotal()
    expect(total).toMatchObject({ ok: true })
    if (total.ok) {
      expect(Number(total.totalUsd)).toBeCloseTo(0.6)
    }
  })

  it('replaces the reservation with the reported usage on settlement', async () => {
    const directory = path.join(root, 'settle')
    const { ledger } = ledgerAt(directory, 'window-a', DAY_ONE)
    const reservation = reservationOf(
      await ledger.admit(Usd.from(0.6).toAmount(), Usd.from(1).toAmount()),
    )
    await ledger.settle(reservation, Usd.from(0.001).toAmount())
    await expect(ledger.todayTotal()).resolves.toEqual({
      ok: true,
      totalUsd: Usd.from(0.001).toAmount(),
    })
  })

  it('keeps the whole reservation of a request that never reports usage', async () => {
    const directory = path.join(root, 'kept')
    const { ledger } = ledgerAt(directory, 'window-a', DAY_ONE)
    await ledger.admit(Usd.from(0.6).toAmount(), Usd.from(1).toAmount())
    await expect(ledger.todayTotal()).resolves.toEqual({
      ok: true,
      totalUsd: Usd.from(0.6).toAmount(),
    })
  })

  it('starts a new total on the next local day', async () => {
    const directory = path.join(root, 'day')
    const nowRef = { nowMs: DAY_ONE }
    const { ledger } = ledgerAt(directory, 'window-a', DAY_ONE, nowRef)
    await ledger.admit(Usd.from(0.6).toAmount(), Usd.from(1).toAmount())
    nowRef.nowMs = DAY_TWO
    await expect(ledger.todayTotal()).resolves.toEqual({
      ok: true,
      totalUsd: Usd.from(0).toAmount(),
    })
    await expect(
      ledger.admit(Usd.from(0.6).toAmount(), Usd.from(1).toAmount()),
    ).resolves.toMatchObject({ admitted: true, totalUsd: Usd.from(0.6).toAmount() })
  })

  it('two windows on one folder never pass the budget together', async () => {
    const directory = path.join(root, 'races')
    const first = ledgerAt(directory, 'window-a', DAY_ONE)
    const second = ledgerAt(directory, 'window-b', DAY_ONE)
    const [a, b] = await Promise.all([
      first.ledger.admit(Usd.from(0.6).toAmount(), Usd.from(1).toAmount()),
      second.ledger.admit(Usd.from(0.6).toAmount(), Usd.from(1).toAmount()),
    ])
    const admitted = [a, b].filter((outcome) => outcome.admitted)
    // Whatever the interleave, at most one saw a total within budget.
    expect(admitted.length).toBeLessThanOrEqual(1)
    const total = await first.ledger.todayTotal()
    expect(total).toMatchObject({ ok: true })
    if (total.ok) {
      expect(Number(total.totalUsd)).toBeCloseTo(admitted.length * 0.6)
    }
  })

  it('two windows on one folder sum their spend without losing any', async () => {
    const directory = path.join(root, 'sum')
    const first = ledgerAt(directory, 'window-a', DAY_ONE)
    const second = ledgerAt(directory, 'window-b', DAY_ONE)
    const firstReservation = reservationOf(
      await first.ledger.admit(Usd.from(0.3).toAmount(), Usd.from(1).toAmount()),
    )
    const secondReservation = reservationOf(
      await second.ledger.admit(Usd.from(0.3).toAmount(), Usd.from(1).toAmount()),
    )
    const summed = await first.ledger.todayTotal()
    expect(summed).toMatchObject({ ok: true })
    if (summed.ok) {
      expect(Number(summed.totalUsd)).toBeCloseTo(0.6)
    }
    await first.ledger.settle(firstReservation, Usd.from(0.002).toAmount())
    await second.ledger.settle(secondReservation, Usd.from(0.004).toAmount())
    const settled = await second.ledger.todayTotal()
    expect(settled).toMatchObject({ ok: true })
    if (settled.ok) {
      expect(Number(settled.totalUsd)).toBeCloseTo(0.006)
    }
  })

  it('serialises one window\u{2019}s concurrent admissions, losing no reservation', async () => {
    const directory = path.join(root, 'same-window')
    const { ledger } = ledgerAt(directory, 'window-a', DAY_ONE)
    const outcomes = await Promise.all([
      ledger.admit(Usd.from(0.1).toAmount(), Usd.from(10).toAmount()),
      ledger.admit(Usd.from(0.1).toAmount(), Usd.from(10).toAmount()),
      ledger.admit(Usd.from(0.1).toAmount(), Usd.from(10).toAmount()),
      ledger.admit(Usd.from(0.1).toAmount(), Usd.from(10).toAmount()),
      ledger.admit(Usd.from(0.1).toAmount(), Usd.from(10).toAmount()),
    ])
    expect(outcomes.every((outcome) => outcome.admitted)).toBe(true)
    const total = await ledger.todayTotal()
    expect(total).toMatchObject({ ok: true })
    if (total.ok) {
      expect(Number(total.totalUsd)).toBeCloseTo(0.5)
    }
  })

  it('refuses while another window\u{2019}s file is corrupt, never counting it as zero', async () => {
    const directory = path.join(root, 'corrupt')
    const first = ledgerAt(directory, 'window-a', DAY_ONE)
    await first.ledger.admit(Usd.from(0.1).toAmount(), Usd.from(1).toAmount())
    await writeFile(todayFile(directory, 'window-b', DAY_ONE), '{truncated', 'utf8')
    const refused = await first.ledger.admit(Usd.from(0.1).toAmount(), Usd.from(1).toAmount())
    expect(refused).toMatchObject({ admitted: false, reason: 'ledgerUnreadable' })
    await expect(first.ledger.todayTotal()).resolves.toMatchObject({ ok: false })
  })

  it('refuses a file whose window does not match its name', async () => {
    const directory = path.join(root, 'mismatch')
    const { ledger } = ledgerAt(directory, 'window-a', DAY_ONE)
    await ledger.admit(Usd.from(0.1).toAmount(), Usd.from(1).toAmount())
    const date = tabLocalDate(DAY_ONE)
    await writeFile(
      todayFile(directory, 'window-b', DAY_ONE),
      JSON.stringify({
        date,
        window: 'window-c',
        reservedUsd: Usd.from(0).toAmount(),
        reportedUsd: Usd.from(0).toAmount(),
      }),
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
    const refused = await ledger.admit(Usd.from(0.1).toAmount(), Usd.from(1).toAmount())
    expect(refused).toMatchObject({ admitted: false, reason: 'ledgerUnreadable' })
    await expect(readFile(file, 'utf8')).resolves.toBe('not json')
  })

  it('reads zero from a folder that does not exist yet', async () => {
    const { ledger } = ledgerAt(path.join(root, 'missing', 'deeper'), 'window-a', DAY_ONE)
    await expect(ledger.todayTotal()).resolves.toEqual({
      ok: true,
      totalUsd: Usd.from(0).toAmount(),
    })
  })

  it('never throws when the folder itself is unusable', async () => {
    const file = path.join(root, 'not-a-folder')
    await writeFile(file, 'spend', 'utf8')
    const { ledger, log } = ledgerAt(file, 'window-a', DAY_ONE)
    await expect(ledger.todayTotal()).resolves.toMatchObject({ ok: false })
    await expect(
      ledger.admit(Usd.from(0.1).toAmount(), Usd.from(1).toAmount()),
    ).resolves.toMatchObject({
      admitted: false,
      reason: 'ledgerUnreadable',
    })
    await expect(
      ledger.settle(
        { date: DATE_ONE, worstCaseUsd: Usd.from(0.1).toAmount() },
        Usd.from(0.001).toAmount(),
      ),
    ).resolves.toBeUndefined()
    expect(log.warn).toHaveBeenCalled()
  })

  it('refuses unusable amounts without throwing', async () => {
    const directory = path.join(root, 'amounts')
    const { ledger } = ledgerAt(directory, 'window-a', DAY_ONE)
    await expect(
      ledger.admit(Usd.from(-1).toAmount(), Usd.from(1).toAmount()),
    ).resolves.toMatchObject({
      admitted: false,
      reason: 'ledgerUnreadable',
    })
    await expect(
      ledger.admit(Usd.from(0.1).toAmount(), Usd.from(-1).toAmount()),
    ).resolves.toMatchObject({ admitted: false })
    await expect(
      ledger.settle(
        { date: DATE_ONE, worstCaseUsd: Usd.from(-1).toAmount() },
        Usd.from(0.001).toAmount(),
      ),
    ).resolves.toBeUndefined()
    await expect(ledger.todayTotal()).resolves.toEqual({
      ok: true,
      totalUsd: Usd.from(0).toAmount(),
    })
  })

  it('never lets a reservation or a total name a folder that is not a day', async () => {
    const directory = path.join(root, 'bad-day')
    const { ledger, log } = ledgerAt(directory, 'window-a', DAY_ONE)
    const reservation = reservationOf(
      await ledger.admit(Usd.from(0.1).toAmount(), Usd.from(1).toAmount()),
    )
    await expect(
      ledger.settle(
        { date: '../escape', worstCaseUsd: Usd.from(0.1).toAmount() },
        Usd.from(0.001).toAmount(),
      ),
    ).resolves.toBeUndefined()
    expect(log.warn).toHaveBeenCalled()
    await expect(ledger.todayTotal('../escape')).resolves.toEqual({
      ok: false,
      detail: '../escape',
    })
    // The reservation is kept: spend is over-counted, never lost.
    expect(Number(await totalOn(ledger, reservation.date))).toBeCloseTo(0.1)
  })
})

describe('TabLedger reservations keep their day (M94, RVM94LC finding 1)', () => {
  it('settles yesterday’s request into yesterday, so today’s reservation still counts', async () => {
    // The review's hard-budget case: $0.05 a day, $0.03 worst cases.
    const directory = path.join(root, 'cross-day-budget')
    const nowRef = { nowMs: DAY_ONE }
    const { ledger } = ledgerAt(directory, 'window-a', DAY_ONE, nowRef)
    const yesterday = reservationOf(
      await ledger.admit(Usd.from(0.03).toAmount(), Usd.from(0.05).toAmount()),
    )
    nowRef.nowMs = DAY_TWO
    const today = reservationOf(
      await ledger.admit(Usd.from(0.03).toAmount(), Usd.from(0.05).toAmount()),
    )
    expect(yesterday.date).toBe(DATE_ONE)
    expect(today.date).toBe(DATE_TWO)
    await ledger.settle(yesterday, Usd.from(0.001).toAmount())
    // Today's outstanding $0.03 stays, so a second $0.03 request is refused.
    expect(Number(await totalOn(ledger))).toBeCloseTo(0.03)
    const refused = await ledger.admit(Usd.from(0.03).toAmount(), Usd.from(0.05).toAmount())
    expect(refused).toMatchObject({ admitted: false, reason: 'budgetReached' })
    // Yesterday is reconciled: its reservation replaced by the reported usage.
    expect(Number(await totalOn(ledger, DATE_ONE))).toBeCloseTo(0.001)
  })

  it('reads the clock once per admission, so midnight cannot split its write from its check', async () => {
    const directory = path.join(root, 'midnight-admit')
    const clock = { nowMs: DAY_ONE, midnightAfterNextRead: false }
    const { ledger } = ledgerWithClock(directory, 'window-a', () => {
      const value = clock.nowMs
      if (clock.midnightAfterNextRead) {
        // Midnight falls just after this read: every later read is day two.
        clock.nowMs = DAY_TWO_FIRST
        clock.midnightAfterNextRead = false
      }
      return value
    })
    reservationOf(await ledger.admit(Usd.from(0.04).toAmount(), Usd.from(0.05).toAmount()))
    clock.nowMs = DAY_ONE_LAST
    clock.midnightAfterNextRead = true
    const spanning = await ledger.admit(Usd.from(0.03).toAmount(), Usd.from(0.05).toAmount())
    // Checked against day one's total, the day its reservation went to.
    expect(spanning).toMatchObject({ admitted: false, reason: 'budgetReached' })
    // Rolled back on day one; day two was never touched.
    expect(Number(await totalOn(ledger, DATE_ONE))).toBeCloseTo(0.04)
    await expect(ledger.todayTotal(DATE_TWO)).resolves.toEqual({
      ok: true,
      totalUsd: Usd.from(0).toAmount(),
    })
  })

  it('settles after midnight into the day that holds the reservation', async () => {
    const directory = path.join(root, 'settle-after-midnight')
    const nowRef = { nowMs: DAY_ONE }
    const { ledger } = ledgerAt(directory, 'window-a', DAY_ONE, nowRef)
    const reservation = reservationOf(
      await ledger.admit(Usd.from(0.6).toAmount(), Usd.from(1).toAmount()),
    )
    nowRef.nowMs = DAY_TWO
    await ledger.settle(reservation, Usd.from(0.001).toAmount())
    await expect(ledger.todayTotal(DATE_ONE)).resolves.toEqual({
      ok: true,
      totalUsd: Usd.from(0.001).toAmount(),
    })
    await expect(ledger.todayTotal()).resolves.toEqual({
      ok: true,
      totalUsd: Usd.from(0).toAmount(),
    })
  })
})
