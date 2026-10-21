// Two windows, one session (PLAN.md D208): each window saves the running
// spend total it saw, and both increments survive instead of the larger
// snapshot dropping the other's. Each store instance is one window: its own
// base, one directory, real files, the real clock.
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createFileSessionStore } from '../../src/host/backend/fileSessionStore'
import { SpendLedgerError } from '../../src/core/paid/spendLedgerError'
import type { StoredSession } from '../../src/core/backends/modelapi/sessionStore'
import type { Logger } from '../../src/host/logger'
import { Usd } from '../../src/shared/usd'
import { removeFolder } from './helpers/temporaryFolders'

const root = mkdtempSync(path.join(tmpdir(), 'session-spend-'))
afterAll(async () => {
  await removeFolder(root)
})
const logged: string[] = []
const atLevel =
  (level: string) =>
  (message: string): void => {
    logged.push(`${level}:${message}`)
  }
const log: Logger = {
  trace: atLevel('trace'),
  info: atLevel('info'),
  warn: atLevel('warn'),
  error: atLevel('error'),
}
const sleep = () => Promise.resolve()
const storeIn = (directory: string) =>
  createFileSessionStore({
    directory,
    log,
    retentionDays: () => 0,
    now: Date.now,
    sleep,
  })

const session = (spend: string): StoredSession => ({
  version: 1,
  sessionId: 's1',
  workspaceRoot: '/ws',
  modelId: 'muse-spark-1.3',
  approvalMode: 'promptUnmatched',
  effort: 'high',
  createdAt: '2026-10-17T10:00:00.000Z',
  lastActivityAt: '2026-10-17T10:05:00.000Z',
  turnIds: [],
  todos: [],
  replay: [],
  transcript: [],
  outputs: {},
  usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
  budgetSpentUsd: Usd.from(spend).toAmount(),
})

const twoWindowsFrom = async (directory: string) => {
  const first = storeIn(directory)
  const second = storeIn(directory)
  await first.save(session('1'))
  // Each window opens the session at the same total, then spends apart.
  const beforeFirst = await first.load('s1')
  const beforeSecond = await second.load('s1')
  if (beforeFirst === undefined || beforeSecond === undefined)
    throw new Error('the session was not saved')
  return { first, second, beforeFirst, beforeSecond }
}

describe('one session open in two windows', () => {
  it('keeps both spend increments instead of the larger snapshot', async () => {
    const { first, second, beforeFirst, beforeSecond } = await twoWindowsFrom(
      path.join(root, 'two-windows'),
    )
    // 1 + 2 in the first window, 1 + 4 in the second: the file holds 7.
    await first.save({ ...beforeFirst, budgetSpentUsd: Usd.from('3').toAmount() })
    await second.save({ ...beforeSecond, budgetSpentUsd: Usd.from('5').toAmount() })
    const merged = await first.load('s1')
    expect(merged?.budgetSpentUsd).toBe(Usd.from('7').toAmount())
  })

  it('keeps a window second increment after the merge instead of dropping it', async () => {
    const { first, second, beforeFirst, beforeSecond } = await twoWindowsFrom(
      path.join(root, 'two-windows-second'),
    )
    // 1 + 2 in the first window, 1 + 4 in the second: the file holds 7.
    await first.save({ ...beforeFirst, budgetSpentUsd: Usd.from('3').toAmount() })
    await second.save({ ...beforeSecond, budgetSpentUsd: Usd.from('5').toAmount() })
    // The second window spends $1 more from its own unmerged total of 5:
    // the file holds 8, not 7.
    await second.save({ ...beforeSecond, budgetSpentUsd: Usd.from('6').toAmount() })
    const kept = await first.load('s1')
    expect(kept?.budgetSpentUsd).toBe(Usd.from('8').toAmount())
  })

  it('a snapshot older than the file never lowers it', async () => {
    const directory = path.join(root, 'stale')
    const window = storeIn(directory)
    await window.save(session('7'))
    // A window that never opened the session saves an older figure.
    await storeIn(directory).save(session('2'))
    const kept = await window.load('s1')
    expect(kept?.budgetSpentUsd).toBe(Usd.from('7').toAmount())
  })
})

