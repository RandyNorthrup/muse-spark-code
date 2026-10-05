// The flight recorder, lane R (M93, PLAN.md D72): the portable policy in
// src/core/support/flightRecorder.ts and the journal/marker adapter in
// src/host/support/reportJournal.ts. Every guard below has a red drill in
// docs/certification/m93-r.md: the passing receipt here means nothing until
// the break was seen to fail.
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildFlightRecord,
  buildMarkerText,
  buildWebviewFlightRecord,
  flightMarkerSchema,
  flightRecordSchema,
  isStaleMarker,
  isTempName,
  journalNameFor,
  markerNameFor,
  parseJournalName,
  parseJournalText,
  parseMarkerName,
  parseMarkerText,
  pruneFlightEntries,
  serializeFlightRecord,
  type BuiltFlightRecord,
  type FlightEventInput,
  type FlightRecord,
  type ParsedJournal,
} from '../../src/core/support/flightRecorder'
import {
  nodeReportJournalFs,
  ReportJournal,
  type MergedJournal,
  type ReportDirEntry,
  type ReportEventInput,
  type ReportJournalFs,
  type ReportJournalOptions,
} from '../../src/host/support/reportJournal'
import {
  REPORT_JOURNAL_ENTRY_MAX_BYTES,
  REPORT_PACKAGE_FRAME_PATHS,
  REPORT_JOURNAL_MAX_BYTES,
  REPORT_RECENT_EVENT_COUNT,
  REPORT_STORAGE_DIR,
  REPORT_VERSION_MAX_CHARS,
} from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'

const EXT = '0.1.0'
const HOST = '1.99.0'
// A Model API key shape: the shared redaction table recognises it.
const SECRET = 'LLM_abcdefghijklmnop'

function event(overrides?: Partial<FlightEventInput>): FlightEventInput {
  return { kind: 'toolCallFailed', code: 'ENOENT', ext: EXT, host: HOST, ...overrides }
}

function frame(
  path: string,
  line = 12,
  column = 4,
): { path: string; line: number; column: number } {
  return { path, line, column }
}

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function storage(): Promise<string> {
  const root = path.resolve(import.meta.dirname, '../../temp/flight-recorder')
  await mkdir(root, { recursive: true })
  const dir = await mkdtemp(path.join(root, 'muse-flight-'))
  dirs.push(dir)
  return dir
}

function journal(
  dir: string,
  instance: string,
  overrides?: Partial<ReportJournalOptions>,
): { recorder: ReportJournal; log: FakeLogOutputChannel } {
  const log = new FakeLogOutputChannel()
  const recorder = new ReportJournal({
    globalStorageDir: dir,
    instance,
    ext: EXT,
    host: HOST,
    pid: 1001,
    log,
    isAlive: () => true,
    ...overrides,
  })
  return { recorder, log }
}

function warnings(log: FakeLogOutputChannel): string[] {
  const calls = log.warn.mock.calls
  return calls.map((call) => String(call[0]))
}

function failingFs(code: string): ReportJournalFs {
  const fail = (op: string): Promise<never> =>
    Promise.reject(Object.assign(new Error(`${op} failed`), { code }))
  return {
    mkdir: () => fail('mkdir'),
    readDir: () => fail('readDir'),
    readFile: () => fail('readFile'),
    appendFile: () => fail('appendFile'),
    writeTempAndRename: () => fail('writeTempAndRename'),
    remove: () => fail('remove'),
  }
}

/** An in-memory store for name-confinement tests (links, unexpected names). */
class MapFs implements ReportJournalFs {
  public readonly files = new Map<string, string>()
  public readonly links = new Set<string>()

  public mkdir(): Promise<void> {
    return Promise.resolve()
  }

  public readDir(dir: string): Promise<readonly ReportDirEntry[]> {
    const names = new Set<string>()
    for (const file of [...this.files.keys(), ...this.links]) {
      if (path.dirname(file) === dir) names.add(path.basename(file))
    }
    return Promise.resolve(
      [...names]
        .toSorted((left, right) => left.localeCompare(right))
        .map((name) => ({
          name,
          isFile: true,
          isSymbolicLink: this.links.has(path.join(dir, name)),
        })),
    )
  }

  public readFile(file: string): Promise<string> {
    const text = this.files.get(file)
    return text === undefined
      ? Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }))
      : Promise.resolve(text)
  }

  public appendFile(file: string, data: string): Promise<void> {
    this.files.set(file, (this.files.get(file) ?? '') + data)
    return Promise.resolve()
  }

  public writeTempAndRename(file: string, data: string): Promise<void> {
    this.files.set(file, data)
    return Promise.resolve()
  }

  public remove(file: string): Promise<void> {
    return this.files.delete(file)
      ? Promise.resolve()
      : Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }))
  }
}

function line(record: FlightRecord): string {
  return serializeFlightRecord(record).replace(/\n$/, '')
}

function valid(index: number): FlightRecord {
  const built = buildFlightRecord(event({ code: 'EIO', count: index }), 1000 + index)
  if (!built.ok) throw new Error('test record must build')
  return built.record
}

function at(index: number, timestamp: number): FlightRecord {
  const built = buildFlightRecord(event({ code: 'EIO', count: index }), timestamp)
  if (!built.ok) throw new Error('test record must build')
  return built.record
}

describe('lane-R storage tunables', () => {
  it('keeps journals in one global-storage folder with short version tokens', () => {
    expect(REPORT_STORAGE_DIR).toBe('reports')
    expect(REPORT_VERSION_MAX_CHARS).toBe(32)
  })
})

