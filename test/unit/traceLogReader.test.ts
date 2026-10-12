// The trace reader through the real module and real temporary folders:
// per-caller cutoffs, per-file states, listing order, the line splitter
// and the carried summary. No stand-in file system; every behaviour here
// is a file a person could leave behind.
import { chmodSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createTraceLineSplitter,
  createTraceLogReader,
  summarizeTraceRead,
  traceLogDirectory,
  type TraceFileRecord,
  type TraceListing,
} from '../../src/runtime/usage/traceLogs'
import { removeFolder } from './helpers/temporaryFolders'

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) {
    chmodSync(folder, 0o755)
    await removeFolder(folder)
  }
})

function tempTraceHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), 'muse-trace-reader-'))
  folders.push(home)
  mkdirSync(traceLogDirectory({ homeDir: home }), { recursive: true })
  return home
}

function traceFile(home: string, name: string): string {
  return path.join(traceLogDirectory({ homeDir: home }), name)
}

const admission = (at: string, runId: string): string =>
  `${at} INFO tbh.local.model x event="model.attempt.lifecycle" run_id="${runId}" attempt_id="a" task_id="t" phase="admission" outcome="accepted"\n`

function localDay(nowMs: number): string {
  const day = new Date(nowMs)
  const month = String(day.getMonth() + 1).padStart(2, '0')
  const date = String(day.getDate()).padStart(2, '0')
  return `${String(day.getFullYear())}-${month}-${date}`
}

const emptyFacts = (): TraceFileRecord['facts'] => ({
  firstMs: undefined,
  lastMs: undefined,
  attempts: [],
  runs: new Map(),
})

function listedRecord(
  state: TraceFileRecord['state'],
  reason: TraceFileRecord['reason'],
): TraceFileRecord {
  return { file: '/logs/cli-x.log', size: 10, mtimeNs: '1', facts: emptyFacts(), state, reason }
}

function testListing(outcome: TraceListing['outcome'], reason: string): TraceListing {
  return { entries: [], outcome, reason }
}

