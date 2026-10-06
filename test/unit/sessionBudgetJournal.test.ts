import { Usd, multiplyUsd } from '../../src/shared/usd'
import { createPaidDailyBudget } from '../../src/host/paid/paidDailyBudget'
import { PaidUsage } from '../../src/core/paid/paidFeatures'
import { paidCostUsd, freezePaidQuote, searchSettlement } from '../../src/shared/paid'
import { mkdtempSync, realpathSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  parseStoredSession,
  type StoredChild,
  type StoredSession,
} from '../../src/core/backends/modelapi/sessionStore'
import {
  createFileSessionStore,
  type FileSessionStoreDeps,
} from '../../src/host/backend/fileSessionStore'
import { createSessionBudgetJournal } from '../../src/host/backend/sessionBudgetJournal'
import { UI_TEXT } from '../../src/shared/constants'
import { searchAllowanceUsd } from '../../src/core/backends/modelapi/sessionBudget'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

const ACCOUNT = 'a'.repeat(64)
const OTHER_ACCOUNT = 'b'.repeat(64)
const SESSION = 'session-1'
const folders: string[] = []

// Keep real filesystem effects; only the specific metadata failure is injected.
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof FsPromises>()),
}))

afterAll(async () => {
  await Promise.all(folders.map((folder) => removeFolder(folder)))
})

type SnapshotChanges = Omit<Partial<StoredSession>, 'budgetSpentUsd' | 'forkedFrom'> & {
  readonly budgetSpentUsd?: number | undefined
  readonly forkedFrom?: string | undefined
}

function snapshot(overrides: SnapshotChanges = {}): StoredSession {
  const session: Omit<StoredSession, 'budgetSpentUsd' | 'forkedFrom'> & {
    readonly budgetSpentUsd?: number | undefined
    readonly forkedFrom?: string | undefined
  } = {
    version: 1,
    sessionId: SESSION,
    accountId: ACCOUNT,
    workspaceRoot: '/ws',
    modelId: 'muse-spark-1.3',
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
    ...overrides,
  }
  const { budgetSpentUsd, forkedFrom, ...stored } = session
  return {
    ...stored,
    ...(budgetSpentUsd !== undefined && { budgetSpentUsd }),
    ...(forkedFrom !== undefined && { forkedFrom }),
  }
}

function storeAt(directory: string, overrides: Partial<FileSessionStoreDeps> = {}) {
  return createFileSessionStore({
    directory,
    log: new FakeLogOutputChannel(),
    retentionDays: () => 0,
    now: () => 0,
    sleep: () => Promise.resolve(),
    ...overrides,
  })
}

function budgetOf(store: ReturnType<typeof storeAt>) {
  if (store.budget === undefined) {
    throw new Error('disk store must expose its journal')
  }
  return store.budget
}

async function expectSpent(
  total: Promise<{ readonly spentUsd: number | string }>,
  expected: number,
) {
  const current = await total
  expect(current.spentUsd).toBe(Usd.from(expected).toAmount())
}

async function expectStoredSpend(store: ReturnType<typeof storeAt>, expected: number) {
  const current = await store.load(SESSION)
  expect(current?.budgetSpentUsd).toBe(Usd.from(expected).toAmount())
}

/** Failure before/after the real rename; permanent mode also rejects the owner's refund. */
function publicationFailure(isAfterPublication: boolean, isPermanent = false) {
  let hasFailed = false
  return async (from: string, to: string) => {
    if (path.basename(to) !== 'claim.json' || (hasFailed && !isPermanent)) {
      await rename(from, to)
      return
    }
    hasFailed = true
    if (isAfterPublication) {
      await rename(from, to)
    }
    throw Object.assign(new Error('injected ENOSPC'), { code: 'ENOSPC' })
  }
}

async function writeRaw(directory: string, session: StoredSession): Promise<void> {
  await writeFile(path.join(directory, `${session.sessionId}.json`), JSON.stringify(session))
}

async function readRaw(directory: string): Promise<StoredSession> {
  const parsed = parseStoredSession(
    JSON.parse(await readFile(path.join(directory, `${SESSION}.json`), 'utf8')),
  )
  if (!parsed.ok) {
    throw new Error(parsed.reason)
  }
  return parsed.session
}

/** Two independent store instances over real disk, with a legacy file written before either opens. */
async function setup(legacy = snapshot()) {
  const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-budget-journal-')))
  folders.push(directory)
  await writeRaw(directory, legacy)
  const first = storeAt(directory)
  const second = storeAt(directory)
  return { directory, first, second, budget: budgetOf(first), otherBudget: budgetOf(second) }
}