describe('buildFlightRecord', () => {
  it('builds a minimal valid record', () => {
    const built: BuiltFlightRecord = buildFlightRecord(event(), 1000)
    expect(built).toEqual({
      ok: true,
      record: {
        v: 1,
        kind: 'toolCallFailed',
        at: 1000,
        code: 'ENOENT',
        ext: EXT,
        host: HOST,
        frames: [],
      },
    })
  })

  it('keeps enums, counts, versions and verified frames', () => {
    const built = buildFlightRecord(
      event({
        kind: 'backendExit',
        backend: 'museCode',
        count: 3,
        frames: [frame('dist/extension.js')],
      }),
      2000,
    )
    expect(built.ok).toBe(true)
    if (!built.ok) {
      return
    }

    expect(built.record.backend).toBe('museCode')
    expect(built.record.count).toBe(3)
    expect(built.record.frames).toEqual([{ path: 'dist/extension.js', line: 12, column: 4 }])
  })

  it('maps an unknown code shape to the fixed unknown word', () => {
    for (const code of [
      'something went wrong',
      '',
      'https://example.com/x',
      'E seq',
      'A'.repeat(65),
    ]) {
      const built = buildFlightRecord(event({ code }), 1000)
      expect(built.ok).toBe(true)
      if (built.ok) expect(built.record.code).toBe('unknown')
    }
  })

  it('refuses unknown kinds, versions, backends and counts', () => {
    // Hostile kinds hold no ReportEventKind member; `as never` keeps the
    // refusal branch (PLAN.md §8) reachable from a typed test.
    expect(buildFlightRecord(event({ kind: 'nonsense' as never }), 1000)).toEqual({
      ok: false,
      reason: 'unknownKind',
    })
    expect(buildFlightRecord(event({ ext: `v ${SECRET}` }), 1000)).toEqual({
      ok: false,
      reason: 'badVersion',
    })
    // Likewise for a backend outside BACKEND_KINDS (PLAN.md §8).
    expect(buildFlightRecord(event({ backend: 'other' as never }), 1000)).toEqual({
      ok: false,
      reason: 'badBackend',
    })
    expect(buildFlightRecord(event({ count: -1 }), 1000)).toEqual({ ok: false, reason: 'badCount' })
    expect(buildFlightRecord(event({ count: 1.5 }), 1000)).toEqual({
      ok: false,
      reason: 'badCount',
    })
  })

  it('drops unverifiable frames but keeps the record', () => {
    const built = buildFlightRecord(
      event({
        frames: [
          frame('/absolute/root.js'),
          frame('C:/absolute/win.js'),
          frame('../escape.js'),
          frame('a/../../escape.js'),
          frame('https://example.com/x.js'),
          frame(String.raw`dist\windows.js`),
          frame(''),
          frame('a//b.js'),
          frame('./dotted.js'),
          frame('vscode-remote://host/x.js'),
          frame('dist/extension.js'),
        ],
      }),
      1000,
    )
    expect(built.ok).toBe(true)
    if (built.ok) {
      expect(built.record.frames).toEqual([{ path: 'dist/extension.js', line: 12, column: 4 }])
    }
  })

  it('truncates the stack to its first bounded frames', () => {
    const frames = Array.from({ length: 20 }, (_, index) => frame('dist/extension.js', index + 1))
    const built = buildFlightRecord(event({ frames }), 1000)
    expect(built.ok).toBe(true)
    if (!built.ok) {
      return
    }

    expect(built.record.frames).toHaveLength(16)
    expect(built.record.frames[0]).toEqual({ path: 'dist/extension.js', line: 1, column: 4 })
  })

  it('never lets a secret-shaped value land in a record', () => {
    const withSecretCode = buildFlightRecord(event({ code: `failed with ${SECRET}` }), 1000)
    expect(withSecretCode.ok).toBe(true)
    if (withSecretCode.ok) {
      expect(serializeFlightRecord(withSecretCode.record)).not.toContain(SECRET)
      expect(withSecretCode.record.code).toBe('unknown')
    }
    const withSecretFrame = buildFlightRecord(
      event({ frames: [frame(`dist/${SECRET}.js`), frame('dist/extension.js')] }),
      1000,
    )
    expect(withSecretFrame.ok).toBe(true)
    if (withSecretFrame.ok) {
      expect(serializeFlightRecord(withSecretFrame.record)).not.toContain(SECRET)
      expect(withSecretFrame.record.frames).toEqual([
        { path: 'dist/extension.js', line: 12, column: 4 },
      ])
    }
    expect(buildFlightRecord(event({ host: `home ${SECRET}` }), 1000)).toEqual({
      ok: false,
      reason: 'badVersion',
    })
  })

  it('refuses an oversize stored entry even when every parsed field is valid', () => {
    const built = buildFlightRecord(event(), 1000)
    if (!built.ok) throw new Error('test record must build')
    const line = `${' '.repeat(REPORT_JOURNAL_ENTRY_MAX_BYTES)}${serializeFlightRecord(built.record)}`
    expect(parseJournalText(line).entries).toEqual([])
  })
})

describe('buildWebviewFlightRecord', () => {
  it('records a lane-0 webview post', () => {
    const built = buildWebviewFlightRecord(
      {
        kind: 'windowError',
        source: 'window',
        code: 'TypeError',
        frames: [{ path: 'dist/webview/main.js', line: 3, column: 0 }],
      },
      { ext: EXT, host: HOST },
      1000,
    )
    expect(built.ok).toBe(true)
    if (!built.ok) {
      return
    }

    expect(built.record.kind).toBe('windowError')
    expect(built.record.code).toBe('TypeError')
    expect(built.record.frames).toEqual([{ path: 'dist/webview/main.js', line: 3, column: 0 }])
  })

  it('refuses host kinds, extra free-text fields and absolute frames', () => {
    const versions = { ext: EXT, host: HOST }
    expect(
      buildWebviewFlightRecord(
        { kind: 'backendExit', source: 'window', code: 'x', frames: [] },
        versions,
        1000,
      ),
    ).toEqual({ ok: false, reason: 'invalid' })
    expect(
      buildWebviewFlightRecord(
        {
          kind: 'windowError',
          source: 'window',
          code: 'x',
          frames: [],
          message: 'boom',
          stack: 'at x',
        },
        versions,
        1000,
      ),
    ).toEqual({ ok: false, reason: 'invalid' })
    const absolute = buildWebviewFlightRecord(
      {
        kind: 'windowError',
        source: 'window',
        code: 'x',
        frames: [{ path: '/etc/secret.js', line: 1, column: 0 }],
      },
      versions,
      1000,
    )
    expect(absolute.ok).toBe(true)
    if (absolute.ok) expect(absolute.record.frames).toEqual([])
  })
})

