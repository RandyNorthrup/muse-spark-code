// EXECPROVR3 D1/D2/P3-2: a paid refusal carries its numbers, never a generic
// sentence; an open claim never outlives its owner process. Each test fails
// without its fix: the journal threw a numbers-free sentence, kept dead holds,
// or the rotation refusal was not a recognised refusal.

import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  PaidBudgetStopError,
  SessionBudgetExceededError,
} from '../../src/core/backends/modelapi/sessionBudget'
import { isPaidStop, isUserRefusal } from '../../src/core/refusal'
import { isPaidStop as isPaidStopOnTransport } from '../../src/host/backend/configuredProvidersEntry'
import { createSessionBudgetJournal } from '../../src/host/backend/sessionBudgetJournal'
import { DAILY_BUDGET_OWNERLESS_MAX_AGE_MS, UI_TEXT } from '../../src/shared/constants'
import { formatUsd } from '../../src/shared/l10n/exactUsd'
import { plural } from '../../src/shared/l10n/text'
import { Usd, type UsdAmount } from '../../src/shared/usd'
import { removeFolder } from './helpers/temporaryFolders'

const SESSION = 'paid-stop-1'
const ACCOUNT = 'c'.repeat(64)
const folders: string[] = []
const children: ChildProcess[] = []

afterAll(async () => {
  for (const child of children) {
    try {
      child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }
  await Promise.all(folders.map((folder) => removeFolder(folder)))
})

function journalAt(
  options: {
    spent?: number
    setting?: string
    onOwnerlessClosed?: (closed: { readonly count: number; readonly totalUsd: UsdAmount }) => void
    sleep?: (ms: number) => Promise<void>
  } = {},
) {
  const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-paid-stop-')))
  folders.push(directory)
  const journal = createSessionBudgetJournal({
    directory,
    sleep: options.sleep ?? (() => Promise.resolve()),
    recoverUnsent: true,
    ...(options.setting !== undefined && {
      dailyStop: { setting: options.setting, nowMs: () => new Date(2026, 9, 11, 12).getTime() },
    }),
    ...(options.onOwnerlessClosed !== undefined && {
      onOwnerlessClosed: options.onOwnerlessClosed,
    }),
    initialBudget: () =>
      Promise.resolve({
        spentUsd: Usd.from(options.spent ?? 0).toAmount(),
        hasUnknownHistoricalFees: false,
      }),
  })
  return { directory, journal }
}

/** A parked helper that never sleeps: its pid is observable while it lives. */
function parked(): ChildProcess {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
    stdio: 'ignore',
  })
  children.push(child)
  return child
}

function exited(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve()
    else {
      child.once('exit', () => {
        resolve()
      })
    }
  })
}

async function catchReserve(reserve: Promise<unknown>): Promise<unknown> {
  try {
    await reserve
  } catch (error: unknown) {
    return error
  }
  return undefined
}

function plantClaim(
  directory: string,
  seed: { scopeId: string },
  options: { ownerPid: number; ownerStartMs?: number; sent: boolean; reserved?: string },
): string {
  const claimId = randomUUID()
  const claims = path.join(directory, 'budget-journal', ACCOUNT, SESSION, 'claims', claimId)
  mkdirSync(claims, { recursive: true })
  if (options.sent) mkdirSync(path.join(claims, 'send-intent'), { recursive: true })
  const claim: Record<string, unknown> = {
    version: 2,
    scopeId: seed.scopeId,
    claimId,
    ownerId: randomUUID(),
    ownerPid: options.ownerPid,
    sessionId: SESSION,
    accountId: ACCOUNT,
    reservedUsd: options.reserved ?? '4.5',
  }
  if (options.ownerStartMs !== undefined) claim['ownerStartMs'] = options.ownerStartMs
  writeFileSync(path.join(claims, 'claim.json'), JSON.stringify(claim))
  return claimId
}

