// Lane A integration: admission through the real M82 claim journal (the
// durable store D78's daily ledger builds on), on a temporary directory.
// Each test restarts the journal with a fresh instance over the same
// directory, the way a second window or a post-crash restart would. The
// daily scoping, canonical cross-window namespace, network-home refusal and
// lock stability (D77 criteria 1, 6, 7) belong to D78/FIXDEF and are
// recorded as gaps in docs/certification/m98-a.md, not patched around here.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { StoredSession } from '../../src/core/backends/modelapi/sessionStore'
import { admitJudgeCall, verifyJudgeDispatch } from '../../src/core/judge/admission'
import type { JudgeDailyLedger, JudgeLedgerClaim } from '../../src/core/judge/admission'
import { createSessionBudgetJournal } from '../../src/host/backend/sessionBudgetJournal'
import { removeFolder } from './helpers/temporaryFolders'

const ACCOUNT = 'a'.repeat(64)
const SESSION = 'session-1'
const MODEL = 'muse-spark-1.3'
const folders: string[] = []

afterAll(async () => {
  await Promise.all(folders.map((folder) => removeFolder(folder)))
})

function snapshot(): StoredSession {
  const createdAt = '2026-10-05T00:00:00.000Z'
  const usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 }
  return {
    version: 1,
    sessionId: SESSION,
    accountId: ACCOUNT,
    workspaceRoot: '/ws',
    modelId: MODEL,
    approvalMode: 'allowAll',
    effort: 'high',
    createdAt,
    lastActivityAt: createdAt,
    turnIds: [],
    todos: [],
    replay: [],
    transcript: [],
    outputs: {},
    usage,
    budgetSpentUsd: 0,
  }
}

function freshDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'judge-admission-'))
  folders.push(directory)
  return directory
}

type Journal = ReturnType<typeof createSessionBudgetJournal>

/** The test-scope adapter: one session scope of the journal as the ledger. */
function ledgerFor(journal: Journal, capUsd: number | (() => number)): JudgeDailyLedger {
  const currentCap = typeof capUsd === 'function' ? capUsd : () => capUsd
  return {
    async remainingUsd(): Promise<number> {
      const total = await journal.read(SESSION, ACCOUNT)
      return currentCap() - total.spentUsd
    },
    async reserve(costUsd: number): Promise<JudgeLedgerClaim> {
      const claim = await journal.reserve(SESSION, ACCOUNT, costUsd)
      return {
        claimId: claim.claimId,
        reservedUsd: claim.reservedUsd,
        check(): void {
          claim.check(currentCap())
        },
        async settle(actualCostUsd: number): Promise<void> {
          await claim.settle(actualCostUsd)
        },
      }
    },
  }
}

function journalAt(directory: string): Journal {
  return createSessionBudgetJournal({
    directory,
    loadSession: () => Promise.resolve(snapshot()),
    sleep: () => Promise.resolve(undefined),
  })
}

function binding(consent: 'granted' | 'declined' = 'granted') {
  return {
    ownerId: 'owner-1',
    backend: 'modelApi' as const,
    modelId: MODEL,
    engine: 'auto' as const,
    confidential: false,
    consent,
  }
}

function journalAdmission(directory: string, capUsd = 1) {
  return admitJudgeCall({
    binding: binding(),
    billing: { kind: 'metered', ledger: ledgerFor(journalAt(directory), capUsd) },
    estimatedInputTokens: 1000,
    maxOutputTokens: 100,
  })
}