describe('flightRecordSchema', () => {
  it('refuses free-text event payloads', () => {
    const base = {
      v: 1,
      kind: 'toolCallFailed',
      at: 1000,
      code: 'ENOENT',
      ext: EXT,
      host: HOST,
      frames: [],
    }
    for (const extra of [
      { message: 'boom' },
      { stack: 'at x (y:1:2)' },
      { prompt: 'do the thing' },
      { sessionId: 'abc' },
      { kind: 'madeUp' },
      { v: 2 },
    ]) {
      expect(flightRecordSchema.safeParse({ ...base, ...extra }).success).toBe(false)
    }
    expect(flightRecordSchema.safeParse(base).success).toBe(true)
  })
})

describe('parseJournalText', () => {
  it('parses valid lines and counts nothing on a clean file', () => {
    const parsed: ParsedJournal = parseJournalText(`${line(valid(0))}\n${line(valid(1))}\n`)
    expect(parsed.entries).toHaveLength(2)
    expect(parsed.skipped).toBe(0)
    expect(parsed.torn).toBe(false)
  })

  it('skips truncated tails and tampered records without trusting them', () => {
    const good = line(valid(0))
    const tampered = JSON.stringify({ ...valid(1), message: 'injected', at: 1001 })
    const wrongVersion = JSON.stringify({ ...valid(2), v: 999, at: 1002 })
    const freeTextCode = JSON.stringify({
      ...valid(3),
      code: 'a text sentence with spaces',
      at: 1003,
    })
    const freeTextVersion = JSON.stringify({ ...valid(4), ext: 'version one point oh', at: 1004 })
    const outsideFrame = JSON.stringify({
      ...valid(5),
      at: 1005,
      frames: [{ path: '/etc/secret.js', line: 1, column: 0 }],
    })
    const oversize = `{"v":1,"kind":"errorNotice","at":1006,"code":"x","ext":"${EXT}","host":"${HOST}","frames":[],"pad":"${'y'.repeat(REPORT_JOURNAL_ENTRY_MAX_BYTES)}"}`
    const parsed = parseJournalText(
      `${good}\nnot json\n${tampered}\n${wrongVersion}\n${freeTextCode}\n${freeTextVersion}\n${outsideFrame}\n${oversize}\n{"torn": tru`,
    )
    expect(parsed.entries.map((entry) => entry.code)).toEqual(['EIO'])
    expect(parsed.skipped).toBe(7)
    expect(parsed.torn).toBe(true)
  })

  it('reads an empty file as empty', () => {
    expect(parseJournalText('')).toEqual({ entries: [], skipped: 0, torn: false })
  })
})

describe('pruneFlightEntries', () => {
  it('drops entries past the retention age but keeps the boundary', () => {
    const now = 8 * 24 * 60 * 60 * 1000
    const age = 7 * 24 * 60 * 60 * 1000
    const pruned = pruneFlightEntries([at(0, now - age - 1), at(1, now - age), at(2, now)], now)
    expect(pruned.map((entry) => entry.count ?? -1)).toEqual([1, 2])
  })

  it('evicts oldest first past the byte cap without mutating the input', () => {
    const frames = Array.from({ length: 16 }, (_, index) =>
      frame('dist/museCodeReviewer.js', index + 1),
    )
    const entries: FlightRecord[] = []
    for (let index = 0; index < 320; index += 1) {
      const built = buildFlightRecord(event({ code: 'EIO', count: index, frames }), index)
      if (built.ok) entries.push(built.record)
    }
    expect(entries.length).toBeGreaterThan(64)
    const pruned = pruneFlightEntries(entries, 100_000)
    const bytes = pruned.map((entry) => Buffer.byteLength(serializeFlightRecord(entry), 'utf8'))
    const total = bytes.reduce((a, b) => a + b, 0)
    expect(total).toBeLessThanOrEqual(REPORT_JOURNAL_MAX_BYTES)
    expect(entries).toHaveLength(320)
    expect(pruned[0]?.count).toBeGreaterThan(0)
    const indexes = pruned.map((entry) => entry.count ?? -1)
    const ordered = indexes.toSorted((a, b) => a - b)
    expect(indexes).toEqual(ordered)
  })
})

describe('journal and marker names', () => {
  it('names one journal and marker per instance and parses them back', () => {
    expect(journalNameFor('a1b2c3')).toBe('journal-a1b2c3.jsonl')
    expect(markerNameFor('a1b2c3')).toBe('marker-a1b2c3.json')
    expect(parseJournalName('journal-a1b2c3.jsonl')).toBe('a1b2c3')
    expect(parseMarkerName('marker-a1b2c3.json')).toBe('a1b2c3')
  })

  it('refuses traversal and unexpected names', () => {
    expect(journalNameFor('../escape')).toBeUndefined()
    expect(journalNameFor('')).toBeUndefined()
    expect(markerNameFor('a/b')).toBeUndefined()
    expect(parseJournalName('journal-../escape.jsonl')).toBeUndefined()
    expect(parseJournalName('journal-a1b2c3.json')).toBeUndefined()
    expect(parseJournalName('notes.txt')).toBeUndefined()
    expect(parseMarkerName('marker-a1b2c3.jsonl')).toBeUndefined()
    expect(parseMarkerName('marker-a1b2c3.json.tmp-1')).toBeUndefined()
    expect(isTempName('journal-a.jsonl.tmp-123')).toBe(true)
    expect(isTempName('journal-a.jsonl')).toBe(false)
    expect(
      () =>
        new ReportJournal({
          globalStorageDir: 'x',
          instance: '../escape',
          ext: EXT,
          host: HOST,
          pid: 1,
          log: new FakeLogOutputChannel(),
          isAlive: () => true,
        }),
    ).toThrow()
  })
})