/**
 * A 0.17-style hold: no ownerPid, no ownerStartMs, so only its age can judge
 * it. `ageMs` backdates the claim file and its directory (the journal reads
 * the file's modification time when the journal recorded none).
 */
function plantOwnerlessClaim(
  directory: string,
  seed: { scopeId: string },
  options: { reserved?: string; ageMs?: number } = {},
): string {
  const claimId = randomUUID()
  const claims = path.join(directory, 'budget-journal', ACCOUNT, SESSION, 'claims', claimId)
  mkdirSync(claims, { recursive: true })
  const file = path.join(claims, 'claim.json')
  writeFileSync(
    file,
    JSON.stringify({
      version: 2,
      scopeId: seed.scopeId,
      claimId,
      ownerId: randomUUID(),
      sessionId: SESSION,
      accountId: ACCOUNT,
      reservedUsd: options.reserved ?? '4.524288',
    }),
  )
  if (options.ageMs !== undefined) {
    const at = new Date(Date.now() - options.ageMs)
    utimesSync(file, at, at)
    utimesSync(claims, at, at)
  }
  return claimId
}

function readPlanted(directory: string, claimId: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      path.join(directory, 'budget-journal', ACCOUNT, SESSION, 'claims', claimId, 'claim.json'),
      'utf8',
    ),
  ) as Record<string, unknown>
}

function seedOf(directory: string): { scopeId: string } {
  return JSON.parse(
    readFileSync(path.join(directory, 'budget-journal', ACCOUNT, SESSION, 'seed.json'), 'utf8'),
  ) as { scopeId: string }
}

describe('a daily paid refusal tells the truth (D1)', () => {
  it('refuses over cap with the limit, spent, held, open count, reset and setting', async () => {
    const { journal } = journalAt({ spent: 50, setting: 'paidDailyBudgetUsd' })
    const open = await journal.reserveAdmitted(
      SESSION,
      ACCOUNT,
      Usd.from(30).toAmount(),
      Usd.from(100).toAmount(),
    )
    const caught = await catchReserve(
      journal.reserveAdmitted(SESSION, ACCOUNT, Usd.from(60).toAmount(), Usd.from(100).toAmount()),
    )
    await open.settle(Usd.from(0).toAmount())
    if (!(caught instanceof PaidBudgetStopError)) throw new Error('must refuse with numbers')
    const error = caught
    // The name stays the budget name every name-based catch recognises.
    expect(error.name).toBe('SessionBudgetExceededError')
    expect(isPaidStop(error)).toBe(true)
    // The typed stop carries validated numbers; anything else has none.
    const details = error.details
    expect(details).toMatchObject({
      limitUsd: '100',
      spentUsd: '50',
      heldUsd: '30',
      openClaims: 1,
      setting: 'paidDailyBudgetUsd',
    })
    expect(details.resetsAtMs).toBe(new Date(2026, 9, 12).getTime())
    // The refused claim's own reservation is not counted as spent or held.
    expect(error.message).toContain('100')
    expect(error.message).toContain('paidDailyBudgetUsd')
  })

  it('keeps the numbers-free sentence where no daily narrative exists', async () => {
    const { journal } = journalAt({ spent: 60 })
    const caught = await catchReserve(
      journal.reserveAdmitted(SESSION, ACCOUNT, Usd.from(60).toAmount(), Usd.from(100).toAmount()),
    )
    expect(caught).toBeInstanceOf(Error)
    expect(isPaidStop(caught)).toBe(true)
    // A session scope has no daily numbers: the plain sentence stays.
    expect(caught).not.toBeInstanceOf(PaidBudgetStopError)
  })

  it('describes the stop after recovering a dead process hold', async () => {
    const { journal, directory } = journalAt({ spent: 90, setting: 'paidDailyBudgetUsd' })
    // Open the scope, then park a dead owner's hold beside it.
    const live = await journal.reserveAdmitted(
      SESSION,
      ACCOUNT,
      Usd.from(5).toAmount(),
      Usd.from(100).toAmount(),
    )
    const dead = parked()
    const deadPid = dead.pid ?? 0
    expect(deadPid).toBeGreaterThan(0)
    plantClaim(directory, seedOf(directory), { ownerPid: deadPid, sent: false })
    dead.kill('SIGKILL')
    await exited(dead)
    const stop = await journal.describeStop(SESSION, ACCOUNT, Usd.from(100).toAmount())
    // The dead 4.5 hold was released before the numbers were read: the
    // settled 90 stays spent, the live 5 stays held.
    expect(stop.details.spentUsd).toBe('90')
    expect(stop.details.heldUsd).toBe('5')
    expect(stop.details.openClaims).toBe(1)
    await live.settle(Usd.from(0).toAmount())
  })

  it('recognises a paid stop through the transport import the provider wrappers read', () => {
    const stop = new PaidBudgetStopError('stopped', {
      limitUsd: Usd.from(100).toAmount(),
      spentUsd: Usd.from(90).toAmount(),
      heldUsd: Usd.from(0).toAmount(),
      openClaims: 0,
      resetsAtMs: 0,
      setting: 'paidDailyBudgetUsd',
    })
    expect(isPaidStopOnTransport(stop)).toBe(true)
    expect(isPaidStopOnTransport(new Error('network failure'))).toBe(false)
    expect(isPaidStopOnTransport('paidDailyStopped')).toBe(false)
  })
})