// A file saved before D208 while a request reservation was open holds that
// reservation in its total (the old snapshot added it). The legacy journal
// beside the session files still names the settled charges, so the load
// rebuilds the settled-only total from them (D208: a reservation is never
// spend). Same directory layout the removed session journal wrote.
const LEGACY_ACCOUNT = 'ab'.repeat(32)
const LEGACY_SCOPE = '11111111-1111-1111-1111-111111111111'
const SETTLED_CLAIM = '22222222-2222-2222-2222-222222222222'
const OPEN_CLAIM = '44444444-4444-4444-4444-444444444444'
const MISSING_CLAIM = '66666666-6666-6666-6666-666666666666'
const RETAINED_CLAIM = '77777777-7777-7777-7777-777777777777'
const legacySession = () => ({ ...session('10'), sessionId: 's9' })
const claim = (claimId: string, amounts?: { settledUsd?: string; retainedUsd?: string }) =>
  JSON.stringify({
    version: 2,
    scopeId: LEGACY_SCOPE,
    sessionId: 's9',
    accountId: LEGACY_ACCOUNT,
    claimId,
    ownerId: '33333333-3333-3333-3333-333333333333',
    reservedUsd: '3',
    ...amounts,
  })
const writeClaim = (
  scope: string,
  claimId: string,
  amounts?: { settledUsd?: string; retainedUsd?: string },
) => {
  // Claim directories carry their claim id, as the removed journal wrote them.
  mkdirSync(path.join(scope, 'claims', claimId), { recursive: true })
  writeFileSync(path.join(scope, 'claims', claimId, 'claim.json'), claim(claimId, amounts))
}
const writeLegacyJournal = (directory: string) => {
  const scope = path.join(directory, 'budget-journal', LEGACY_ACCOUNT, 's9')
  mkdirSync(scope, { recursive: true })
  writeFileSync(
    path.join(scope, 'seed.json'),
    JSON.stringify({
      version: 2,
      scopeId: LEGACY_SCOPE,
      sessionId: 's9',
      accountId: LEGACY_ACCOUNT,
      spentUsd: '7',
      hasUnknownHistoricalFees: false,
    }),
  )
  // A settled charge enters the rebuilt total; an open one stays out.
  writeClaim(scope, SETTLED_CLAIM, { settledUsd: '1.5' })
  writeClaim(scope, OPEN_CLAIM)
  // A claim directory without its file (a dead process's, for example) is
  // unsettled too: held, never spent.
  mkdirSync(path.join(scope, 'claims', MISSING_CLAIM), { recursive: true })
}