describe('flight markers', () => {
  it('round-trips a marker and validates its schema', () => {
    const text = buildMarkerText('window-1', 4242, 1000)
    expect(text).toBe('{"v":1,"instance":"window-1","pid":4242,"at":1000}\n')
    expect(parseMarkerText('marker-window-1.json', text ?? '')).toEqual({
      v: 1,
      instance: 'window-1',
      pid: 4242,
      at: 1000,
    })
    expect(
      flightMarkerSchema.safeParse({ v: 1, instance: 'w', pid: 1, at: 1, pid2: 2 }).success,
    ).toBe(false)
  })

  it('rejects unowned, garbled and mistyped markers without offering', () => {
    expect(parseMarkerText('marker-a.json', 'not json')).toBeUndefined()
    expect(
      parseMarkerText('marker-a.json', '{"v":1,"instance":"b","pid":1,"at":1}'),
    ).toBeUndefined()
    expect(
      parseMarkerText('marker-a.json', '{"v":2,"instance":"a","pid":1,"at":1}'),
    ).toBeUndefined()
    expect(
      parseMarkerText('notes.txt', '{"v":1,"instance":"notes","pid":1,"at":1}'),
    ).toBeUndefined()
    expect(buildMarkerText('../x', 1, 1)).toBeUndefined()
  })

  it('treats only another dead instance as a crash', () => {
    const marker = parseMarkerText('marker-dead.json', buildMarkerText('dead', 111, 1000) ?? '')
    if (marker === undefined) throw new Error('test marker must parse')
    expect(isStaleMarker(marker, 'live', (pid) => pid !== 111)).toBe(true)
    expect(isStaleMarker(marker, 'live', () => true)).toBe(false)
    expect(isStaleMarker(marker, 'dead', (pid) => pid !== 111)).toBe(false)
  })
})