function scope(directory: string): string {
  return path.join(directory, 'budget-journal', ACCOUNT, SESSION)
}

function claimFile(directory: string, claimId: string): string {
  return path.join(scope(directory), 'claims', claimId, 'claim.json')
}

function missingTarget(directory: string, claimId: string, missing: string): string {
  switch (missing) {
    case 'seed': {
      return path.join(scope(directory), 'seed.json')
    }
    case 'claim': {
      return claimFile(directory, claimId)
    }
    case 'scope': {
      return scope(directory)
    }
    case 'claims-directory': {
      return path.join(scope(directory), 'claims')
    }
    default: {
      throw new Error(`unknown missing target: ${missing}`)
    }
  }
}

async function removeOwnedTree(directory: string, target: string): Promise<void> {
  const root = path.resolve(directory)
  const resolved = path.resolve(target)
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('cleanup target leaves its owned fixture')
  }
  await rm(resolved, { recursive: true, force: true })
}

function paidChild(paid: 'webSearch' | 'imageGeneration'): StoredChild {
  return {
    id: 'child-1',
    role: 'worker',
    objective: 'task',
    itemId: 'child-item',
    parentTurnId: 'parent-turn',
    startedAt: 0,
    state: 'closed',
    pendingMessages: [],
    session: snapshot({
      sessionId: 'child-session',
      transcript: [
        {
          turnId: 'child-turn',
          item: { itemId: 'paid-item', kind: 'toolCall', status: 'completed', paid },
        },
      ],
    }),
  }
}

