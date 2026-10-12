import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { USAGE_JOURNAL_ROOT, UsageJournalStore } from '../../src/core/usage/journalStore'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import { withholdReviverSource } from './helpers/withholdReviverSource'
import { INEXACT_MONEY_LITERALS } from './helpers/inexactMoneyLiterals'
import { createUsageAccess } from '../../src/runtime/usage/usageServiceEntry'
import { EN } from '../../src/shared/l10n/en'
import { plural, setUiText } from '../../src/shared/l10n/text'
import { USAGE_TEXT, setUsageText } from '../../src/shared/l10n/usageTable'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { FakeLogOutputChannel } from './helpers/fakes'
import { traceAttemptsLive } from './helpers/usageTraceFixture'

// M121: the usage journal moves from version 1 (JSON-number dollars) to
// version 2 (exact decimal text). The fixture is a real journal written by
// 0.17.0's (8f0a75ea1) writer and rollup, unchanged: 2026-08-20 already rolled
// into rollups/2026-08.json (micro-dollar rounded, as 0.17 stored it), and
// 2026-08-25 and 2026-10-04 are raw day files.
const FIXTURE = fileURLToPath(new URL('../fixtures/m121/usage-v1', import.meta.url))
const NOW = new Date(2026, 9, 5, 12).getTime()
const RAW_DAY = `${USAGE_JOURNAL_ROOT}/days/2026-10-04/w017.jsonl`
const OLD_DAY = `${USAGE_JOURNAL_ROOT}/days/2026-08-25/w017.jsonl`
const ROLLUP = `${USAGE_JOURNAL_ROOT}/rollups/2026-08.json`

afterEach(() => {
  setUiText(EN, 'en')
  setUsageText(USAGE_EN)
})

function accessFor(root: string, locale = 'en') {
  return createUsageAccess({
    dataFolder: root,
    packageRoot: fileURLToPath(new URL('../../', import.meta.url)),
    host: 'M121',
    locale,
    uiText: EN,
    log: new FakeLogOutputChannel(),
    live: traceAttemptsLive(root),
  })
}

async function rig() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'm121-usage-')))
  onTestFinished(async () => {
    await rm(root, { recursive: true, force: true })
  })
  await cp(FIXTURE, root, { recursive: true })
  const store = new UsageJournalStore(new NodeUsageFs(root), {
    writerId: 'm121',
    now: () => NOW,
    isEnabled: () => true,
    onWriteError: vi.fn(),
  })
  return { root, store }
}

async function refusesReviewerDollar() {
  const { root, store } = await rig()
  const raw = await readFile(path.join(root, RAW_DAY), 'utf8')
  const line = raw.split('\n').find((text) => text.includes('"id":"r20"'))!
  // Digits past a double: JSON.parse would round them to 0.12345678901234568.
  const edited = line
    .replace('"id":"r20"', '"id":"r99"')
    .replace('"usd":0.123456789', '"usd":0.123456789012345678901')
  await writeFile(path.join(root, RAW_DAY), `${edited}\n`, { flag: 'a' })
  const journal = await store.read()
  expect(journal.inexactRecords).toBe(1)
  expect(journal.invalidLines).toBe(0)
  expect(journal.records.map((record) => record.id)).not.toContain('r99')
  return { root, store, journal }
}