describe('ReportJournal recording', () => {
  it('appends scrubbed records under global storage and reads them back', async () => {
    const dir = await storage()
    const { recorder } = journal(dir, 'window-a')
    expect(await recorder.startup()).toEqual({ offerReport: false })
    // The adapter stamps its own versions: call sites carry no ext or host.
    const first: ReportEventInput = {
      kind: 'toolCallFailed',
      code: 'EACCES',
      frames: [frame('dist/extension.js', 7, 0)],
    }
    await recorder.record(first)
    await recorder.record({ kind: 'errorNotice', code: 'failed badly' })
    const raw = await readFile(path.join(dir, REPORT_STORAGE_DIR, 'journal-window-a.jsonl'), 'utf8')
    expect(raw.split('\n').filter((line) => line !== '')).toHaveLength(2)
    const merged: MergedJournal = await recorder.readMerged()
    expect(merged.total).toBe(2)
    expect(merged.skipped).toBe(0)
    expect(merged.entries.map((entry) => entry.code)).toEqual(['EACCES', 'unknown'])
    expect(merged.entries.map((entry) => [entry.ext, entry.host])).toEqual([
      [EXT, HOST],
      [EXT, HOST],
    ])
    expect(merged.entries[1]?.at).toBeGreaterThanOrEqual(merged.entries[0]?.at ?? 0)
  })

  it('keeps secrets off the disk even when the caller passes them', async () => {
    const dir = await storage()
    const { recorder } = journal(dir, 'window-a')
    await recorder.startup()
    await recorder.record(event({ code: `token ${SECRET} here` }))
    await recorder.record(event({ frames: [frame(`dist/${SECRET}.js`)] }))
    const raw = await readFile(path.join(dir, REPORT_STORAGE_DIR, 'journal-window-a.jsonl'), 'utf8')
    expect(raw).not.toContain(SECRET)
    const merged = await recorder.readMerged()
    expect(merged.entries.map((entry) => entry.code)).toEqual(['unknown', 'ENOENT'])
    expect(merged.entries[1]?.frames).toEqual([])
  })

  it('drops refused records without writing or warning', async () => {
    const dir = await storage()
    const { recorder, log } = journal(dir, 'window-a')
    await recorder.startup()
    await recorder.record(event({ count: -1 }))
    const merged = await recorder.readMerged()
    expect(merged.total).toBe(0)
    expect(warnings(log)).toEqual([])
  })

  it('caps merged reads at the recent-entry default', async () => {
    const dir = await storage()
    const stamped = Date.now()
    const lines: string[] = []
    for (let index = 0; index < REPORT_RECENT_EVENT_COUNT + 5; index += 1) {
      const built = buildFlightRecord(event({ count: index }), stamped)
      if (!built.ok) throw new Error('test record must build')
      lines.push(serializeFlightRecord(built.record))
    }
    await mkdir(path.join(dir, REPORT_STORAGE_DIR), { recursive: true })
    await writeFile(path.join(dir, REPORT_STORAGE_DIR, 'journal-window-a.jsonl'), lines.join(''))
    const { recorder } = journal(dir, 'window-a')
    await recorder.startup()
    const merged = await recorder.readMerged()
    expect(merged.total).toBe(REPORT_RECENT_EVENT_COUNT + 5)
    expect(merged.entries).toHaveLength(REPORT_RECENT_EVENT_COUNT)
    expect(merged.entries[0]?.count).toBe(5)
  })

  it('prunes aged entries on read and deletes the emptied file', async () => {
    const dir = await storage()
    const oldNow = 1000
    const { recorder } = journal(dir, 'window-a', { now: () => oldNow })
    await recorder.startup()
    await recorder.record(event({}))
    await recorder.shutdown()
    const fresh = journal(dir, 'window-b', { now: () => oldNow + 8 * 24 * 60 * 60 * 1000 })
    await fresh.recorder.startup()
    const merged = await fresh.recorder.readMerged()
    expect(merged.total).toBe(0)
    expect(merged.entries).toEqual([])
    await expect(
      readFile(path.join(dir, REPORT_STORAGE_DIR, 'journal-window-a.jsonl'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('R11 evicts the oldest entries past the byte cap on actual appends', async () => {
    const store = new MapFs()
    const { recorder } = journal('mem', 'window-a', { fs: store, now: () => 100_000 })
    expect(await recorder.startup()).toEqual({ offerReport: false })
    const frames = Array.from({ length: 16 }, (_, index) =>
      frame('dist/museCodeReviewer.js', index + 1),
    )
    for (let index = 0; index < 320; index += 1) {
      await recorder.record(event({ code: 'EIO', count: index, frames }))
    }
    // Inspect physical bytes before a report read can mask missing append pruning.
    const raw =
      store.files.get(path.join('mem', REPORT_STORAGE_DIR, 'journal-window-a.jsonl')) ?? ''
    expect(Buffer.byteLength(raw, 'utf8')).toBeLessThanOrEqual(REPORT_JOURNAL_MAX_BYTES)
    const parsed = parseJournalText(raw)
    expect(parsed.entries[0]?.count).toBeGreaterThan(0)
    expect(parsed.entries.at(-1)?.count).toBe(319)
  })
})

describe('ReportJournal crash markers', () => {
  it('offers once after a simulated crash and remembers the dismissal', async () => {
    const dir = await storage()
    const crashed = journal(dir, 'crashed', { pid: 2001, isAlive: () => false })
    expect(await crashed.recorder.startup()).toEqual({ offerReport: false })
    // No shutdown: the window died mid-activation.
    const next = journal(dir, 'next', { pid: 2002, isAlive: (pid) => pid !== 2001 })
    expect(await next.recorder.startup()).toEqual({ offerReport: true })
    await next.recorder.shutdown()
    // The stale marker was consumed by the offer: the same dead window
    // offers nothing more.
    const reread = journal(dir, 'reread', { pid: 2006, isAlive: (pid) => pid !== 2001 })
    expect(await reread.recorder.startup()).toEqual({ offerReport: false })
    await reread.recorder.shutdown()
    const later = journal(dir, 'later', { pid: 2003, isAlive: () => true })
    expect(await later.recorder.startup()).toEqual({ offerReport: false })
    await later.recorder.shutdown()
    // A new abnormal exit produces a new offer.
    const crashedAgain = journal(dir, 'crashed-again', { pid: 2004, isAlive: () => true })
    await crashedAgain.recorder.startup()
    const after = journal(dir, 'after', { pid: 2005, isAlive: (pid) => pid !== 2004 })
    expect(await after.recorder.startup()).toEqual({ offerReport: true })
    await after.recorder.shutdown()
  })

  it('offers nothing after a clean deactivate', async () => {
    const dir = await storage()
    const first = journal(dir, 'first', { pid: 2001, isAlive: () => false })
    await first.recorder.startup()
    await first.recorder.shutdown()
    const second = journal(dir, 'second', { pid: 2002, isAlive: (pid) => pid !== 2001 })
    expect(await second.recorder.startup()).toEqual({ offerReport: false })
    await second.recorder.shutdown()
  })

  it('never reports a second live window as a crash', async () => {
    const dir = await storage()
    const left = journal(dir, 'left', { pid: 2001, isAlive: () => true })
    await left.recorder.startup()
    const right = journal(dir, 'right', { pid: 2002, isAlive: () => true })
    expect(await right.recorder.startup()).toEqual({ offerReport: false })
    const raw = await readFile(path.join(dir, REPORT_STORAGE_DIR, 'marker-left.json'), 'utf8')
    expect(parseMarkerText('marker-left.json', raw)?.pid).toBe(2001)
    await left.recorder.shutdown()
    await right.recorder.shutdown()
  })

  it('consumes garbage markers without offering', async () => {
    const dir = await storage()
    await mkdir(path.join(dir, REPORT_STORAGE_DIR), { recursive: true })
    await writeFile(path.join(dir, REPORT_STORAGE_DIR, 'marker-garbage.json'), 'not json')
    await writeFile(
      path.join(dir, REPORT_STORAGE_DIR, 'marker-liar.json'),
      '{"v":1,"instance":"someone-else","pid":1,"at":1}',
    )
    const { recorder } = journal(dir, 'window-a', { pid: 2002, isAlive: () => false })
    expect(await recorder.startup()).toEqual({ offerReport: false })
    await recorder.shutdown()
  })

  it('sweeps crash-left atomic-write stages at startup', async () => {
    const dir = await storage()
    await mkdir(path.join(dir, REPORT_STORAGE_DIR), { recursive: true })
    await writeFile(path.join(dir, REPORT_STORAGE_DIR, 'journal-window-a.jsonl.tmp-999'), 'junk')
    const { recorder } = journal(dir, 'window-a', { isAlive: () => false })
    await recorder.startup()
    await expect(
      readFile(path.join(dir, REPORT_STORAGE_DIR, 'journal-window-a.jsonl.tmp-999'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await recorder.shutdown()
  })
})

describe('ReportJournal windows', () => {
  it('merges two windows writing concurrently without corrupting either file', async () => {
    const dir = await storage()
    const left = journal(dir, 'left', { pid: 2001, isAlive: () => true, fs: nodeReportJournalFs })
    const right = journal(dir, 'right', { pid: 2002, isAlive: () => true })
    await left.recorder.startup()
    await right.recorder.startup()
    await Promise.all([
      ...Array.from({ length: 10 }, (_, index) =>
        left.recorder.record(event({ kind: 'backendExit', count: index })),
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        right.recorder.record(event({ kind: 'windowError', count: index })),
      ),
    ])
    const merged = await right.recorder.readMerged()
    expect(merged.total).toBe(20)
    expect(merged.skipped).toBe(0)
    expect(merged.entries.filter((entry) => entry.kind === 'backendExit')).toHaveLength(10)
    expect(merged.entries.filter((entry) => entry.kind === 'windowError')).toHaveLength(10)
    for (const instance of ['left', 'right']) {
      const raw = await readFile(
        path.join(dir, REPORT_STORAGE_DIR, `journal-${instance}.jsonl`),
        'utf8',
      )
      const parsed = parseJournalText(raw)
      expect(parsed.skipped).toBe(0)
      expect(parsed.torn).toBe(false)
      expect(parsed.entries).toHaveLength(10)
    }
    await left.recorder.shutdown()
    await right.recorder.shutdown()
  })

  it('keeps a reload or new chat reading the retained entries', async () => {
    const dir = await storage()
    const before = journal(dir, 'before')
    await before.recorder.startup()
    await before.recorder.record(event({ code: 'EIO' }))
    // Reload: a new instance in the same storage reads what survived.
    const after = journal(dir, 'after')
    await after.recorder.startup()
    const merged = await after.recorder.readMerged()
    expect(merged.entries.map((entry) => entry.code)).toEqual(['EIO'])
    await before.recorder.shutdown()
    await after.recorder.shutdown()
  })

  it('reads only owned files: links, directories and strange names stay out', async () => {
    const store = new MapFs()
    const dir = path.join('mem', REPORT_STORAGE_DIR)
    const good = buildFlightRecord(event({ code: 'EIO' }), Date.now())
    if (!good.ok) throw new Error('test record must build')
    store.files.set(path.join(dir, 'journal-good.jsonl'), serializeFlightRecord(good.record))
    store.files.set(path.join(dir, 'notes.txt'), `session id ${SECRET}`)
    store.files.set(path.join(dir, 'journal-evil.jsonl'), 'not json')
    store.links.add(path.join(dir, 'journal-link.jsonl'))
    const { recorder } = journal('mem', 'reader', { fs: store, isAlive: () => true })
    expect(await recorder.startup()).toEqual({ offerReport: false })
    const merged = await recorder.readMerged()
    expect(merged.total).toBe(1)
    expect(merged.entries.map((entry) => entry.code)).toEqual(['EIO'])
    expect(merged.skipped).toBe(0)
    await recorder.shutdown()
  })
})

describe('ReportJournal storage failure', () => {
  it('makes recording a no-op with one logged warning and never throws', async () => {
    const { recorder, log } = journal('nowhere', 'window-a', { fs: failingFs('EACCES') })
    expect(await recorder.startup()).toEqual({ offerReport: false })
    expect(recorder.isAvailable).toBe(false)
    await recorder.record(event({}))
    await recorder.record(event({}))
    expect(await recorder.readMerged()).toEqual({ entries: [], total: 0, skipped: 0 })
    await recorder.shutdown()
    // A second startup on the dead store stays quiet too.
    expect(await recorder.startup()).toEqual({ offerReport: false })
    const seen = warnings(log)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('EACCES')
    expect(seen[0]).not.toContain('nowhere')
  })

  it('goes quiet with one warning when the disk fills mid-run', async () => {
    class FullFs extends MapFs {
      public override appendFile(): Promise<void> {
        return Promise.reject(Object.assign(new Error('full'), { code: 'ENOSPC' }))
      }
    }
    const { recorder, log } = journal('mem', 'window-a', { fs: new FullFs() })
    expect(await recorder.startup()).toEqual({ offerReport: false })
    expect(recorder.isAvailable).toBe(true)
    await recorder.record(event({}))
    expect(recorder.isAvailable).toBe(false)
    await recorder.record(event({}))
    const seen = warnings(log)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('ENOSPC')
    await recorder.shutdown()
  })
})

describe('RVM93R regressions', () => {
  it('R1 maps arbitrary token codes to unknown and rejects secret-shaped stored fields', () => {
    const input = {
      kind: 'windowError',
      source: 'window',
      code: 'CONFIDENTIAL_PROMPT_WORD',
      frames: [],
    }
    const built = buildWebviewFlightRecord(input, { ext: EXT, host: HOST }, 1000)
    expect(built.ok && built.record.code).toBe('unknown')
    const good = buildFlightRecord(event(), 1000)
    if (!good.ok) throw new Error('test record must build')
    for (const field of ['code', 'ext', 'host']) {
      const parsed = parseJournalText(`${JSON.stringify({ ...good.record, [field]: SECRET })}\n`)
      expect(parsed.entries).toEqual([])
      expect(parsed.skipped).toBe(1)
    }
  })

  it('R2 rejects free text and non-package frames on write and read', () => {
    const paths = [
      'private-file-contents\nmodel output sentinels',
      'src/private-user.js',
      'dist/extension.js?private',
      'dist/extension.js#private',
      'dist/unknown.js',
    ]
    const built = buildWebviewFlightRecord(
      {
        kind: 'windowError',
        source: 'window',
        code: 'TypeError',
        frames: paths.map((name) => frame(name)),
      },
      { ext: EXT, host: HOST },
      1000,
    )
    expect(built.ok && built.record.frames).toEqual([])
    const good = buildFlightRecord(event(), 1000)
    if (!good.ok) throw new Error('test record must build')
    for (const name of paths) {
      expect(
        parseJournalText(serializeFlightRecord({ ...good.record, frames: [frame(name)] })).entries,
      ).toEqual([])
    }
  })

  it('R2 verifies the frame vocabulary against the shipped extension package', async () => {
    const manifest = await readFile(
      path.resolve(import.meta.dirname, '../../.vscodeignore'),
      'utf8',
    )
    const packaged = manifest
      .split('\n')
      .filter((name) => name.startsWith('!dist/') && name.endsWith('.js'))
      .map((name) => name.slice(1))
    expect(
      [...REPORT_PACKAGE_FRAME_PATHS].toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(packaged.toSorted((left, right) => left.localeCompare(right)))
  })

  it('R3 refuses reads and appends through hard links and marker symlinks', async () => {
    const dir = await storage()
    const reports = path.join(dir, REPORT_STORAGE_DIR)
    await mkdir(reports)
    const target = path.join(dir, 'target')
    await writeFile(target, 'untouched')
    const hard = path.join(reports, 'journal-hard.jsonl')
    await link(target, hard)
    await expect(nodeReportJournalFs.readFile(hard)).rejects.toThrow()
    await expect(nodeReportJournalFs.appendFile(hard, 'changed')).rejects.toThrow()
    const marker = path.join(reports, 'marker-own.json')
    await symlink(target, marker)
    await expect(nodeReportJournalFs.readFile(marker)).rejects.toThrow()
    await expect(nodeReportJournalFs.writeTempAndRename(marker, 'changed')).rejects.toThrow()
    expect(await readFile(target, 'utf8')).toBe('untouched')
  })

  it('R3 refuses redirected reports directories and journal leaves', async () => {
    const dir = await storage()
    const outside = path.join(dir, 'outside')
    await mkdir(outside)
    await symlink(outside, path.join(dir, REPORT_STORAGE_DIR), 'junction')
    const linked = journal(dir, 'linked')
    await linked.recorder.startup()
    await linked.recorder.record(event())
    expect(linked.recorder.isAvailable).toBe(false)
    await expect(readFile(path.join(outside, 'marker-linked.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await rm(path.join(dir, REPORT_STORAGE_DIR))
    await mkdir(path.join(dir, REPORT_STORAGE_DIR))
    const target = path.join(outside, 'target')
    await writeFile(target, 'untouched')
    await symlink(target, path.join(dir, REPORT_STORAGE_DIR, 'journal-own.jsonl'))
    const own = journal(dir, 'own')
    await own.recorder.startup()
    await own.recorder.record(event())
    expect(own.recorder.isAvailable).toBe(false)
    expect(await readFile(target, 'utf8')).toBe('untouched')
  })

  it('R3 never follows a predictable stage link or an unexpected file type', async () => {
    const dir = await storage()
    const reports = path.join(dir, REPORT_STORAGE_DIR)
    await mkdir(reports)
    const target = path.join(dir, 'target')
    await writeFile(target, 'untouched')
    const file = path.join(reports, 'marker-own.json')
    await symlink(target, `${file}.tmp-${String(process.pid)}`)
    await nodeReportJournalFs.writeTempAndRename(file, buildMarkerText('own', 1001, 1000) ?? '')
    expect(await readFile(target, 'utf8')).toBe('untouched')
    await mkdir(path.join(reports, 'journal-directory.jsonl'))
    await expect(
      nodeReportJournalFs.readFile(path.join(reports, 'journal-directory.jsonl')),
    ).rejects.toThrow()
  })

  it('R3 startup preserves directory-entry types and never reads journal links', async () => {
    class LinkFs extends MapFs {
      public readonly read: string[] = []
      public override readFile(file: string): Promise<string> {
        this.read.push(file)
        return super.readFile(file)
      }
    }
    const store = new LinkFs()
    const link = path.join('mem', REPORT_STORAGE_DIR, 'journal-link.jsonl')
    store.links.add(link)
    const own = journal('mem', 'own', { fs: store })
    await own.recorder.startup()
    await own.recorder.readMerged()
    expect(store.read).not.toContain(link)
  })

  it.each(['startup', 'readMerged'] as const)(
    'R4 %s preserves a live peer append after a stale snapshot',
    async (operation) => {
      const store = new MapFs()
      let now = 1000
      const left = journal('mem', 'left', { fs: store, now: () => now })
      await left.recorder.startup()
      await left.recorder.record(event({ code: 'EIO' }))
      const right = journal('mem', 'right', { fs: store, now: () => now })
      if (operation === 'readMerged') await right.recorder.startup()
      now += 8 * 24 * 60 * 60 * 1000
      const held = Promise.withResolvers<undefined>()
      const proceed = Promise.withResolvers<undefined>()
      const original = store.readFile.bind(store)
      const file = path.join('mem', REPORT_STORAGE_DIR, 'journal-left.jsonl')
      let isPaused = false
      store.readFile = async (name) => {
        const snapshot = await original(name)
        if (name === file && !isPaused) {
          isPaused = true
          held.resolve(undefined)
          await proceed.promise
        }
        return snapshot
      }
      const reading = right.recorder[operation]()
      await held.promise
      await left.recorder.record(event({ code: 'EACCES' }))
      proceed.resolve(undefined)
      await reading
      expect(parseJournalText(await original(file)).entries.map((entry) => entry.code)).toContain(
        'EACCES',
      )
    },
  )

  it('R4 shutdown closes append admission before removing ownership', async () => {
    const store = new MapFs()
    const own = journal('mem', 'own', { fs: store })
    await own.recorder.startup()
    await own.recorder.record(event({ code: 'EIO' }))
    await own.recorder.shutdown()
    await own.recorder.record(event({ code: 'EACCES' }))
    const raw = store.files.get(path.join('mem', REPORT_STORAGE_DIR, 'journal-own.jsonl')) ?? ''
    expect(parseJournalText(raw).entries.map((entry) => entry.code)).toEqual(['EIO'])
  })

  it('R5 keeps live-process stages and sweeps only dead-process stages', async () => {
    const store = new MapFs()
    const live = path.join('mem', REPORT_STORAGE_DIR, 'marker-left.json.tmp-2001')
    const dead = path.join('mem', REPORT_STORAGE_DIR, 'journal-dead.jsonl.tmp-2002')
    store.files.set(live, 'in-flight')
    store.files.set(dead, 'abandoned')
    const own = journal('mem', 'own', { fs: store, isAlive: (pid) => pid === 2001 })
    await own.recorder.startup()
    expect(store.files.get(live)).toBe('in-flight')
    expect(store.files.has(dead)).toBe(false)
  })

  it('R6 prunes retention age on every small append', async () => {
    const store = new MapFs()
    let now = 1000
    const own = journal('mem', 'own', { fs: store, now: () => now })
    await own.recorder.startup()
    await own.recorder.record(event({ code: 'EIO' }))
    now += 8 * 24 * 60 * 60 * 1000
    await own.recorder.record(event({ code: 'EACCES' }))
    const raw = store.files.get(path.join('mem', REPORT_STORAGE_DIR, 'journal-own.jsonl')) ?? ''
    expect(parseJournalText(raw).entries.map((entry) => entry.code)).toEqual(['EACCES'])
  })

  it.each(['startup', 'readMerged'] as const)(
    'R8 %s deletes invalid-only bytes and repairs torn tails',
    async (operation) => {
      const store = new MapFs()
      const own = journal('mem', 'own', { fs: store, now: () => 1000 })
      if (operation === 'readMerged') await own.recorder.startup()
      const bad = path.join('mem', REPORT_STORAGE_DIR, 'journal-bad.jsonl')
      const torn = path.join('mem', REPORT_STORAGE_DIR, 'journal-torn.jsonl')
      const good = buildFlightRecord(event(), 1000)
      if (!good.ok) throw new Error('test record must build')
      const line = serializeFlightRecord(good.record)
      store.files.set(bad, 'x'.repeat(REPORT_JOURNAL_MAX_BYTES + 100))
      store.files.set(torn, `${line}{partial`)
      await own.recorder[operation]()
      expect(store.files.has(bad)).toBe(false)
      expect(store.files.get(torn)).toBe(line)
    },
  )

  it('R8 bounds native reads while preserving the newest complete records', async () => {
    const dir = await storage()
    const reports = path.join(dir, REPORT_STORAGE_DIR)
    await mkdir(reports)
    const file = path.join(reports, 'journal-large.jsonl')
    const good = buildFlightRecord(event(), 1000)
    if (!good.ok) throw new Error('test record must build')
    await writeFile(
      file,
      `${'x'.repeat(REPORT_JOURNAL_MAX_BYTES * 2)}\n${serializeFlightRecord(good.record)}`,
    )
    const text = await nodeReportJournalFs.readFile(file)
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(REPORT_JOURNAL_MAX_BYTES)
    expect(parseJournalText(text).entries).toEqual([good.record])
    const own = journal(dir, 'own', { now: () => 1000 })
    await own.recorder.startup()
    expect(await readFile(file, 'utf8')).toBe(serializeFlightRecord(good.record))
  })

  it.each(['startup', 'readMerged'] as const)(
    'R9 %s exposes unreadable evidence with one warning',
    async (operation) => {
      class UnreadableFs extends MapFs {
        public override readFile(file: string): Promise<string> {
          return file.endsWith('journal-unreadable.jsonl')
            ? Promise.reject(
                Object.assign(new Error('unreadable private path'), { code: 'EACCES' }),
              )
            : super.readFile(file)
        }
      }
      const store = new UnreadableFs()
      const own = journal('mem', 'own', { fs: store })
      if (operation === 'readMerged') await own.recorder.startup()
      store.files.set(
        path.join('mem', REPORT_STORAGE_DIR, 'journal-unreadable.jsonl'),
        'inaccessible',
      )
      await own.recorder[operation]()
      expect(own.recorder.isAvailable).toBe(false)
      expect(warnings(own.log)).toHaveLength(1)
      expect(warnings(own.log)[0]).not.toContain('private path')
    },
  )

  it('R7 bounds merged reports while exposing the aggregate on-disk residual', async () => {
    const store = new MapFs()
    const frames = Array.from({ length: 16 }, (_, index) =>
      frame('dist/museCodeReviewer.js', index + 1),
    )
    const records: FlightRecord[] = []
    for (let index = 0; index < 320; index += 1) {
      const built = buildFlightRecord(event({ frames, count: index }), 1000)
      if (!built.ok) throw new Error('test record must build')
      records.push(built.record)
    }
    const bytes = pruneFlightEntries(records, 1000)
      .map((record) => serializeFlightRecord(record))
      .join('')
    const left = journal('mem', 'left', { fs: store, now: () => 1000 })
    const right = journal('mem', 'right', { fs: store, now: () => 1000 })
    await left.recorder.startup()
    await right.recorder.startup()
    const files = ['left', 'right'].map((name) =>
      path.join('mem', REPORT_STORAGE_DIR, `journal-${name}.jsonl`),
    )
    for (const file of files) store.files.set(file, bytes)
    const merged = await right.recorder.readMerged(Number.MAX_SAFE_INTEGER)
    expect(
      Buffer.byteLength(merged.entries.map((record) => serializeFlightRecord(record)).join('')),
    ).toBeLessThanOrEqual(REPORT_JOURNAL_MAX_BYTES)
    // Named residual R7: live files each stay bounded, but their combined disk
    // budget needs a cross-process transaction, not a peer's unqueued rewrite.
    expect(
      files.reduce((total, file) => total + Buffer.byteLength(store.files.get(file) ?? ''), 0),
    ).toBeGreaterThan(REPORT_JOURNAL_MAX_BYTES)
  })

  it('R10 clears the activation marker after recording is disabled', async () => {
    class FullFs extends MapFs {
      public override appendFile(): Promise<void> {
        return Promise.reject(Object.assign(new Error('full'), { code: 'ENOSPC' }))
      }
    }
    const store = new FullFs()
    const own = journal('mem', 'own', { fs: store })
    await own.recorder.startup()
    await own.recorder.record(event())
    expect(own.recorder.isAvailable).toBe(false)
    await own.recorder.shutdown()
    expect(store.files.has(path.join('mem', REPORT_STORAGE_DIR, 'marker-own.json'))).toBe(false)
    const next = journal('mem', 'next', { fs: store, isAlive: () => false })
    expect(await next.recorder.startup()).toEqual({ offerReport: false })
  })
})
