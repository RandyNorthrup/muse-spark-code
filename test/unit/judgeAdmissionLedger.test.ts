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
import type { JudgeDailyLedger } from '../../src/core/judge/admission'
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
  return {
    version: 1,
    sessionId: SESSION,
    accountId: ACCOUNT,
    workspaceRoot: '/ws',
    modelId: MODEL,
    approvalMode: 'allowAll',
    effort: 'high',
    createdAt: '2026-09-29T00:00:00.000Z',
    lastActivityAt: '2026-09-29T00:00:00.000Z',
    turnIds: [],
    todos: [],
    replay: [],
    transcript: [],
    outputs: {},
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
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
function ledgerFor(journal: Journal, capUsd: number): JudgeDailyLedger {
  return {
    async remainingUsd(): Promise<number> {
      const total = await journal.read(SESSION, ACCOUNT)
      return capUsd - total.spentUsd
    },
    async reserve(
      costUsd: number,
    ): Promise<{ claimId: string; reservedUsd: number; settle(a: number): Promise<void> }> {
      const claim = await journal.reserve(SESSION, ACCOUNT, costUsd)
      // The journal's synchronous final admission after the (test) key read.
      claim.check(capUsd)
      return {
        claimId: claim.claimId,
        reservedUsd: claim.reservedUsd,
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
    sleep: () => Promise.resolve(),
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

describe('admission over the real journal', () => {
  it('keeps a kill-after-dispatch claim as liability across a restart', async () => {
    const directory = freshDirectory()
    const capUsd = 1
    const admission = await admitJudgeCall({
      binding: binding(),
      billing: { kind: 'metered', ledger: ledgerFor(journalAt(directory), capUsd) },
      estimatedInputTokens: 1000,
      maxOutputTokens: 100,
    })
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
    const settled = await admitJudgeCall({
      binding: binding(),
      billing: { kind: 'metered', ledger: ledgerFor(journalAt(directory), capUsd) },
      estimatedInputTokens: 1000,
      maxOutputTokens: 100,
    })
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

    const refunded = await admitJudgeCall({
      binding: binding(),
      billing: { kind: 'metered', ledger: ledgerFor(journalAt(directory), capUsd) },
      estimatedInputTokens: 1000,
      maxOutputTokens: 100,
    })
    if (!refunded.admitted) {
      throw new Error('expected admission')
    }
    await refunded.claim.refundNonSend()
    total = await journalAt(directory).read(SESSION, ACCOUNT)
    expect(total.spentUsd).toBeCloseTo(actual, 12)
  })

  it('leaves an uncertain claim reserved after a restart', async () => {
    const directory = freshDirectory()
    const admission = await admitJudgeCall({
      binding: binding(),
      billing: { kind: 'metered', ledger: ledgerFor(journalAt(directory), 1) },
      estimatedInputTokens: 1000,
      maxOutputTokens: 100,
    })
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
    const admission = await admitJudgeCall({
      binding: binding(),
      billing: { kind: 'metered', ledger: ledgerFor(journalAt(directory), 1) },
      estimatedInputTokens: 1000,
      maxOutputTokens: 100,
    })
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

  it('admits one window for the last of the budget', async () => {
    const directory = freshDirectory()
    const capUsd = 0.002
    // Window A reserves the worst case of one call (~0.001675).
    const first = await admitJudgeCall({
      binding: binding(),
      billing: { kind: 'metered', ledger: ledgerFor(journalAt(directory), capUsd) },
      estimatedInputTokens: 1000,
      maxOutputTokens: 100,
    })
    if (!first.admitted) {
      throw new Error('expected the first window admitted')
    }
    // Window B, a fresh instance over the same scope, finds the remainder
    // under a second worst case and is refused without reserving.
    const second = await admitJudgeCall({
      binding: binding(),
      billing: { kind: 'metered', ledger: ledgerFor(journalAt(directory), capUsd) },
      estimatedInputTokens: 1000,
      maxOutputTokens: 100,
    })
    expect(second).toEqual({ admitted: false, refusal: 'over-budget' })
    const total = await journalAt(directory).read(SESSION, ACCOUNT)
    expect(total.spentUsd).toBeCloseTo(first.claim.reservedUsd, 12)
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
    const admission = await admitJudgeCall({
      binding: binding(),
      billing: { kind: 'metered', ledger: ledgerFor(journalAt(directory), 1) },
      estimatedInputTokens: 1000,
      maxOutputTokens: 100,
    })
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