describe('no reservation outlives its owner (D2)', () => {
  it('releases in full a claim killed before anything was sent', async () => {
    const { journal, directory } = journalAt({ setting: 'paidDailyBudgetUsd' })
    const live = await journal.reserveAdmitted(
      SESSION,
      ACCOUNT,
      Usd.from(1).toAmount(),
      Usd.from(100).toAmount(),
    )
    const victim = parked()
    const pid = victim.pid ?? 0
    expect(pid).toBeGreaterThan(0)
    const claimId = plantClaim(directory, seedOf(directory), { ownerPid: pid, sent: false })
    victim.kill('SIGKILL')
    await exited(victim)
    await journal.read(SESSION, ACCOUNT)
    const claim = readPlanted(directory, claimId)
    expect(claim['settledUsd']).toBe('0')
    expect(claim['hasUnknownCost']).toBe(false)
    await live.settle(Usd.from(0).toAmount())
  })

  it('settles at the reservation with unknown cost a claim killed after sending', async () => {
    const { journal, directory } = journalAt({ setting: 'paidDailyBudgetUsd' })
    const live = await journal.reserveAdmitted(
      SESSION,
      ACCOUNT,
      Usd.from(1).toAmount(),
      Usd.from(100).toAmount(),
    )
    const victim = parked()
    const pid = victim.pid ?? 0
    expect(pid).toBeGreaterThan(0)
    const claimId = plantClaim(directory, seedOf(directory), {
      ownerPid: pid,
      sent: true,
      reserved: '4.524288',
    })
    victim.kill('SIGKILL')
    await exited(victim)
    await journal.read(SESSION, ACCOUNT)
    const claim = readPlanted(directory, claimId)
    expect(claim['settledUsd']).toBe('4.524288')
    expect(claim['hasUnknownCost']).toBe(true)
    await live.settle(Usd.from(0).toAmount())
  })

  it('never touches a live owner', async () => {
    const { journal, directory } = journalAt({ setting: 'paidDailyBudgetUsd' })
    const live = await journal.reserveAdmitted(
      SESSION,
      ACCOUNT,
      Usd.from(1).toAmount(),
      Usd.from(100).toAmount(),
    )
    const owner = parked()
    const pid = owner.pid ?? 0
    expect(pid).toBeGreaterThan(0)
    const claimId = plantClaim(directory, seedOf(directory), { ownerPid: pid, sent: false })
    await journal.read(SESSION, ACCOUNT)
    const claim = readPlanted(directory, claimId)
    expect(claim['settledUsd']).toBe(undefined)
    owner.kill('SIGKILL')
    await exited(owner)
    await live.settle(Usd.from(0).toAmount())
  })

  it.runIf(process.platform === 'linux')(
    'treats a live pid with a foreign start time as a reused pid',
    async () => {
      const { journal, directory } = journalAt({ setting: 'paidDailyBudgetUsd' })
      const live = await journal.reserveAdmitted(
        SESSION,
        ACCOUNT,
        Usd.from(1).toAmount(),
        Usd.from(100).toAmount(),
      )
      const other = parked()
      const pid = other.pid ?? 0
      expect(pid).toBeGreaterThan(0)
      // The pid answers, but its process started at the epoch: not the owner.
      const claimId = plantClaim(directory, seedOf(directory), {
        ownerPid: pid,
        ownerStartMs: 1,
        sent: false,
      })
      await journal.read(SESSION, ACCOUNT)
      expect(readPlanted(directory, claimId)['settledUsd']).toBe('0')
      other.kill('SIGKILL')
      await exited(other)
      await live.settle(Usd.from(0).toAmount())
    },
  )
})