describe('usage journal version 1 to version 2 (M121)', () => {
  it('withholds exotic literals through the real store and shows the refusal notice (RVM121B)', async () => {
    const { root, store } = await rig()
    const original = await readFile(path.join(root, RAW_DAY), 'utf8')
    const line = original.split('\n').find((text) => text.includes('"id":"r20"'))!
    const edits = INEXACT_MONEY_LITERALS.map((literal, index) =>
      line
        .replace('"id":"r20"', () => `"id":"exotic-${String(index)}"`)
        .replace('"usd":0.123456789', () => `"usd":${literal}`),
    ).join('\n')
    const bytes = `${original}${edits}\n`
    await writeFile(path.join(root, RAW_DAY), bytes)
    const journal = await store.read()
    expect(journal).toMatchObject({
      inexactRecords: INEXACT_MONEY_LITERALS.length,
      invalidLines: 0,
    })
    expect(journal.records.some((record) => record.id.startsWith('exotic-'))).toBe(false)
    const access = accessFor(root)
    const state = await access.read({ range: '30d', groupBy: 'provider', metric: 'cost' })
    expect(state.history.inexactRecords).toBe(INEXACT_MONEY_LITERALS.length)
    expect(access.usageText(state, 'plain', 'summary')).toContain(
      plural(USAGE_TEXT.inexactRecords, INEXACT_MONEY_LITERALS.length),
    )
    expect(await readFile(path.join(root, RAW_DAY), 'utf8')).toBe(bytes)
  })

  it.each(
    ['"usd":0.000162', '"apiEquivalentUsd":0.000838'].flatMap((field) =>
      ['1e400', '-1e-3', '1e-324', '-0'].map((literal) => [field, literal]),
    ),
  )(
    'refuses rollup %s replaced by %s before money validation (RVM121CG)',
    async (field, literal) => {
      const { root, store } = await rig()
      const file = path.join(root, ROLLUP)
      const original = await readFile(file, 'utf8')
      const bytes = original.replace(field, () => `${field.split(':', 2)[0]!}:${literal}`)
      expect(bytes).not.toBe(original)
      await writeFile(file, bytes)
      const journal = await store.read()
      expect(journal).toMatchObject({ inexactRecords: 9, invalidLines: 0 })
      expect(journal.rollups).toEqual([])
      expect(journal.records).toHaveLength(16)
      // Cached reads and retention also refuse the month without losing days.
      expect(await store.read()).toEqual(journal)
      expect(await store.retain()).toBe(false)
      const access = accessFor(root, 'de')
      const state = await access.read({ range: '30d', groupBy: 'provider', metric: 'cost' })
      expect(state.history.inexactRecords).toBe(9)
      const notice = plural(USAGE_TEXT.inexactRecords, 9)
      expect(notice).not.toBe(plural(USAGE_EN.inexactRecords, 9))
      expect(access.usageText(state, 'plain', 'summary')).toContain(notice)
      expect(await readFile(file, 'utf8')).toBe(bytes)
    },
  )

  it('reads every 0.17 dollar as the exact decimal it was written as, without touching the files', async () => {
    const { root, store } = await rig()
    const before = await Promise.all(
      [RAW_DAY, OLD_DAY, ROLLUP].map((file) => readFile(path.join(root, file))),
    )
    const journal = await store.read()
    expect(journal).toMatchObject({ inexactRecords: 0, invalidLines: 0, newerVersionRecords: 0 })
    const costs = Object.fromEntries(
      journal.records.filter((record) => record.day === '2026-10-04').map((r) => [r.id, r.cost]),
    )
    expect(costs).toEqual({
      c18: { usd: '0.00016', certainty: 'computed', source: 'list', date: '2026-09-01' },
      c19: { usd: '0.0000017', certainty: 'computed', source: 'list', date: '2026-09-01' },
      r20: { usd: '0.123456789', certainty: 'reported' },
      x21: { usd: '0.0023184', certainty: 'reported' },
      p22: { certainty: 'plan', apiEquivalentUsd: '0.0008375' },
      l23: { usd: '0', certainty: 'local' },
      s24: { usd: '0.0075', certainty: 'computed', source: 'meta-published', date: '2026-09-24' },
      u25: { usd: '0.0005', certainty: 'uncertain' },
    })
    // Typed as version 2; the stored version 1 really is rewritten on read.
    expect(new Set(journal.records.map((record) => String(record.v)))).toEqual(new Set(['2']))
    expect(journal.limits.map((limit) => [limit.v, limit.account])).toContainEqual([
      2,
      { usedUsd: '1.1', limitUsd: '10', remainingUsd: '8.9', period: 'month' },
    ])
    expect(journal.rollups.map((row) => [row.provider, row.kind, row.cost])).toEqual([
      ['openai', 'turn', { usd: '0.000162', certainty: 'computed' }],
      ['openrouter', 'turn', { usd: '0.123457', certainty: 'reported' }],
      ['xai', 'turn', { usd: '0.002318', certainty: 'reported' }],
      ['meta', 'turn', { certainty: 'plan', apiEquivalentUsd: '0.000838' }],
      ['ollama', 'turn', { usd: '0', certainty: 'local' }],
      ['openai', 'search', { usd: '0.0075', certainty: 'computed' }],
      ['openai', 'turn', { usd: '0.0005', certainty: 'uncertain' }],
    ])
    const after = await Promise.all(
      [RAW_DAY, OLD_DAY, ROLLUP].map((file) => readFile(path.join(root, file))),
    )
    expect(after).toEqual(before)
  })

  it('retention writes the merged month as version 2, keeping old rows and new days exact', async () => {
    const { root, store } = await rig()
    expect(await store.retain()).toBe(true)
    const month: unknown = JSON.parse(await readFile(path.join(root, ROLLUP), 'utf8'))
    expect(month).toMatchObject({ v: 2, month: '2026-08', days: ['2026-08-20', '2026-08-25'] })
    const journal = await store.read()
    expect(journal.inexactRecords).toBe(0)
    const openRouter = journal.rollups
      .filter((row) => row.provider === 'openrouter')
      .map((row) => [row.day, row.cost.usd])
    // 0.17 rolled 2026-08-20 to micro-dollars; 2026-08-25 now rolls up exactly.
    expect(openRouter).toEqual([
      ['2026-08-20', '0.123457'],
      ['2026-08-25', '0.123456789'],
    ])
    expect(new Set(journal.limits.map((limit) => String(limit.v)))).toEqual(new Set(['2']))
    expect(journal.records.filter((record) => record.day === '2026-10-04')).toHaveLength(8)
  })

  it('refuses the reviewer literal with the reviver source withheld (Node 20)', async () => {
    // The refusal must not depend on the reviver (M121 P2-1).
    const restore = withholdReviverSource()
    try {
      await refusesReviewerDollar()
    } finally {
      restore()
    }
  })

  it('refuses a version 1 dollar a number cannot carry, counts it and never rewrites it', async () => {
    const { root, store, journal } = await refusesReviewerDollar()
    expect(journal.recordCount).toBe(journal.records.length + journal.limits.length + 8 + 1)

    const rollupText = await readFile(path.join(root, ROLLUP), 'utf8')
    await writeFile(
      path.join(root, ROLLUP),
      rollupText.replace('"usd":0.123457', '"usd":0.123457000000000000001'),
    )
    const refused = await store.read()
    // The whole month (8 records and 1 limit snapshot) is withheld, not rounded.
    expect(refused.rollups).toEqual([])
    expect(refused.inexactRecords).toBe(1 + 9)
    expect(await store.retain()).toBe(false)
    expect(await readFile(path.join(root, ROLLUP), 'utf8')).toContain('0.123457000000000000001')
  })
})
