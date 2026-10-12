// EXECPROVR3 D1/D2/P3-2: a paid refusal carries its numbers, never a generic
// sentence; an open claim never outlives its owner process. Each test fails
// without its fix: the journal threw a numbers-free sentence, kept dead holds,
// or the rotation refusal was not a recognised refusal.

import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PaidBudgetStopError } from '../../src/core/backends/modelapi/sessionBudget'
import { isPaidStop, isUserRefusal } from '../../src/core/refusal'
import { isPaidStop as isPaidStopOnTransport } from '../../src/host/backend/configuredProvidersEntry'
import { createSessionBudgetJournal } from '../../src/host/backend/sessionBudgetJournal'
import { UI_TEXT } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
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

function journalAt(options: { spent?: number; setting?: string } = {}) {
  const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-paid-stop-')))
  folders.push(directory)
  const journal = createSessionBudgetJournal({
    directory,
    sleep: () => Promise.resolve(),
    recoverUnsent: true,
    ...(options.setting !== undefined && {
      dailyStop: { setting: options.setting, nowMs: () => new Date(2026, 9, 11, 12).getTime() },
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

describe('a rotated key is a recognised refusal (P3-2)', () => {
  it('counts the rotation sentence as a user refusal', () => {
    expect(isUserRefusal(new Error(UI_TEXT.execKeyRotated))).toBe(true)
    expect(isUserRefusal(new Error('something else'))).toBe(false)
  })
})
