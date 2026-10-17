import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { createSessionBudgetJournal } from '../../src/host/backend/sessionBudgetJournal'
import { type StoredSession } from '../../src/core/backends/modelapi/sessionStore'
import { Usd } from '../../src/shared/usd'
import { removeFolder, filesUnder } from './helpers/temporaryFolders'
import { withoutCredentials } from '../../src/runtime/credentialVariables'
const ACCOUNT = 'a'.repeat(64)
const SESSION = 'session-1'
const roots: string[] = []
const money = (value: number | string) => Usd.from(value).toAmount()
function directory() {
  const root = mkdtempSync(path.join(tmpdir(), 'spend-journal-'))
  roots.push(root)
  return root
}
function journal(root: string) {
  return createSessionBudgetJournal({
    directory: root,
    sleep: delay,
    initialBudget: () => Promise.resolve({ spentUsd: money(0), hasUnknownHistoricalFees: false }),
  })
}
function capturedLegacy(root: string, count: number, version = 2) {
  const old = path.join(root, 'budget-journal', ACCOUNT, SESSION)
  mkdirSync(path.join(old, 'claims'), { recursive: true })
  mkdirSync(path.join(root, 'budget-intents', ACCOUNT, SESSION), { recursive: true })
  const scopeId = randomUUID()
  writeFileSync(
    path.join(old, 'seed.json'),
    JSON.stringify({
      version,
      scopeId,
      sessionId: SESSION,
      accountId: ACCOUNT,
      spentUsd: version === 1 ? 0 : '0',
      hasUnknownHistoricalFees: false,
    }),
  )
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const claimId = randomUUID()
    ids.push(claimId)
    const folder = path.join(old, 'claims', claimId)
    mkdirSync(folder)
    writeFileSync(
      path.join(folder, 'claim.json'),
      JSON.stringify({
        version,
        scopeId,
        claimId,
        ownerId: randomUUID(),
        ownerPid: process.pid,
        ownerStartMs: Math.round(Date.now() - process.uptime() * 1000),
        hasUnboundedCost: false,
        sessionId: SESSION,
        accountId: ACCOUNT,
        reservedUsd: version === 1 ? 0.01 : '0.01',
        settledUsd: version === 1 ? 0.005 : '0.005',
        hasUnknownCost: false,
      }),
    )
  }
  return { old, ids }
}
const require = createRequire(import.meta.url)
const oldApiSchema = z.object({
  createSessionBudgetJournal: z.custom<
    (deps: {
      directory: string
      sleep: (ms: number) => Promise<void>
      initialBudget: () => Promise<{ spentUsd: string; hasUnknownHistoricalFees: boolean }>
    }) => { read: (session: string, account: string) => Promise<{ spentUsd: string | number }> }
  >((value) => typeof value === 'function'),
})
const oldReaderPort: { factory?: z.infer<typeof oldApiSchema>['createSessionBudgetJournal'] } = {}
// Building the captured old reader bundles the full constants table with
// esbuild: a genuinely long one-off build, not per-test work.
const BUILD_HOOK_TIMEOUT_MS = 60_000
// Writing and reading the lead's 556-row legacy fixture is thousands of
// real file operations; removing it afterwards is the same again.
const FIXTURE_HOOK_TIMEOUT_MS = 60_000
beforeAll(async () => {
  const out = path.join(directory(), 'old.cjs')
  const source = execFileSync(
    'git',
    ['show', '87d9ab91c:src/host/backend/sessionBudgetJournal.ts'],
    { encoding: 'utf8', env: withoutCredentials(process.env) },
  )
  await build({
    stdin: { contents: source, resolveDir: path.resolve('src/host/backend'), loader: 'ts' },
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [
      {
        name: 'captured-legacy-constants',
        setup(context) {
          context.onResolve({ filter: /shared\/constants$/ }, (args) =>
            args.importer === '<stdin>'
              ? { path: 'legacy-constants', namespace: 'captured' }
              : undefined,
          )
          context.onLoad({ filter: /.*/, namespace: 'captured' }, () => ({
            contents: `export * from ${JSON.stringify(path.resolve('src/shared/constants.ts'))}; export const DAILY_BUDGET_LOCK_ATTEMPTS=100;`,
            loader: 'ts',
            resolveDir: process.cwd(),
          }))
        },
      },
    ],
  })
  oldReaderPort.factory = oldApiSchema.parse(require(out)).createSessionBudgetJournal
}, BUILD_HOOK_TIMEOUT_MS)
afterAll(async () => {
  for (const root of roots) await removeFolder(root)
}, FIXTURE_HOOK_TIMEOUT_MS)
describe('session adapter and captured old data', () => {
  describe.each([1, 2])('captured v%i migration', (version) => {
    let root = ''
    let old = ''
    let oldBefore: string | number = 0
    const before = new Map<string, string>()
    let oldReader: ReturnType<NonNullable<typeof oldReaderPort.factory>> | undefined
    beforeAll(async () => {
      root = directory()
      old = capturedLegacy(root, 556, version).old
      for (const file of filesUnder(old)) before.set(file, readFileSync(file, 'utf8'))
      const factory = oldReaderPort.factory
      if (factory === undefined) throw new Error('old reader not built')
      oldReader = factory({
        directory: root,
        sleep: delay,
        initialBudget: () => Promise.resolve({ spentUsd: '0', hasUnknownHistoricalFees: false }),
      })
      const initialOldTotal = await oldReader.read(SESSION, ACCOUNT)
      oldBefore = initialOldTotal.spentUsd
    }, FIXTURE_HOOK_TIMEOUT_MS)
    it('migrates 556 rows once without changing old-reader totals or files', async () => {
      if (oldReader === undefined) throw new Error('old reader not initialized')
      const fresh = journal(root)
      expect(await fresh.read(SESSION, ACCOUNT)).toMatchObject({ spentUsd: '2.78' })
      const claim = await fresh.reserve(SESSION, ACCOUNT, money('0.1'), money(3))
      await claim.settle(money('0.02'))
      expect(await journal(root).read(SESSION, ACCOUNT)).toMatchObject({ spentUsd: '2.8' })
      const oldAfter = await oldReader.read(SESSION, ACCOUNT)
      expect(Usd.from(oldAfter.spentUsd).toString()).toBe(Usd.from(oldBefore).toString())
      for (const [file, text] of before) expect(readFileSync(file, 'utf8')).toBe(text)
    })
  })
  it('keeps ownerless reservations indefinitely rather than closing by age', async () => {
    const root = directory()
    const { old, ids } = capturedLegacy(root, 1)
    const file = path.join(old, 'claims', ids[0] ?? '', 'claim.json')
    const row = z.object({ reservedUsd: z.string() }).parse(JSON.parse(readFileSync(file, 'utf8')))
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    const captured = z
      .object({
        version: z.number(),
        scopeId: z.string(),
        claimId: z.string(),
        ownerId: z.string(),
        sessionId: z.string(),
        accountId: z.string(),
      })
      .parse(raw)
    writeFileSync(file, JSON.stringify({ ...captured, reservedUsd: row.reservedUsd }))
    const first = journal(root)
    expect(await first.read(SESSION, ACCOUNT)).toMatchObject({
      spentUsd: '0.01',
      hasBoundedUnknownCost: true,
    })
    expect(await journal(root).read(SESSION, ACCOUNT)).toMatchObject({ spentUsd: '0.01' })
  })
  it('rejects malformed old claims instead of treating them as in-progress publication', async () => {
    const root = directory()
    const { old, ids } = capturedLegacy(root, 1)
    writeFileSync(path.join(old, 'claims', ids[0] ?? '', 'claim.json'), '{')
    await expect(journal(root).read(SESSION, ACCOUNT)).rejects.toMatchObject({
      kind: 'damaged',
      facts: { file: 'legacy journal' },
    })
  })
  it('shared caps admit every fitting claim without a post-publication race', async () => {
    const root = directory()
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => journal(root).reserve(SESSION, ACCOUNT, money(1), money(2))),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2)
    expect(await journal(root).read(SESSION, ACCOUNT)).toMatchObject({ spentUsd: '2' })
  })
  it('projects authoritative spend onto stored session snapshots', async () => {
    const root = directory()
    const snapshot: StoredSession = {
      version: 1,
      sessionId: SESSION,
      accountId: ACCOUNT,
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'allowAll',
      effort: 'high',
      createdAt: '2026-09-29T00:00:00Z',
      lastActivityAt: '2026-09-29T00:00:00Z',
      turnIds: [],
      todos: [],
      replay: [],
      transcript: [],
      outputs: {},
      usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
      budgetSpentUsd: money(0),
    }
    const budget = journal(root)
    const claim = await budget.reserve(SESSION, ACCOUNT, money(1), money(2))
    claim.markSent?.()
    await claim.settle(money('0.5'))
    expect(await budget.project(snapshot)).toMatchObject({ budgetSpentUsd: '0.5' })
  })
})