describe('an ownerless hold is judged by age (5b)', () => {
  it('keeps an ownerless claim younger than the longest live request', async () => {
    const closed: unknown[] = []
    const { journal, directory } = journalAt({
      onOwnerlessClosed: (info) => {
        closed.push(info)
      },
    })
    const live = await journal.reserveAdmitted(
      SESSION,
      ACCOUNT,
      Usd.from(1).toAmount(),
      Usd.from(100).toAmount(),
    )
    const claimId = plantOwnerlessClaim(directory, seedOf(directory), { reserved: '4.524288' })
    await journal.read(SESSION, ACCOUNT)
    expect(readPlanted(directory, claimId)['settledUsd']).toBe(undefined)
    expect(closed).toEqual([])
    await live.settle(Usd.from(0).toAmount())
  })

  it('closes an older-than-the-bound ownerless claim as unknown cost and counts it', async () => {
    const closed: { count: number; totalUsd: string }[] = []
    const { journal, directory } = journalAt({
      onOwnerlessClosed: (info) => {
        closed.push({ count: info.count, totalUsd: info.totalUsd })
      },
    })
    const live = await journal.reserveAdmitted(
      SESSION,
      ACCOUNT,
      Usd.from(1).toAmount(),
      Usd.from(100).toAmount(),
    )
    const claimId = plantOwnerlessClaim(directory, seedOf(directory), {
      reserved: '4.524288',
      ageMs: DAILY_BUDGET_OWNERLESS_MAX_AGE_MS + 60_000,
    })
    await journal.read(SESSION, ACCOUNT)
    const claim = readPlanted(directory, claimId)
    expect(claim['settledUsd']).toBe('4.524288')
    expect(claim['hasUnknownCost']).toBe(true)
    expect(closed).toEqual([{ count: 1, totalUsd: '4.524288' }])
    await live.settle(Usd.from(0).toAmount())
    // Fail-closed: the amount stays in today's total, readable as uncertain.
    const total = await journal.readExisting(SESSION, ACCOUNT)
    expect(total?.uncertainUsd).toBe('4.524288')
    // The run's info line names the count and the total.
    expect(plural(UI_TEXT.execStaleHoldsClosed, 1, { total: formatUsd('4.524288', 6) })).toBe(
      'Closed 1 stale hold ($4.524288).',
    )
  })

  it('keeps a claim with a live owner of any age on the owner test only', async () => {
    const { journal, directory } = journalAt({})
    const live = await journal.reserveAdmitted(
      SESSION,
      ACCOUNT,
      Usd.from(1).toAmount(),
      Usd.from(100).toAmount(),
    )
    const owner = parked()
    const pid = owner.pid ?? 0
    expect(pid).toBeGreaterThan(0)
    const claimId = plantClaim(directory, seedOf(directory), { ownerPid: pid, sent: false })
    // Age the hold past the ownerless bound: with an owner, age decides nothing.
    const at = new Date(Date.now() - DAILY_BUDGET_OWNERLESS_MAX_AGE_MS - 60_000)
    const claims = path.join(directory, 'budget-journal', ACCOUNT, SESSION, 'claims', claimId)
    utimesSync(path.join(claims, 'claim.json'), at, at)
    await journal.read(SESSION, ACCOUNT)
    expect(readPlanted(directory, claimId)['settledUsd']).toBe(undefined)
    owner.kill('SIGKILL')
    await exited(owner)
    await live.settle(Usd.from(0).toAmount())
  })
})