describe('a legacy session total with an open reservation', () => {
  it('rebuilds the settled-only total on load', async () => {
    const directory = path.join(root, 'legacy-load')
    const window = storeIn(directory)
    await window.save(legacySession())
    writeLegacyJournal(directory)
    // Seed 7 plus the one settled 1.5; the open 3 stays out.
    const loaded = await window.load('s9')
    expect(loaded?.budgetSpentUsd).toBe(Usd.from('8.5').toAmount())
    expect(loaded?.spendSettledOnly).toBe(true)
  })

  it('lands the rebuild on save instead of merging onto the phantom', async () => {
    const directory = path.join(root, 'legacy-save')
    const window = storeIn(directory)
    await window.save(legacySession())
    writeLegacyJournal(directory)
    const loaded = await window.load('s9')
    if (loaded === undefined) throw new Error('the session was not saved')
    // The window spends 0.5 more from its rebuilt 8.5: the file holds 9,
    // not the phantom 10 it was loaded over.
    await window.save({ ...loaded, budgetSpentUsd: Usd.from('9').toAmount() })
    const kept = await storeIn(directory).load('s9')
    expect(kept?.budgetSpentUsd).toBe(Usd.from('9').toAmount())
    expect(kept?.spendSettledOnly).toBe(true)
  })

  it('keeps a session without a journal on what its file holds', async () => {
    const directory = path.join(root, 'legacy-no-journal')
    const window = storeIn(directory)
    await window.save(legacySession())
    const loaded = await window.load('s9')
    expect(loaded?.budgetSpentUsd).toBe(Usd.from('10').toAmount())
    expect(loaded?.spendSettledOnly).toBe(undefined)
  })

  it('counts a retained liability an open claim kept past its reservation', async () => {
    const directory = path.join(root, 'legacy-retained')
    const window = storeIn(directory)
    await window.save(legacySession())
    writeLegacyJournal(directory)
    // Bounded-search fees exceeded the reservation before final token
    // settlement: the claim stayed open with the incurred liability
    // retained, and the rebuild counts it instead of dropping it.
    const scope = path.join(directory, 'budget-journal', LEGACY_ACCOUNT, 's9')
    writeClaim(scope, RETAINED_CLAIM, { retainedUsd: '2' })
    // Seed 7, settled 1.5, retained 2; the open 3 stays out.
    const loaded = await window.load('s9')
    expect(loaded?.budgetSpentUsd).toBe(Usd.from('10.5').toAmount())
    expect(loaded?.spendSettledOnly).toBe(true)
  })

  it('keeps the stored total when the legacy seed does not parse', async () => {
    const directory = path.join(root, 'legacy-corrupt-seed')
    const window = storeIn(directory)
    await window.save(legacySession())
    writeLegacyJournal(directory)
    // A seed that is not JSON is damage, never spend: the stored total
    // stands, said once in the log.
    const scope = path.join(directory, 'budget-journal', LEGACY_ACCOUNT, 's9')
    writeFileSync(path.join(scope, 'seed.json'), '{not json')
    const before = logged.length
    const loaded = await window.load('s9')
    expect(loaded?.budgetSpentUsd).toBe(Usd.from('10').toAmount())
    expect(loaded?.spendSettledOnly).toBe(undefined)
    expect(logged.length).toBe(before + 1)
  })

  it('keeps the stored total when a legacy claim is detached from its journal', async () => {
    const directory = path.join(root, 'legacy-misplaced')
    const window = storeIn(directory)
    await window.save(legacySession())
    writeLegacyJournal(directory)
    // A row filed under another claim's directory is damage, never spend:
    // the stored total stands and the file is not stamped migrated.
    const scope = path.join(directory, 'budget-journal', LEGACY_ACCOUNT, 's9')
    mkdirSync(path.join(scope, 'claims', 'stray'), { recursive: true })
    writeFileSync(
      path.join(scope, 'claims', 'stray', 'claim.json'),
      claim(SETTLED_CLAIM, { settledUsd: '1.5' }),
    )
    const loaded = await window.load('s9')
    expect(loaded?.budgetSpentUsd).toBe(Usd.from('10').toAmount())
    expect(loaded?.spendSettledOnly).toBe(undefined)
  })
})

describe('unknown-charge calls across a save', () => {
  it('keeps the count the conversation row reports', async () => {
    const directory = path.join(root, 'unknown-calls')
    const window = storeIn(directory)
    await window.save({ ...session('1'), sessionId: 's8', unknownChargeCalls: 3 })
    const loaded = await window.load('s8')
    expect(loaded?.unknownChargeCalls).toBe(3)
  })

  it('keeps both windows unknown-call increments instead of overwriting', async () => {
    const directory = path.join(root, 'unknown-merge')
    const first = storeIn(directory)
    const second = storeIn(directory)
    await first.save({ ...session('1'), unknownChargeCalls: 1 })
    const beforeFirst = await first.load('s1')
    const beforeSecond = await second.load('s1')
    if (beforeFirst === undefined || beforeSecond === undefined)
      throw new Error('the session was not saved')
    // One more unknown call in each window past the shared base of 1:
    // the file holds 3, not the later snapshot's 2.
    await first.save({ ...beforeFirst, unknownChargeCalls: 2 })
    await second.save({ ...beforeSecond, unknownChargeCalls: 2 })
    const merged = await first.load('s1')
    expect(merged?.unknownChargeCalls).toBe(3)
  })
})

describe('an unreadable session store', () => {
  // A symbolic-link loop refuses every read; Windows needs a privilege to
  // make one, so this runs where the loop can be built.
  it.runIf(process.platform !== 'win32')(
    'refuses with the typed refusal, keeping errno and cause',
    async () => {
      const directory = path.join(root, 'unreadable-loop')
      mkdirSync(directory, { recursive: true })
      symlinkSync('loop', path.join(directory, 'loop'))
      let failure: unknown
      try {
        await storeIn(path.join(directory, 'loop')).save(session('1'))
      } catch (error: unknown) {
        failure = error
      }
      expect(failure).toBeInstanceOf(SpendLedgerError)
      if (!(failure instanceof SpendLedgerError)) throw new Error('the save did not refuse')
      expect(failure.kind).toBe('unreadable')
      expect(failure.facts.errno).toBe('ELOOP')
      const cause = failure.cause
      expect(
        typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined,
      ).toBe('ELOOP')
    },
  )
})