describe('trace reader over real log folders', () => {
  it('gives two concurrent reads their own cutoffs, in both start orders', async () => {
    for (const isTodayFirst of [true, false]) {
      const home = tempTraceHome()
      const nowMs = Date.now()
      writeFileSync(
        traceFile(home, 'cli-new.log'),
        admission(new Date(nowMs).toISOString(), 'new-run'),
      )
      // Three days ago: inside the insights backstop, before today's range.
      const oldAt = new Date(nowMs - 3 * 24 * 60 * 60 * 1000)
      const oldFile = traceFile(home, 'cli-old.log')
      writeFileSync(oldFile, admission(oldAt.toISOString(), 'old-run'))
      utimesSync(oldFile, oldAt, oldAt)
      const reader = createTraceLogReader({ homeDir: home })
      const first = isTodayFirst
        ? reader.readSummary(nowMs, localDay(nowMs))
        : reader.readSummary(nowMs)
      const second = isTodayFirst
        ? reader.readSummary(nowMs)
        : reader.readSummary(nowMs, localDay(nowMs))
      const [firstSummary, secondSummary] = await Promise.all([first, second])
      const todaySummary = isTodayFirst ? firstSummary : secondSummary
      const fullSummary = isTodayFirst ? secondSummary : firstSummary
      // The page's today range sees only the new log; the backstop read
      // that joined it still sees both. Neither caller narrowed the other.
      expect(todaySummary.records).toHaveLength(1)
      expect(todaySummary.facts.flatMap((facts) => facts.attempts)).toHaveLength(1)
      expect(fullSummary.records).toHaveLength(2)
      expect(fullSummary.facts.flatMap((facts) => facts.attempts)).toHaveLength(2)
      expect(todaySummary.state).toBe('ok')
    }
  })

  it('keeps a record with a stated state for every listed file', async () => {
    const home = tempTraceHome()
    const nowMs = Date.now()
    writeFileSync(
      traceFile(home, 'cli-good.log'),
      admission(new Date(nowMs).toISOString(), 'good-run'),
    )
    const lineCount = 64_000
    writeFileSync(
      traceFile(home, 'cli-big.log'),
      admission('2026-01-01T00:00:00.000Z', 'big-run').repeat(lineCount),
    )
    const deniedFile = traceFile(home, 'cli-denied.log')
    writeFileSync(deniedFile, admission(new Date(nowMs).toISOString(), 'denied-run'))
    chmodSync(deniedFile, 0o000)
    try {
      const summary = await createTraceLogReader({ homeDir: home }).readSummary(nowMs)
      const byName = new Map(summary.records.map((record) => [path.basename(record.file), record]))
      expect(byName.get('cli-good.log')?.state).toBe('fresh')
      // Over the size cap is never dropped: the within-limit lines stand,
      // so attempts already shown never vanish when the file grows.
      const big = byName.get('cli-big.log')
      expect(big?.state).toBe('oversize')
      expect(big?.facts.attempts.length).toBeGreaterThan(0)
      // Denied with no earlier good parse is unreadable, never silence.
      const denied = byName.get('cli-denied.log')
      expect(denied?.state).toBe('unreadable')
      expect(denied?.reason).toBe('denied')
      expect(summary.state).toBe('behind')
      expect(summary.reasons).toContain('over-limit')
      expect(summary.reasons).toContain('denied')
    } finally {
      chmodSync(deniedFile, 0o644)
    }
  })

  it('lists newest first with a fixed name tie-break, and names an unreadable folder', async () => {
    const home = tempTraceHome()
    const nowMs = Date.now()
    for (const name of ['cli-c.log', 'cli-a.log', 'cli-b.log']) {
      writeFileSync(traceFile(home, name), admission('2026-01-01T00:00:00.000Z', name))
    }
    const tied = new Date('2026-02-01T00:00:00.000Z')
    for (const name of ['cli-c.log', 'cli-a.log', 'cli-b.log'])
      utimesSync(traceFile(home, name), tied, tied)
    writeFileSync(
      traceFile(home, 'cli-new.log'),
      admission(new Date(nowMs).toISOString(), 'new-run'),
    )
    const summary = await createTraceLogReader({ homeDir: home }).readSummary(nowMs)
    expect(summary.records.map((record) => path.basename(record.file))).toEqual([
      'cli-new.log',
      'cli-a.log',
      'cli-b.log',
      'cli-c.log',
    ])

    const closedHome = tempTraceHome()
    const closedDirectory = traceLogDirectory({ homeDir: closedHome })
    chmodSync(closedDirectory, 0o000)
    try {
      const closed = await createTraceLogReader({ homeDir: closedHome }).readSummary(nowMs)
      expect(closed.listing.outcome).toBe('failed')
      expect(closed.state).toBe('unavailable')
      expect(closed.empty).toBe(false)
    } finally {
      chmodSync(closedDirectory, 0o755)
    }
  })

  it('carries one summary value to every surface, empty only when no file was found', () => {
    // The "no logs" sentence is reachable only through a listing that
    // succeeded and found no file: never from an error.
    expect(summarizeTraceRead([], testListing('empty', 'no-files'))).toMatchObject({
      state: 'ok',
      empty: true,
    })
    // A missing folder is also "no file yet" (a new user has no log
    // directory); an error listing is never empty.
    expect(summarizeTraceRead([], testListing('missing', 'no-directory'))).toMatchObject({
      state: 'ok',
      empty: true,
    })
    expect(summarizeTraceRead([], testListing('failed', 'EACCES'))).toMatchObject({
      state: 'unavailable',
      empty: false,
      reasons: ['EACCES'],
    })
    const mixed = summarizeTraceRead(
      [listedRecord('fresh', 'current'), listedRecord('oversize', 'over-limit')],
      testListing('ok', 'current'),
    )
    expect(mixed).toMatchObject({ state: 'behind', empty: false, reasons: ['over-limit'] })
    expect(mixed.facts).toHaveLength(2)
    expect(
      summarizeTraceRead([listedRecord('unreadable', 'denied')], testListing('ok', 'current'))
        .state,
    ).toBe('unavailable')
  })

  it('scans each byte for its newline once, across chunk splits and line endings', () => {
    const seen: string[] = []
    const splitter = createTraceLineSplitter((line) => {
      seen.push(line)
    })
    const longLine = 'x'.repeat(8 * 1024 * 1024)
    const text = `${longLine}\nend\n`
    const chunkSize = 64 * 1024
    for (let index = 0; index < text.length; index += chunkSize) {
      splitter.push(text.slice(index, index + chunkSize))
    }
    splitter.finish()
    expect(seen).toEqual([longLine, 'end'])
    expect(splitter.scannedBytes).toBe(text.length)

    const mixed: string[] = []
    const second = createTraceLineSplitter((line) => {
      mixed.push(line)
    })
    // A CR split across chunks is the first half of a CRLF; a lone CR
    // stays inside its line; the unterminated tail is not a line yet.
    second.push('a\r')
    second.push('\nb\rc\npartial')
    second.finish()
    expect(mixed).toEqual(['a', 'b\rc'])
  })
})