describe('bounded unknown cost admits capped runs (R0)', () => {
  // The measured 7:19 AM lockout: four ownerless holds (4.524288 each,
  // older than the age rule) plus one owned $0.69 claim with send-intent.
  // Closing the holds must not refuse later capped runs: their full
  // reservations stay counted, so the cap still holds.
  const OLD_HOLD = '4.524288'
  const FOUR_HOLDS = '18.097152'

  async function measuredLedger(spent: number) {
    const closed: { count: number; totalUsd: string }[] = []
    // A shared daily ledger like the measured one: refusals use the daily
    // sentence, where a new conversation clears nothing.
    const { journal, directory } = journalAt({
      spent,
      setting: 'paidDailyBudgetUsd',
      onOwnerlessClosed: (info) => {
        closed.push({ count: info.count, totalUsd: info.totalUsd })
      },
    })
    const opener = await journal.reserveAdmitted(
      SESSION,
      ACCOUNT,
      Usd.from(1).toAmount(),
      Usd.from(200).toAmount(),
    )
    const seed = seedOf(directory)
    const holds = [0, 1, 2, 3].map(() =>
      plantOwnerlessClaim(directory, seed, {
        reserved: OLD_HOLD,
        ageMs: DAILY_BUDGET_OWNERLESS_MAX_AGE_MS + 60_000,
      }),
    )
    const owner = parked()
    const pid = owner.pid ?? 0
    expect(pid).toBeGreaterThan(0)
    const owned = plantClaim(directory, seed, { ownerPid: pid, sent: true, reserved: '0.69' })
    return { journal, directory, closed, opener, holds, owned, owner }
  }

  it('admits a capped run after the age rule closes stale holds, as an upper bound', async () => {
    const t = await measuredLedger(100)
    try {
      const run = await t.journal.reserveAdmitted(
        SESSION,
        ACCOUNT,
        Usd.from(1).toAmount(),
        Usd.from(200).toAmount(),
      )
      // All four holds closed at their full reservations, unknown but bounded.
      for (const hold of t.holds) {
        expect(readPlanted(t.directory, hold)).toMatchObject({
          settledUsd: OLD_HOLD,
          hasUnknownCost: true,
        })
      }
      expect(t.closed).toEqual([{ count: 4, totalUsd: FOUR_HOLDS }])
      // The owned send-intent claim stays open: its owner still lives.
      expect(readPlanted(t.directory, t.owned)['settledUsd']).toBe(undefined)
      // Admitted with room: 100 + 18.097152 + 0.69 + opener 1 + run 1.
      const total = await t.journal.read(SESSION, ACCOUNT)
      expect(total.spentUsd).toBe('120.787152')
      expect(total.hasUnknownHistoricalFees).toBe(false)
      expect(total.hasBoundedUnknownCost).toBe(true)
      // The closed holds are reported as uncertain, counted exactly once:
      // the four holds plus the still-open owned claim.
      await run.settle(Usd.from(0.5).toAmount())
      await t.opener.settle(Usd.from(0).toAmount())
      const existing = await t.journal.readExisting(SESSION, ACCOUNT)
      expect(existing?.uncertainUsd).toBe('18.787152')
    } finally {
      t.owner.kill('SIGKILL')
      await exited(t.owner)
    }
  })

  it('refuses a truly unbounded legacy record with the true sentence', async () => {
    const { journal, directory } = journalAt({ setting: 'paidDailyBudgetUsd' })
    const live = await journal.reserveAdmitted(
      SESSION,
      ACCOUNT,
      Usd.from(1).toAmount(),
      Usd.from(100).toAmount(),
    )
    // An old record: unknown cost, never settled — its final cost may
    // still exceed every counted bound. Young, so the age rule skips it.
    const claimId = plantOwnerlessClaim(directory, seedOf(directory), { reserved: '4.5' })
    const file = path.join(
      directory,
      'budget-journal',
      ACCOUNT,
      SESSION,
      'claims',
      claimId,
      'claim.json',
    )
    const planted = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    writeFileSync(file, JSON.stringify({ ...planted, hasUnknownCost: true }))
    await live.settle(Usd.from(0).toAmount())
    const caught = await catchReserve(
      journal.reserveAdmitted(SESSION, ACCOUNT, Usd.from(1).toAmount(), Usd.from(100).toAmount()),
    )
    expect(caught).toBeInstanceOf(SessionBudgetExceededError)
    // The literal sentence: the ledger, the counted spend, and remedies
    // that work. Spent is the 4.5 hold plus the refused 1.0 reservation.
    expect((caught as Error).message).toBe(
      'The spend ledger for paid-stop-1 still holds charges no record bounds ' +
        '($5.500000 counted so far). A new conversation does not clear it: wait for the ' +
        'owning run to finish (ownerless holds close on their own), or rerun without a spend cap.',
    )
    expect((caught as Error).message).not.toContain('pending')
  })

  it('closes one stale hold once when two processes race it', async () => {
    const closedA: { count: number; totalUsd: string }[] = []
    const closedB: { count: number; totalUsd: string }[] = []
    // One process's lock patience: real waits, so the loser still holds
    // attempts while the winner closes inside the lock.
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
    const first = journalAt({
      sleep,
      onOwnerlessClosed: (info) => {
        closedA.push({ count: info.count, totalUsd: info.totalUsd })
      },
    })
    const live = await first.journal.reserveAdmitted(
      SESSION,
      ACCOUNT,
      Usd.from(1).toAmount(),
      Usd.from(100).toAmount(),
    )
    const hold = plantOwnerlessClaim(first.directory, seedOf(first.directory), {
      reserved: OLD_HOLD,
      ageMs: DAILY_BUDGET_OWNERLESS_MAX_AGE_MS + 60_000,
    })
    const second = createSessionBudgetJournal({
      directory: first.directory,
      sleep,
      recoverUnsent: true,
      onOwnerlessClosed: (info) => {
        closedB.push({ count: info.count, totalUsd: info.totalUsd })
      },
      initialBudget: () =>
        Promise.resolve({ spentUsd: Usd.from(0).toAmount(), hasUnknownHistoricalFees: false }),
    })
    const [runA, runB] = await Promise.all([
      first.journal.reserveAdmitted(
        SESSION,
        ACCOUNT,
        Usd.from(1).toAmount(),
        Usd.from(100).toAmount(),
      ),
      second.reserveAdmitted(SESSION, ACCOUNT, Usd.from(1).toAmount(), Usd.from(100).toAmount()),
    ])
    // Both admitted; the hold settled once at its reservation.
    expect(readPlanted(first.directory, hold)['settledUsd']).toBe(OLD_HOLD)
    const closedTotal = Usd.from(closedA[0]?.totalUsd ?? 0)
      .add(Usd.from(closedB[0]?.totalUsd ?? 0))
      .toAmount()
    expect(closedTotal).toBe(OLD_HOLD)
    expect(closedA.length + closedB.length).toBe(1)
    const total = await first.journal.read(SESSION, ACCOUNT)
    expect(total.spentUsd).toBe('7.524288')
    expect(total.hasUnknownHistoricalFees).toBe(false)
    await live.settle(Usd.from(0).toAmount())
    await runA.settle(Usd.from(0).toAmount())
    await runB.settle(Usd.from(0).toAmount())
  })

  it('never closes an age-closed hold twice or counts it twice', async () => {
    const closed: { count: number; totalUsd: string }[] = []
    const { journal, directory } = journalAt({
      onOwnerlessClosed: (info) => {
        closed.push({ count: info.count, totalUsd: info.totalUsd })
      },
    })
    const live = await journal.reserveAdmitted(
      SESSION,
      ACCOUNT,
      Usd.from(1).toAmount(),
      Usd.from(100).toAmount(),
    )
    const hold = plantOwnerlessClaim(directory, seedOf(directory), {
      reserved: OLD_HOLD,
      ageMs: DAILY_BUDGET_OWNERLESS_MAX_AGE_MS + 60_000,
    })
    const first = await journal.read(SESSION, ACCOUNT)
    const second = await journal.read(SESSION, ACCOUNT)
    expect(readPlanted(directory, hold)['settledUsd']).toBe(OLD_HOLD)
    expect(closed).toEqual([{ count: 1, totalUsd: OLD_HOLD }])
    expect(second.spentUsd).toBe(first.spentUsd)
    expect(second.spentUsd).toBe('5.524288')
    // Age the CLOSED hold past the bound: settled rows are still skipped,
    // so no second close fires and the spend never moves.
    const holdDir = path.join(directory, 'budget-journal', ACCOUNT, SESSION, 'claims', hold)
    const old = new Date(Date.now() - DAILY_BUDGET_OWNERLESS_MAX_AGE_MS - 60_000)
    utimesSync(path.join(holdDir, 'claim.json'), old, old)
    utimesSync(holdDir, old, old)
    const third = await journal.read(SESSION, ACCOUNT)
    expect(readPlanted(directory, hold)['settledUsd']).toBe(OLD_HOLD)
    expect(closed).toEqual([{ count: 1, totalUsd: OLD_HOLD }])
    expect(third.spentUsd).toBe('5.524288')
    await live.settle(Usd.from(0).toAmount())
  })

  it('admits after a restart between the age close and the admission', async () => {
    const { journal, directory } = journalAt({})
    const live = await journal.reserveAdmitted(
      SESSION,
      ACCOUNT,
      Usd.from(1).toAmount(),
      Usd.from(100).toAmount(),
    )
    plantOwnerlessClaim(directory, seedOf(directory), {
      reserved: OLD_HOLD,
      ageMs: DAILY_BUDGET_OWNERLESS_MAX_AGE_MS + 60_000,
    })
    await journal.read(SESSION, ACCOUNT)
    await live.settle(Usd.from(0).toAmount())
    // A fresh instance — a restarted process — admits on the closed ledger.
    const restarted = createSessionBudgetJournal({
      directory,
      sleep: () => Promise.resolve(),
      recoverUnsent: true,
      initialBudget: () =>
        Promise.resolve({ spentUsd: Usd.from(0).toAmount(), hasUnknownHistoricalFees: false }),
    })
    const run = await restarted.reserveAdmitted(
      SESSION,
      ACCOUNT,
      Usd.from(1).toAmount(),
      Usd.from(100).toAmount(),
    )
    const total = await restarted.read(SESSION, ACCOUNT)
    expect(total.hasUnknownHistoricalFees).toBe(false)
    expect(total.hasBoundedUnknownCost).toBe(true)
    await run.settle(Usd.from(0).toAmount())
  })
})

describe('a rotated key is a recognised refusal (P3-2)', () => {
  it('counts the rotation sentence as a user refusal', () => {
    expect(isUserRefusal(new Error(UI_TEXT.execKeyRotated))).toBe(true)
    expect(isUserRefusal(new Error('something else'))).toBe(false)
  })
})