describe('the real-disk session budget journal (M82)', () => {
  it('preserves the reviewer tariff product through admission and persistence without binary ports', async () => {
    const t = await setup()
    const allowance = searchAllowanceUsd(3, '0.12345678901234566')
    expect(allowance).toBe('0.37037036703703698')
    const claim = await t.budget.reserve(SESSION, ACCOUNT, allowance)
    expect(() => claim.check('0.37037036703703696')).toThrow()
    expect(claim.check(allowance).spentUsd).toBe(allowance)
    const raw: unknown = JSON.parse(await readFile(claimFile(t.directory, claim.claimId), 'utf8'))
    expect(raw).toMatchObject({ reservedUsd: allowance })
  })

  it('random charge sequences sum exactly and daily ledger session and tally agree', async () => {
    const t = await setup()
    const usage = new PaidUsage(new FakeLogOutputChannel())
    const daily = createPaidDailyBudget({
      directory: path.join(t.directory, 'property-daily'),
      sleep: () => Promise.resolve(),
      now: () => new Date(2026, 9, 6, 12).getTime(),
      capUsd: () => 0.5,
      isModelApi: () => true,
    })
    let random = 20_261_006
    let expectedUnits = 0n
    const tariff = '0.000033750123456789012345'
    const quote = freezePaidQuote({
      id: 'property',
      feature: 'webSearch',
      provider: 'verified-test',
      model: 'test-model',
      modelRevision: 0,
      tariffUsd: Usd.from(tariff).toAmount(),
      unit: 'search',
      capturedAt: 0,
    })
    for (let index = 0; index < 40; index += 1) {
      random = (random * 1_664_525 + 1_013_904_223) >>> 0
      const units = (random % 20) + 1
      expectedUnits += BigInt(units)
      const settlement = searchSettlement(quote, units, true)
      await t.budget.record(SESSION, ACCOUNT, settlement.costUsd)
      const dailyClaim = await daily.reserveExact(settlement.costUsd)
      await dailyClaim.settle(settlement.costUsd)
      usage.add('webSearch', units, settlement)
      // The oracle uses independent scaled integer arithmetic, never production addition.
      const expected = String(33_750_123_456_789_012_345n * expectedUnits).padStart(25, '0')
      const decimal = `${expected.slice(0, -24)}.${expected.slice(-24)}`
        .replace(/0+$/, '')
        .replace(/\.$/, '')
      const sessionTotal = await t.budget.read(SESSION, ACCOUNT)
      expect(sessionTotal.spentUsd).toBe(decimal)
      const dailyTotal = await daily.latestDay()
      expect(dailyTotal.spentUsd).toBe(decimal)
      expect(paidCostUsd('webSearch', usage.current)).toBe(decimal)
    }
    expect(multiplyUsd(tariff, Number(expectedUnits))).toBe(paidCostUsd('webSearch', usage.current))
  })

  it('settles 200 search fees to exactly USD 0.50 and admits the last search at the cap', async () => {
    const t = await setup()
    const fee = searchAllowanceUsd(1, 0.0025)
    for (let search = 0; search < 200; search += 1) {
      const claim = await t.budget.reserve(SESSION, ACCOUNT, fee)
      // Only the last admission is the boundary under test; avoid 199 redundant disk scans.
      if (search === 199) claim.check(0.5)
      await claim.settle(fee)
    }
    const total = await t.otherBudget.read(SESSION, ACCOUNT)
    expect(total.spentUsd).toBe('0.5')
    const refused = await t.otherBudget.reserve(SESSION, ACCOUNT, fee)
    expect(() => refused.check(0.5)).toThrow()
    await refused.settle(0)
  })

  it('migrates legacy decimal amounts without losing sub-micro precision or rewriting foreign rows', async () => {
    const t = await setup()
    const claim = await t.budget.reserve(SESSION, ACCOUNT, 0.0025)
    const file = claimFile(t.directory, claim.claimId)
    const seedFile = path.join(scope(t.directory), 'seed.json')
    const seed: unknown = JSON.parse(await readFile(seedFile, 'utf8'))
    const entry: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (typeof seed !== 'object' || seed === null || typeof entry !== 'object' || entry === null) {
      throw new Error('Missing fixture rows')
    }
    const legacySeed = JSON.stringify({ ...seed, version: 1, spentUsd: 0.000000002 })
    const legacyClaim = JSON.stringify({ ...entry, version: 1, reservedUsd: 0.0025 })
    await writeFile(seedFile, legacySeed)
    await writeFile(file, legacyClaim)
    const migrated = await t.otherBudget.read(SESSION, ACCOUNT)
    expect(migrated.spentUsd).toBe('0.002500002')
    expect(await readFile(file, 'utf8')).toBe(legacyClaim)
    expect(await readFile(seedFile, 'utf8')).toBe(legacySeed)
    await claim.settle(0.000000002)
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
      version: 2,
      settledUsd: '0.000000002',
    })
    const settled = await t.otherBudget.read(SESSION, ACCOUNT)
    expect(settled.spentUsd).toBe('0.000000004')
  })

  it('retains an over-bound fee on the original row across restart and closes it once', async () => {
    const t = await setup()
    const claim = await t.budget.reserve(SESSION, ACCOUNT, 0.1)
    await claim.settle(0.1025, false, false)
    await expect(t.otherBudget.read(SESSION, ACCOUNT)).resolves.toMatchObject({
      spentUsd: '0.1025',
    })
    expect(await readdir(path.join(scope(t.directory), 'claims'))).toEqual([claim.claimId])
    await expect(claim.settle(0.1, false, false)).rejects.toThrow()
    await claim.settle(0.0026)
    await expect(t.otherBudget.read(SESSION, ACCOUNT)).resolves.toMatchObject({
      spentUsd: '0.0026',
    })
    await expect(claim.settle(0.003)).rejects.toThrow()
  })

  it('publishes both independent liabilities before either final sum, with no winner election', async () => {
    const t = await setup()
    await t.budget.read(SESSION, ACCOUNT)
    const [one, two] = await Promise.all([
      t.budget.reserve(SESSION, ACCOUNT, 0.6),
      t.otherBudget.reserve(SESSION, ACCOUNT, 0.6),
    ])
    expect(one.claimId).not.toBe(two.claimId)
    expect(JSON.parse(await readFile(claimFile(t.directory, one.claimId), 'utf8'))).toMatchObject({
      reservedUsd: '0.6',
    })
    expect(JSON.parse(await readFile(claimFile(t.directory, two.claimId), 'utf8'))).toMatchObject({
      reservedUsd: '0.6',
    })
    expect(() => one.check(1)).toThrow()
    expect(() => two.check(1)).toThrow()
    await expectSpent(t.otherBudget.read(SESSION, ACCOUNT), 1.2)
    await one.settle(0)
    await expectSpent(t.budget.read(SESSION, ACCOUNT), 0.6)
    await two.settle(0)
    await expect(t.budget.read(SESSION, ACCOUNT)).resolves.toMatchObject({ spentUsd: '0' })
    expect(await readdir(path.join(scope(t.directory), 'claims'))).toHaveLength(2)
  })

  it('keeps the previously admitted request and lets a later owner refund only its own row', async () => {
    const t = await setup()
    const earlier = await t.budget.reserve(SESSION, ACCOUNT, 0.6)
    expect(earlier.check(1).spentUsd).toBe('0.6')
    const later = await t.otherBudget.reserve(SESSION, ACCOUNT, 0.6)
    expect(() => later.check(1)).toThrow()
    await later.settle(0)
    expect(earlier.check(1).spentUsd).toBe('0.6')
    expect(
      JSON.parse(await readFile(claimFile(t.directory, earlier.claimId), 'utf8')),
    ).toMatchObject({ reservedUsd: '0.6' })
    await earlier.settle(0.2)
    await expectSpent(t.otherBudget.read(SESSION, ACCOUNT), 0.2)
  })

  it('refuses final admission until a newly owned row finishes its atomic publication', async () => {
    const t = await setup()
    await t.budget.read(SESSION, ACCOUNT)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const held = storeAt(t.directory, {
      rename: async (from, to) => {
        if (path.basename(to) === 'claim.json') {
          entered.resolve(undefined)
          await release.promise
        }
        await rename(from, to)
      },
    })
    const reserving = budgetOf(held).reserve(SESSION, ACCOUNT, 0.4)
    try {
      await entered.promise
      await expect(t.otherBudget.read(SESSION, ACCOUNT)).rejects.toThrow(
        UI_TEXT.sessionBudgetStoreUnavailable,
      )
    } finally {
      release.resolve(undefined)
    }
    const published = await reserving
    expect(published.check(1).spentUsd).toBe('0.4')
  })

  it('retains an unsettled request across new hosts and raw-session removal', async () => {
    const t = await setup()
    await t.budget.reserve(SESSION, ACCOUNT, 0.7)
    await t.first.remove(SESSION)
    const restarted = budgetOf(storeAt(t.directory))
    await expectSpent(restarted.read(SESSION, ACCOUNT), 0.7)
    expect(await t.second.load(SESSION)).toBeUndefined()
  })

  it('settles exactly once, permits the identical retry, and rejects reuse of a closed request', async () => {
    const t = await setup()
    const claim = await t.budget.reserve(SESSION, ACCOUNT, 0.8)
    await expectSpent(claim.settle(0.3), 0.3)
    await expectSpent(claim.settle(0.3), 0.3)
    await expect(claim.settle(0)).rejects.toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    expect(() => claim.check(1)).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    await expectSpent(t.otherBudget.read(SESSION, ACCOUNT), 0.3)
  })

  it('rejects admission and a different settlement while its own atomic settle is pending', async () => {
    const t = await setup()
    await t.budget.read(SESSION, ACCOUNT)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let isSettling = false
    const held = storeAt(t.directory, {
      rename: async (from, to) => {
        if (isSettling && path.basename(to) === 'claim.json') {
          entered.resolve(undefined)
          await release.promise
        }
        await rename(from, to)
      },
    })
    const claim = await budgetOf(held).reserve(SESSION, ACCOUNT, 0.8)
    isSettling = true
    const closing = claim.settle(0.2)
    try {
      await entered.promise
      expect(() => claim.check(1)).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
      await expect(claim.settle(0)).rejects.toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
      await expectSpent(t.otherBudget.read(SESSION, ACCOUNT), 0.8)
    } finally {
      release.resolve(undefined)
    }
    await expectSpent(closing, 0.2)
  })

  it('refuses a row whose owner changed, without refunding another owner’s liability', async () => {
    const t = await setup()
    const claim = await t.budget.reserve(SESSION, ACCOUNT, 0.4)
    const file = claimFile(t.directory, claim.claimId)
    const raw: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('expected claim object')
    }
    await writeFile(
      file,
      JSON.stringify({ ...raw, ownerId: '11111111-1111-4111-8111-111111111111' }),
    )
    await expect(claim.settle(0)).rejects.toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    expect(() => claim.check(1)).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    await expectSpent(t.otherBudget.read(SESSION, ACCOUNT), 0.4)
  })

  it('checks the current cap synchronously without removing an owned liability', async () => {
    const t = await setup()
    const claim = await t.budget.reserve(SESSION, ACCOUNT, 0.6)
    expect(claim.check(1).spentUsd).toBe('0.6')
    expect(() => claim.check(0.5)).toThrow()
    expect(claim.check(0).spentUsd).toBe('0.6')
    await expectSpent(t.otherBudget.read(SESSION, ACCOUNT), 0.6)
  })

  it('projects authoritative spend over stale saves, refunds and reported actual overages', async () => {
    const t = await setup(snapshot({ budgetSpentUsd: 2 }))
    const claim = await t.budget.reserve(SESSION, ACCOUNT, 1)
    await t.second.save(snapshot({ budgetSpentUsd: 0 }))
    await expect(t.second.load(SESSION)).resolves.toMatchObject({ budgetSpentUsd: '3' })
    await claim.settle(1.5)
    await t.first.save(snapshot({ budgetSpentUsd: 99 }))
    await expect(readRaw(t.directory)).resolves.toMatchObject({ budgetSpentUsd: '3.5' })
    await expect(t.budget.read(SESSION, ACCOUNT)).resolves.toMatchObject({ spentUsd: '3.5' })
  })

  it('seeds fresh legacy spend and unknown fee evidence before a direct stale save erases rows', async () => {
    const t = await setup(snapshot({ budgetSpentUsd: 4, children: [paidChild('imageGeneration')] }))
    await t.second.save(snapshot({ budgetSpentUsd: 1, children: [] }))
    expect(await t.budget.read(SESSION, ACCOUNT)).toEqual({
      spentUsd: '4',
      hasUnknownHistoricalFees: true,
    })
    await expect(readRaw(t.directory)).resolves.toMatchObject({ budgetSpentUsd: '4' })
    const claim = await t.budget.reserve(SESSION, ACCOUNT, 0.1)
    expect(() => claim.check(10)).toThrow(UI_TEXT.sessionBudgetLegacyFeesUnknown)
    expect(claim.check(0).hasUnknownHistoricalFees).toBe(true)
  })

  it('seeds a newly saved account-owned session before its first request', async () => {
    const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-budget-new-')))
    folders.push(directory)
    const store = storeAt(directory)
    await store.save(snapshot())
    expect(
      JSON.parse(await readFile(path.join(scope(directory), 'seed.json'), 'utf8')),
    ).toMatchObject({
      sessionId: SESSION,
      accountId: ACCOUNT,
      spentUsd: '0',
    })
    expect(await budgetOf(store).read(SESSION, ACCOUNT)).toEqual({
      spentUsd: '0',
      hasUnknownHistoricalFees: false,
    })
  })

  it.each(['webSearch', 'imageGeneration'] as const)(
    'never invents a zero historical total for %s in a child',
    async (paid) => {
      const t = await setup(snapshot({ children: [paidChild(paid)] }))
      await expect(t.budget.read(SESSION, ACCOUNT)).resolves.toMatchObject({
        hasUnknownHistoricalFees: true,
      })
      await t.first.save(snapshot({ transcript: [], children: [] }))
      await expect(t.otherBudget.read(SESSION, ACCOUNT)).resolves.toMatchObject({
        hasUnknownHistoricalFees: true,
      })
    },
  )

  it('recognizes missing historical token spend without double-counting a parent’s recorded child spend', async () => {
    const usage = { inputTokens: 100, outputTokens: 10, cachedTokens: 0, reasoningTokens: 0 }
    const child = paidChild('webSearch')
    const tokenChild: StoredChild = {
      ...child,
      session: snapshot({ sessionId: 'child-session', budgetSpentUsd: undefined, usage }),
    }
    const missing = await setup(snapshot({ budgetSpentUsd: undefined, children: [tokenChild] }))
    await expect(missing.budget.read(SESSION, ACCOUNT)).resolves.toMatchObject({
      hasUnknownHistoricalFees: true,
    })
    const recorded = await setup(snapshot({ budgetSpentUsd: 3, usage, children: [tokenChild] }))
    expect(await recorded.budget.read(SESSION, ACCOUNT)).toEqual({
      spentUsd: '3',
      hasUnknownHistoricalFees: false,
    })
  })

  it('seeds only an explicitly fresh zero-spend fork and never reseeds it on repeated loads or stale saves', async () => {
    const initial = snapshot({
      budgetIsFreshFork: true,
      forkedFrom: 'parent-session',
      children: [paidChild('imageGeneration')],
    })
    const t = await setup(initial)
    const firstLoad = await t.first.load(SESSION)
    expect(firstLoad?.budgetIsFreshFork).toBeUndefined()
    expect(await t.budget.read(SESSION, ACCOUNT)).toEqual({
      spentUsd: '0',
      hasUnknownHistoricalFees: false,
    })
    await t.budget.record(SESSION, ACCOUNT, 0.3)
    await t.second.save(initial)
    await expectStoredSpend(t.second, 0.3)
    const stored = await readRaw(t.directory)
    expect(stored.budgetIsFreshFork).toBeUndefined()
    expect(await t.otherBudget.read(SESSION, ACCOUNT)).toEqual({
      spentUsd: '0.3',
      hasUnknownHistoricalFees: false,
    })
  })

  it('does not infer fresh provenance from a legacy zero balance and forkedFrom alone', async () => {
    const t = await setup(
      snapshot({ forkedFrom: 'parent-session', children: [paidChild('webSearch')] }),
    )
    await expect(t.budget.read(SESSION, ACCOUNT)).resolves.toMatchObject({
      hasUnknownHistoricalFees: true,
    })
  })

  it.each([
    { forkedFrom: undefined, budgetSpentUsd: 0 },
    { forkedFrom: '', budgetSpentUsd: 0 },
    { forkedFrom: ' ', budgetSpentUsd: 0 },
    { forkedFrom: '/outside', budgetSpentUsd: 0 },
    { forkedFrom: 'parent-session', budgetSpentUsd: undefined },
    { forkedFrom: 'parent-session', budgetSpentUsd: 1 },
  ])(
    'refuses mismatched fresh-fork provenance %j rather than silently dropping historical fees',
    async (provenance) => {
      const t = await setup(
        snapshot({
          budgetIsFreshFork: true,
          ...provenance,
          children: [paidChild('imageGeneration')],
        }),
      )
      await expect(t.budget.read(SESSION, ACCOUNT)).rejects.toThrow(
        UI_TEXT.sessionBudgetStoreUnavailable,
      )
    },
  )

  it('refuses a malformed fresh-fork marker through the real session-file decoder', async () => {
    const t = await setup()
    await writeFile(
      path.join(t.directory, `${SESSION}.json`),
      JSON.stringify({
        ...snapshot(),
        forkedFrom: 'parent-session',
        budgetIsFreshFork: false,
      }),
    )
    await expect(t.budget.read(SESSION, ACCOUNT)).rejects.toThrow(
      UI_TEXT.sessionBudgetStoreUnavailable,
    )
  })

  it('rereads the authoritative raw file after owning the one-time initialization intent', async () => {
    const t = await setup(snapshot({ budgetSpentUsd: 1 }))
    let reads = 0
    const journal = createSessionBudgetJournal({
      directory: t.directory,
      sleep: () => Promise.resolve(),
      loadSession: async () => {
        const current = await readRaw(t.directory)
        reads += 1
        if (reads === 1) {
          await writeRaw(t.directory, snapshot({ budgetSpentUsd: 5 }))
        }
        return current
      },
    })
    await expect(journal.read(SESSION, ACCOUNT)).resolves.toMatchObject({ spentUsd: '5' })
    expect(reads).toBe(2)
  })

  it.each(['seed', 'claim', 'scope', 'claims-directory'])(
    'fails closed on missing %s without reseeding from a stale snapshot',
    async (missing) => {
      const t = await setup(snapshot({ budgetSpentUsd: 2 }))
      const claim = await t.budget.reserve(SESSION, ACCOUNT, 0.4)
      const target = missingTarget(t.directory, claim.claimId, missing)
      await removeOwnedTree(t.directory, target)
      await writeRaw(t.directory, snapshot({ budgetSpentUsd: 0 }))
      await expect(t.otherBudget.read(SESSION, ACCOUNT)).rejects.toThrow(
        UI_TEXT.sessionBudgetStoreUnavailable,
      )
      expect(() => claim.check(10)).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    },
  )

  it.each(['seed', 'claim'])('fails closed on a corrupt %s payload', async (corrupt) => {
    const t = await setup()
    const claim = await t.budget.reserve(SESSION, ACCOUNT, 0.2)
    await writeFile(
      corrupt === 'seed'
        ? path.join(scope(t.directory), 'seed.json')
        : claimFile(t.directory, claim.claimId),
      '{bad json',
    )
    await expect(t.otherBudget.read(SESSION, ACCOUNT)).rejects.toThrow(
      UI_TEXT.sessionBudgetStoreUnavailable,
    )
    expect(() => claim.check(0)).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
  })

  it('fails closed when a payload cannot be read as a file', async () => {
    const t = await setup()
    const claim = await t.budget.reserve(SESSION, ACCOUNT, 0.2)
    const file = claimFile(t.directory, claim.claimId)
    await rm(file)
    await mkdir(file)
    await expect(t.otherBudget.read(SESSION, ACCOUNT)).rejects.toThrow(
      UI_TEXT.sessionBudgetStoreUnavailable,
    )
  })

  it('retains a failed initialization intent and never retries it as a fresh zero seed', async () => {
    const t = await setup(snapshot({ budgetSpentUsd: 3 }))
    const blocked = storeAt(t.directory, {
      rename: async (from, to) => {
        if (path.basename(to) === 'seed.json') {
          throw Object.assign(new Error('injected ENOSPC'), { code: 'ENOSPC' })
        }
        await rename(from, to)
      },
    })
    await expect(budgetOf(blocked).read(SESSION, ACCOUNT)).rejects.toThrow(
      UI_TEXT.sessionBudgetStoreUnavailable,
    )
    await writeRaw(t.directory, snapshot({ budgetSpentUsd: 0 }))
    await expect(t.otherBudget.read(SESSION, ACCOUNT)).rejects.toThrow(
      UI_TEXT.sessionBudgetStoreUnavailable,
    )
  })

  it('fails to admit or refund through storage failure while keeping the original request liability', async () => {
    const t = await setup()
    await t.budget.read(SESSION, ACCOUNT)
    let isBlocked = false
    const failing = storeAt(t.directory, {
      rename: async (from, to) => {
        if (isBlocked && path.basename(to) === 'claim.json') {
          throw Object.assign(new Error('injected ENOSPC'), { code: 'ENOSPC' })
        }
        await rename(from, to)
      },
    })
    const claim = await budgetOf(failing).reserve(SESSION, ACCOUNT, 0.5)
    isBlocked = true
    await expect(claim.settle(0)).rejects.toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    await expectSpent(t.otherBudget.read(SESSION, ACCOUNT), 0.5)
    isBlocked = false
    await expect(claim.settle(0)).resolves.toMatchObject({ spentUsd: '0' })
  })

  it.each(['before publication', 'after publication'])(
    'refunds only its known nonsent row when reserve fails %s, while rejecting the call',
    async (when) => {
      const t = await setup()
      const earlier = await t.budget.reserve(SESSION, ACCOUNT, 0.3)
      const failing = storeAt(t.directory, {
        rename: publicationFailure(when === 'after publication'),
      })
      await expect(budgetOf(failing).reserve(SESSION, ACCOUNT, 0.4)).rejects.toThrow(
        UI_TEXT.sessionBudgetStoreUnavailable,
      )
      await expectSpent(t.otherBudget.read(SESSION, ACCOUNT), 0.3)
      expect(earlier.check(1).spentUsd).toBe('0.3')
      expect(await readdir(path.join(scope(t.directory), 'claims'))).toHaveLength(2)
    },
  )

  it('keeps an incomplete owned intent blocking if both publication and its nonsent refund fail', async () => {
    const t = await setup()
    await t.budget.read(SESSION, ACCOUNT)
    const failing = storeAt(t.directory, {
      rename: publicationFailure(false, true),
    })
    await expect(budgetOf(failing).reserve(SESSION, ACCOUNT, 0.4)).rejects.toThrow(
      UI_TEXT.sessionBudgetStoreUnavailable,
    )
    await expect(t.otherBudget.read(SESSION, ACCOUNT)).rejects.toThrow(
      UI_TEXT.sessionBudgetStoreUnavailable,
    )
    expect(await readdir(path.join(scope(t.directory), 'claims'))).toHaveLength(1)
  })

  it('rejects a different account or a missing raw session before creating a new ledger', async () => {
    const t = await setup(snapshot({ budgetSpentUsd: 2 }))
    await expect(t.budget.read(SESSION, OTHER_ACCOUNT)).rejects.toThrow(
      UI_TEXT.sessionBudgetStoreUnavailable,
    )
    await expect(t.budget.read('missing-session', ACCOUNT)).rejects.toThrow(
      UI_TEXT.sessionBudgetStoreUnavailable,
    )
    await expect(
      t.second.save(snapshot({ accountId: OTHER_ACCOUNT, budgetSpentUsd: 0 })),
    ).rejects.toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    await expect(readRaw(t.directory)).resolves.toMatchObject({ budgetSpentUsd: '2' })
  })

  it('never overwrites an existing legacy balance when metadata access is denied', async () => {
    const t = await setup(snapshot({ budgetSpentUsd: 3 }))
    // The first stat of save is the existing raw session's metadata.
    const denied = vi
      .spyOn(fs, 'stat')
      .mockRejectedValueOnce(Object.assign(new Error('injected EACCES'), { code: 'EACCES' }))
    try {
      await expect(t.first.save(snapshot({ budgetSpentUsd: 0 }))).rejects.toThrow(
        UI_TEXT.sessionBudgetStoreUnavailable,
      )
    } finally {
      denied.mockRestore()
    }
    await expect(readRaw(t.directory)).resolves.toMatchObject({ budgetSpentUsd: '3' })
  })

  it.each([-1, NaN, Infinity])(
    'refuses an invalid reservation or settlement amount %s',
    async (cost) => {
      const t = await setup()
      await expect(t.budget.reserve(SESSION, ACCOUNT, cost)).rejects.toThrow(
        UI_TEXT.sessionBudgetStoreUnavailable,
      )
      const claim = await t.budget.reserve(SESSION, ACCOUNT, 0.3)
      await expect(claim.settle(cost)).rejects.toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
      await expectSpent(t.otherBudget.read(SESSION, ACCOUNT), 0.3)
    },
  )

  it('records known fees once per owned entry alongside settled requests', async () => {
    const t = await setup()
    const claim = await t.budget.reserve(SESSION, ACCOUNT, 0.6)
    await claim.settle(0.2)
    await expectSpent(t.otherBudget.record(SESSION, ACCOUNT, 0.4), 0.6)
    await expectSpent(t.budget.record(SESSION, ACCOUNT, 0.1), 0.7)
    await expectStoredSpend(t.first, 0.7)
  })

  it('keeps an uncapped unknown-model cost marked unknown after stale saves and future capped claims', async () => {
    const t = await setup()
    expect(await t.budget.record(SESSION, ACCOUNT, 0.2, true)).toEqual({
      spentUsd: '0.2',
      hasUnknownHistoricalFees: true,
    })
    await t.second.save(snapshot({ budgetSpentUsd: 0 }))
    const claim = await t.otherBudget.reserve(SESSION, ACCOUNT, 0.1)
    expect(() => claim.check(1)).toThrow(UI_TEXT.sessionBudgetLegacyFeesUnknown)
    expect(claim.check(0).hasUnknownHistoricalFees).toBe(true)
    await expectStoredSpend(t.first, 0.3)
  })

  it('blocks finite admission behind another host’s open uncapped request until known usage settles', async () => {
    const t = await setup()
    const uncapped = await t.budget.reserve(SESSION, ACCOUNT, 0, { isUnbounded: true })
    expect(uncapped.check(0)).toEqual({ spentUsd: '0', hasUnknownHistoricalFees: true })
    const capped = await t.otherBudget.reserve(SESSION, ACCOUNT, 0.1)
    expect(() => capped.check(1)).toThrow(UI_TEXT.sessionBudgetLegacyFeesUnknown)
    await uncapped.settle(0.2, false)
    expect(capped.check(1).hasUnknownHistoricalFees).toBe(false)
    await expectSpent(t.otherBudget.read(SESSION, ACCOUNT), 0.3)
  })

  it('keeps ambiguous retries permanently unknown after the known tail settles', async () => {
    const t = await setup()
    const claim = await t.budget.reserve(SESSION, ACCOUNT, 0, { isUnbounded: true })
    await expect(claim.settle(0.2, true)).resolves.toMatchObject({ hasUnknownHistoricalFees: true })
    await expect(claim.settle(0.2, true)).resolves.toMatchObject({ hasUnknownHistoricalFees: true })
    await expect(claim.settle(0.2, false)).rejects.toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    const next = await t.otherBudget.reserve(SESSION, ACCOUNT, 0.1)
    expect(() => next.check(1)).toThrow(UI_TEXT.sessionBudgetLegacyFeesUnknown)
  })

  it('clears only a proven nonsent owner’s unbounded uncertainty on its zero refund', async () => {
    const t = await setup()
    const claim = await t.budget.reserve(SESSION, ACCOUNT, 0, {
      isUnbounded: true,
      hasUnknownCost: true,
    })
    await claim.settle(0, false)
    const next = await t.otherBudget.reserve(SESSION, ACCOUNT, 0.1)
    expect(next.check(1)).toEqual({ spentUsd: '0.1', hasUnknownHistoricalFees: false })
  })

  it('closes a failed uncapped publication as proven nonsent without retaining its unknown flag', async () => {
    const t = await setup()
    await t.budget.read(SESSION, ACCOUNT)
    const failing = storeAt(t.directory, {
      rename: publicationFailure(false),
    })
    await expect(
      budgetOf(failing).reserve(SESSION, ACCOUNT, 0, { isUnbounded: true, hasUnknownCost: true }),
    ).rejects.toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    expect(await t.otherBudget.read(SESSION, ACCOUNT)).toEqual({
      spentUsd: '0',
      hasUnknownHistoricalFees: false,
    })
  })

  it('never refunds an already-billed record after its payload publishes with a late failure', async () => {
    const t = await setup()
    await t.budget.read(SESSION, ACCOUNT)
    let hasFailed = false
    const failing = storeAt(t.directory, {
      rename: async (from, to) => {
        await rename(from, to)
        if (hasFailed || path.basename(to) !== 'claim.json') {
          return
        }
        hasFailed = true
        throw Object.assign(new Error('injected ENOSPC after charge publication'), {
          code: 'ENOSPC',
        })
      },
    })
    await expect(budgetOf(failing).record(SESSION, ACCOUNT, 0.4)).rejects.toThrow(
      UI_TEXT.sessionBudgetStoreUnavailable,
    )
    await expectSpent(t.otherBudget.read(SESSION, ACCOUNT), 0.4)
  })
})