describe('admission over the real journal', () => {
  it('keeps a kill-after-dispatch claim as liability across a restart', async () => {
    const directory = freshDirectory()
    const capUsd = 1
    const admission = await journalAdmission(directory, capUsd)
    if (!admission.admitted) {
      throw new Error('expected admission')
    }
    const reserved = admission.claim.reservedUsd
    // The process dies after dispatch: a fresh instance restarts over the
    // same directory and the sent-or-possibly-sent claim is still held.
    const restarted = journalAt(directory)
    const total = await restarted.read(SESSION, ACCOUNT)
    expect(total.spentUsd).toBeCloseTo(reserved, 12)
  })

  it('settles known usage and refunds a known non-send through the store', async () => {
    const directory = freshDirectory()
    const capUsd = 1
    const settled = await journalAdmission(directory, capUsd)
    if (!settled.admitted) {
      throw new Error('expected admission')
    }
    const actual = await settled.claim.settleKnown({
      inputTokens: 1000,
      outputTokens: 100,
      cachedTokens: 400,
    })
    let total = await journalAt(directory).read(SESSION, ACCOUNT)
    expect(total.spentUsd).toBeCloseTo(actual, 12)

    const refunded = await journalAdmission(directory, capUsd)
    if (!refunded.admitted) {
      throw new Error('expected admission')
    }
    await refunded.claim.refundNonSend()
    total = await journalAt(directory).read(SESSION, ACCOUNT)
    expect(total.spentUsd).toBeCloseTo(actual, 12)
  })

  it('leaves an uncertain claim reserved after a restart', async () => {
    const directory = freshDirectory()
    const admission = await journalAdmission(directory)
    if (!admission.admitted) {
      throw new Error('expected admission')
    }
    // A timeout: nothing settles. After a restart the full reservation is
    // still liability, never silently freed.
    const total = await journalAt(directory).read(SESSION, ACCOUNT)
    expect(total.spentUsd).toBeCloseTo(admission.claim.reservedUsd, 12)
  })

  it('refuses fail-closed on a corrupt store', async () => {
    const directory = freshDirectory()
    const admission = await journalAdmission(directory)
    if (!admission.admitted) {
      throw new Error('expected admission')
    }
    writeFileSync(path.join(directory, 'budget-journal', ACCOUNT, SESSION, 'seed.json'), '{corrupt')
    const ledger = ledgerFor(journalAt(directory), 1)
    const retry = await admitJudgeCall({
      binding: binding(),
      billing: { kind: 'metered', ledger },
      estimatedInputTokens: 1000,
      maxOutputTokens: 100,
    })
    expect(retry).toEqual({ admitted: false, refusal: 'ledger-unavailable' })
    expect(await verifyJudgeDispatch(admission.claim, binding(), ledger)).toEqual({
      proceed: false,
      reason: 'ledger-unavailable',
    })
  })

  it('interleaves two windows reading the last budget and refunds the losing reservation', async () => {
    const directory = freshDirectory()
    const capUsd = 0.002
    const firstLedger = ledgerFor(journalAt(directory), capUsd)
    const secondLedger = ledgerFor(journalAt(directory), capUsd)
    // Seed before the race; both windows must read the SAME old balance.
    await firstLedger.remainingUsd()
    const bothRead = Promise.withResolvers<undefined>()
    const releaseReads = Promise.withResolvers<undefined>()
    const secondReserving = Promise.withResolvers<undefined>()
    const releaseSecond = Promise.withResolvers<undefined>()
    const balances: number[] = []
    const nonsentRefunds: number[] = []
    const controlled = (ledger: JudgeDailyLedger, isSecond: boolean): JudgeDailyLedger => ({
      async remainingUsd(): Promise<number> {
        const balance = await ledger.remainingUsd()
        balances.push(balance)
        if (balances.length === 2) bothRead.resolve(undefined)
        await releaseReads.promise
        return balance
      },
      async reserve(costUsd: number): Promise<JudgeLedgerClaim> {
        if (isSecond) {
          secondReserving.resolve(undefined)
          await releaseSecond.promise
        }
        const claim = await ledger.reserve(costUsd)
        return {
          ...claim,
          async settle(actualCostUsd: number): Promise<void> {
            if (isSecond) nonsentRefunds.push(actualCostUsd)
            await claim.settle(actualCostUsd)
          },
        }
      },
    })
    const firstPending = admitJudgeCall({
      binding: binding(),
      billing: { kind: 'metered', ledger: controlled(firstLedger, false) },
      estimatedInputTokens: 1000,
      maxOutputTokens: 100,
    })
    const secondPending = admitJudgeCall({
      binding: binding(),
      billing: { kind: 'metered', ledger: controlled(secondLedger, true) },
      estimatedInputTokens: 1000,
      maxOutputTokens: 100,
    })
    await bothRead.promise
    expect(balances).toEqual([capUsd, capUsd])
    releaseReads.resolve(undefined)
    await secondReserving.promise
    const first = await firstPending
    releaseSecond.resolve(undefined)
    const second = await secondPending
    expect(second).toEqual({ admitted: false, refusal: 'ledger-unavailable' })
    expect(nonsentRefunds).toEqual([0])
    if (!first.admitted) throw new Error('expected the first window admitted')
    const total = await journalAt(directory).read(SESSION, ACCOUNT)
    expect(total.spentUsd).toBeCloseTo(first.claim.reservedUsd, 12)
    expect(await verifyJudgeDispatch(first.claim, binding(), firstLedger)).toEqual({
      proceed: true,
    })
  })

  it('refuses a lowered daily cap through the real claim guard', async () => {
    const directory = freshDirectory()
    const journal = journalAt(directory)
    const historical = await journal.reserve(SESSION, ACCOUNT, 0.6)
    await historical.settle(0.6)
    let cap = 1
    const ledger = ledgerFor(journal, () => cap)
    const admission = await admitJudgeCall({
      binding: binding(),
      billing: { kind: 'metered', ledger },
      estimatedInputTokens: 1000,
      maxOutputTokens: 100,
    })
    if (!admission.admitted) throw new Error('expected admission')
    cap = 0.5
    expect(await ledger.remainingUsd()).toBeLessThan(0)
    expect(await verifyJudgeDispatch(admission.claim, binding(), ledger)).toEqual({
      proceed: false,
      reason: 'ledger-unavailable',
    })
    const total = await journalAt(directory).read(SESSION, ACCOUNT)
    expect(total.spentUsd).toBeCloseTo(0.601675, 12)
  })

  it('settles idempotently by claim id in the store', async () => {
    const directory = freshDirectory()
    const journal = journalAt(directory)
    const claim = await journal.reserve(SESSION, ACCOUNT, 0.001)
    const first = await claim.settle(0.0005)
    const second = await claim.settle(0.0005)
    expect(second.spentUsd).toBeCloseTo(first.spentUsd, 12)
  })

  it('refuses a revoked consent after the wait without touching the store', async () => {
    const directory = freshDirectory()
    const admission = await journalAdmission(directory)
    if (!admission.admitted) {
      throw new Error('expected admission')
    }
    const verdict = await verifyJudgeDispatch(
      admission.claim,
      binding('declined'),
      ledgerFor(journalAt(directory), 1),
    )
    expect(verdict).toEqual({ proceed: false, reason: 'consent-declined' })
    const total = await journalAt(directory).read(SESSION, ACCOUNT)
    expect(total.spentUsd).toBeCloseTo(admission.claim.reservedUsd, 12)
  })
})
