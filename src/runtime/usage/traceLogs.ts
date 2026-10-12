// Reads the Muse Code CLI's trace logs for the usage insights (PLAN.md D17):
// `~/.local/share/muse/local-tracing/bootstrap/cli-<uuid>.log`, one per
// `muse serve` process, newest first, a bounded number of bounded files.
// The lines are read by the pure parser in src/core/usage/insights.ts.
//
// Round 3 is a redesign (docs/certification/usage-trace.md): the unit of
// sharing is ONE RECORD PER FILE. Every listed file a caller needs ends
// with a record holding the file's identity, the size and nanosecond mtime
// of the snapshot that was parsed, the facts of its complete lines, and a
// STATE from a closed set: `fresh` (parsed from the newest snapshot),
// `behind` (an earlier good parse is shown because the newest read failed),
// `unreadable` (no good parse exists: locked, denied, vanished between
// stat and read, still changing, or unparsable), `oversize` (over
// TRACE_LOG_MAX_BYTES: the complete lines within the limit are kept, never
// dropped). No listed file contributes nothing without a state that says
// so: "nothing happened" and "could not be read" are different records.
//
// Each file has its OWN in-flight parse, and each caller applies its OWN
// cutoff to the listing: no caller's `fromDay` is ever applied to another
// caller's read. A file one caller skips is simply not parsed yet; the next
// caller that needs it parses it.
//
// A file is the same file as last time when its device and inode match
// where the file system reports them AND a hash of its first
// TRACE_LOG_HEAD_BYTES bytes matches, so a file system that reports inode
// 0 and a truncate-and-rewrite to the same or a larger size on the same
// inode are both seen. The head is re-checked after the read: a head that
// changed during the read is re-read once, and a second change makes the
// record `unreadable` ("still changing").
//
// Numbers are complete up to the moment of the read, not complete for a
// conversation in progress: one snapshot per file (stat, read only the
// first `size` bytes, count only complete lines). A host appending during
// the read lands past the snapshot; the next refresh parses the tail.

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import {
  fileReadIdentity,
  identityOf,
  sameFile as isSameNativeFile,
  statIdentity,
  type FileIdentity,
} from '../../core/fs/fileIdentity'
import {
  createTraceLogBuilder,
  parseTraceLine,
  summarizeInsights,
  type TraceLogBuilder,
  type TraceLogFacts,
} from '../../core/usage/insights'
import {
  MUSE_TRACE_LOG_SEGMENTS,
  TRACE_LOG_FILE_SUFFIX,
  TRACE_LOG_HEAD_BYTES,
  TRACE_LOG_MAX_BYTES,
  TRACE_LOG_MAX_FILES,
  TRACE_LOG_READ_CONCURRENCY,
  USAGE_HISTORY_DAYS_MAX,
  USAGE_INSIGHTS_TTL_MS,
  USAGE_WINDOW_DAY_MS,
  USAGE_WINDOW_WEEK_MS,
} from '../../shared/constants'
import type { UsageInsights } from '../../shared/usage'
import type { UsagePageState } from '../../shared/usagePage'
import { classifyRun } from '../../core/usage/insights'

export interface UsageInsightsReport {
  readonly day: UsageInsights
  readonly week: UsageInsights
}

/** The closed set of per-file read states; see the header and the state table. */
export type TraceFileState = 'fresh' | 'behind' | 'unreadable' | 'oversize'
/**
 * The machine-readable reason on a record: `current` (fresh), the failure
 * word (behind: the earlier parse shown stands in for this failure;
 * unreadable: no parse exists), or `over-limit` (oversize).
 */
export type TraceFileReason =
  | 'current'
  | 'over-limit'
  | 'locked'
  | 'denied'
  | 'vanished'
  | 'changing'
  | 'unparseable'
  | 'io-error'

/** One file's read: the unit of sharing between the page, chat and export. */
export interface TraceFileRecord {
  readonly file: string
  readonly size: number
  readonly mtimeNs: string
  readonly facts: TraceLogFacts
  readonly state: TraceFileState
  readonly reason: TraceFileReason
}

export interface TraceLogFileStat {
  readonly size: number
  readonly mtimeMs: number
  /** Nanosecond mtime: separates rewrites inside one millisecond (P3-1). */
  readonly mtimeNs: string
  /** The native file identity (device and inode; either may be 0). */
  readonly identity: FileIdentity
}

/** The file-system surface the reader needs; tests inject a counting fake. */
export interface TraceLogFs {
  readonly list: (directory: string) => Promise<readonly string[]>
  readonly stat: (file: string) => Promise<TraceLogFileStat>
  /** Hex digest of the file's first `maxBytes` bytes (the head fingerprint). */
  readonly readHead: (file: string, maxBytes: number) => Promise<string>
  /**
   * Calls `onLine` for each COMPLETE line in the file's first `maxBytes`
   * bytes: LF and CRLF end a line, exactly as the old whole-text split, and
   * a lone CR stays inside its line. A trailing piece without its newline is
   * a torn write, not a line yet, and is never reported.
   */
  readonly streamLines: (
    file: string,
    maxBytes: number,
    onLine: (line: string) => void,
  ) => Promise<void>
}

export interface TraceLogDeps {
  readonly homeDir: string
  /** Test seam only: an injected file system is never shared between homes. */
  readonly fs?: TraceLogFs
  /**
   * Test seam only: defaults to the production line parser. A throw becomes
   * that file's `unreadable` record, never an unhandled error.
   */
  readonly parseLine?: (builder: TraceLogBuilder, line: string) => void
}

export interface InsightsReaderDeps extends TraceLogDeps {
  readonly now: () => number
}

/** What chat shows: the report plus the same notice the page shows. */
export interface TraceInsights {
  readonly report: UsageInsightsReport | undefined
  /** Mirrors the page's trace notice; chat renders the same sentences. */
  readonly notice: 'behind' | 'unavailable' | undefined
  /**
   * True ONLY when the listing succeeded and found no file: the only case
   * where chat may say no trace logs were found on this machine.
   */
  readonly empty: boolean
}

export interface InsightsReader {
  read(): Promise<TraceInsights>
}

/** One reader per home folder, shared by attempts and insights reads. */
export interface TraceLogReader {
  readLogs(nowMs?: number): Promise<readonly TraceLogFacts[]>
  readAttempts(nowMs?: number, fromDay?: string): Promise<UsagePageState['attempts']>
  readSummary(nowMs?: number, fromDay?: string): Promise<TraceReadSummary>
  /**
   * True when the latest read served a last-good parse for a log whose
   * newest read failed: the numbers for that log may be behind.
   */
  isTraceStale(): boolean
}

export function traceLogDirectory(deps: TraceLogDeps): string {
  return path.join(deps.homeDir, ...MUSE_TRACE_LOG_SEGMENTS)
}

function isAbsentDirectory(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  )
}

function errorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown'
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' || typeof code === 'number' ? String(code) : 'unknown'
}

/**
 * The local midnight a query's `from` day starts: a file with an older mtime
 * holds only older lines (a line is written no later than its file's mtime),
 * and every such line falls before the query's range, so the file is safely
 * skipped. Local midnight, not UTC: attempt days are local days.
 */
function startOfLocalDayMs(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  return match?.[1] === undefined || match[2] === undefined || match[3] === undefined
    ? NaN
    : new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
}

/**
 * A file older than the query's range cannot hold an attempt inside it. With
 * no query (the insights read) the backstop stays what it was: older than
 * every window any caller shows.
 */
export function traceLogCutoffMs(nowMs: number, fromDay?: string): number {
  return fromDay === undefined
    ? nowMs - Math.max(USAGE_WINDOW_WEEK_MS, USAGE_HISTORY_DAYS_MAX * USAGE_WINDOW_DAY_MS)
    : startOfLocalDayMs(fromDay)
}

/**
 * One stream chunk's complete lines, split exactly as the old whole-text
 * parser split (LF and CRLF only; a lone CR stays inside its line). A
 * trailing CR is held back: it may be the first half of a CRLF split across
 * two chunks. Exported for the equivalence tests; the reader below is the
 * only other caller.
 */
export function splitTraceChunk(tail: string, chunk: string): { lines: string[]; tail: string } {
  const text = tail + chunk
  const complete = text.endsWith('\r') ? text.slice(0, -1) : text
  const pieces = complete.split('\n')
  const tailPiece = pieces.pop() ?? ''
  return {
    lines: pieces.map((piece) => (piece.endsWith('\r') ? piece.slice(0, -1) : piece)),
    tail: `${tailPiece}${text.endsWith('\r') ? '\r' : ''}`,
  }
}

export interface TraceLineSplitter {
  /** Feeds one stream chunk; complete lines reach `onLine` in order. */
  readonly push: (chunk: string) => void
  /** Drops the torn tail: a piece without its newline is not a line yet. */
  readonly finish: () => void
  /** Bytes searched for a newline so far; each byte is searched once. */
  readonly scannedBytes: number
}

/**
 * The production line splitter: every byte is searched for its newline
 * exactly once. Bytes before `searched` hold no newline (they follow the
 * last newline seen), so each push searches only the bytes it adds. A
 * trailing CR needs no special case: a line is emitted only at its `\n`,
 * where one trailing `\r` is the CRLF half and a lone CR stays inside.
 */
export function createTraceLineSplitter(onLine: (line: string) => void): TraceLineSplitter {
  let buffer = ''
  let searched = 0
  let scanned = 0
  return {
    push: (chunk: string): void => {
      buffer += chunk
      scanned += buffer.length - searched
      let newline = buffer.indexOf('\n', searched)
      while (newline !== -1) {
        const raw = buffer.slice(0, newline)
        onLine(raw.endsWith('\r') ? raw.slice(0, -1) : raw)
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
      // What remains follows the last newline seen, so it holds none yet.
      searched = buffer.length
    },
    finish: (): void => {
      buffer = ''
      searched = 0
    },
    get scannedBytes(): number {
      return scanned
    },
  }
}

/**
 * The production streaming reader: each complete line in the file's first
 * `maxBytes` bytes. The string decoder heals multibyte characters split
 * across chunks; a trailing piece without its newline is dropped (a torn
 * write, not a line yet). `end` is inclusive, so `[0, maxBytes)` is exactly
 * the snapshot the first stat saw. A throw from the line parser inside the
 * data handler is captured and rethrown as that file's failure: it never
 * escapes as an unhandled stream error.
 */
function streamTraceLines(
  file: string,
  maxBytes: number,
  onLine: (line: string) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (!(maxBytes > 0)) {
      resolve()
      return
    }
    let isSettled = false
    const done = (error?: Error): void => {
      if (isSettled) return
      isSettled = true
      if (error === undefined) resolve()
      else reject(error)
    }
    const input = createReadStream(file, { encoding: 'utf8', start: 0, end: maxBytes - 1 })
    const splitter = createTraceLineSplitter(onLine)
    let parseError: Error | undefined
    input.on('data', (chunk: string | Buffer) => {
      if (parseError !== undefined) return
      try {
        splitter.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
      } catch (error) {
        parseError = error instanceof Error ? error : new Error('traceLogUnparseable')
      }
    })
    input.on('error', (error) => {
      done(parseError ?? error)
    })
    input.on('end', () => {
      splitter.finish()
      done(parseError)
    })
  })
}

/** Hex digest of the file's first `maxBytes` bytes (the head fingerprint). */
function hashHead(file: string, maxBytes: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (!(maxBytes > 0)) {
      resolve(createHash('sha256').digest('hex'))
      return
    }
    const digest = createHash('sha256')
    const input = createReadStream(file, { start: 0, end: maxBytes - 1 })
    input.on('data', (chunk: string | Buffer) => {
      digest.update(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    })
    input.on('error', (error) => {
      reject(error)
    })
    input.on('end', () => {
      resolve(digest.digest('hex'))
    })
  })
}

/** The production file system; tests wrap it to count opens. */
export const defaultTraceLogFs: TraceLogFs = {
  list: (directory) => readdir(directory),
  stat: async (file) => {
    const info = await statIdentity(file)
    return {
      size: Number(info.size),
      mtimeMs: Number(info.mtimeMs),
      mtimeNs: fileReadIdentity(info).mtime,
      identity: identityOf(info),
    }
  },
  readHead: (file, maxBytes) => hashHead(file, maxBytes),
  streamLines: (file, maxBytes, onLine) => streamTraceLines(file, maxBytes, onLine),
}

const EMPTY_TRACE_FACTS: TraceLogFacts = {
  firstMs: undefined,
  lastMs: undefined,
  attempts: [],
  runs: new Map(),
}

/** One snapshot: the first stat plus the head fingerprint it saw. */
interface TraceFileSnapshot extends TraceLogFileStat {
  readonly head: string
}

async function snapshotFile(fs: TraceLogFs, file: string): Promise<TraceFileSnapshot> {
  const stat = await fs.stat(file)
  let head: string
  try {
    head = await fs.readHead(file, TRACE_LOG_HEAD_BYTES)
  } catch {
    // A head that cannot be fingerprinted (a locked file) fails its stream
    // the same way: carry an empty fingerprint so the parse path, which
    // sees the same error, names the failure instead of the snapshot.
    head = ''
  }
  return { ...stat, head }
}

/**
 * The same file as last time: the device and inode match where the file
 * system reports them, and the head fingerprint matches. Either half alone
 * lies: inode 0 aliases every file on file systems that report none, and a
 * same-size rewrite keeps the size while changing the head.
 */
function isSameSnapshot(cached: TraceFileSnapshot, fresh: TraceFileSnapshot): boolean {
  return (
    cached.size === fresh.size &&
    cached.mtimeNs === fresh.mtimeNs &&
    isSameNativeFile(cached.identity, fresh.identity) &&
    cached.head === fresh.head
  )
}

function factsOf(builder: TraceLogBuilder): TraceLogFacts {
  return {
    firstMs: builder.firstMs,
    lastMs: builder.lastMs,
    attempts: builder.attempts,
    runs: builder.runs,
  }
}

function classifyReadError(error: unknown): TraceFileReason {
  if (error instanceof Error && error.message === 'traceLogUnparseable') return 'unparseable'
  const code = errorCode(error)
  if (code === 'EPERM' || code === 'EBUSY') return 'locked'
  if (code === 'EACCES') return 'denied'
  return code === 'ENOENT' ? 'vanished' : 'io-error'
}

function isUnstable(error: unknown): boolean {
  return error instanceof Error && error.message === 'traceLogUnstable'
}

/**
 * One snapshot parse: only the first `snapshot.size` bytes are read, so a
 * host appending mid-read adds lines past the snapshot instead of tearing
 * this parse. Accepted when the file is still itself afterwards: same
 * device and inode, no shrink, same head. An append (same head, larger
 * size) is accepted: the snapshot's complete lines are all counted, and
 * the next refresh parses the tail. Anything else (a rewrite, a shrink, a
 * rotation) is `traceLogUnstable` for one fresh re-read.
 */
async function parseSnapshot(
  fs: TraceLogFs,
  file: string,
  snapshot: TraceFileSnapshot,
  parseLine: (builder: TraceLogBuilder, line: string) => void,
): Promise<TraceLogFacts> {
  const builder = createTraceLogBuilder()
  let parseError: unknown
  await fs.streamLines(file, Math.min(snapshot.size, TRACE_LOG_MAX_BYTES), (line) => {
    if (parseError !== undefined) return
    try {
      parseLine(builder, line)
    } catch (error) {
      parseError = error
    }
  })
  if (parseError !== undefined) throw new Error('traceLogUnparseable', { cause: parseError })
  const after = await snapshotFile(fs, file)
  if (!isSameNativeFile(snapshot.identity, after.identity) || after.size < snapshot.size)
    throw new Error('traceLogUnstable')
  if (after.head !== snapshot.head) throw new Error('traceLogUnstable')
  // Same size, same head, but a moved mtime: the tail may mix old and new
  // bytes from a same-size rewrite, so this parse does not stand.
  if (after.size === snapshot.size && after.mtimeNs !== snapshot.mtimeNs)
    throw new Error('traceLogUnstable')
  return factsOf(builder)
}

interface CachedTraceFile extends TraceFileSnapshot {
  readonly record: TraceFileRecord
}

/**
 * One file's record. An oversize log is never dropped: its record keeps
 * the complete lines within the limit with state `oversize`, so attempts
 * already shown never vanish because the file grew. A still-changing file
 * is re-read once against a fresh snapshot; a second change is
 * `unreadable` ("still changing") even when an earlier parse exists. Any
 * other failure serves the earlier good parse as `behind`, or is
 * `unreadable` when no good parse exists.
 */
async function parseFileRecord(
  fs: TraceLogFs,
  file: string,
  snapshot: TraceFileSnapshot,
  parseLine: (builder: TraceLogBuilder, line: string) => void,
  previous: CachedTraceFile | undefined,
): Promise<{ record: TraceFileRecord; snapshot: TraceFileSnapshot }> {
  const failed = (error: unknown, isStillChanging: boolean): TraceFileRecord => {
    const base = { file, size: snapshot.size, mtimeNs: snapshot.mtimeNs } as const
    if (isStillChanging)
      return { ...base, facts: EMPTY_TRACE_FACTS, state: 'unreadable', reason: 'changing' }
    const reason = classifyReadError(error)
    return previous === undefined
      ? { ...base, facts: EMPTY_TRACE_FACTS, state: 'unreadable', reason }
      : { ...base, facts: previous.record.facts, state: 'behind', reason }
  }
  const parsed = async (
    snap: TraceFileSnapshot,
  ): Promise<{ record: TraceFileRecord; snapshot: TraceFileSnapshot }> => {
    const facts = await parseSnapshot(fs, file, snap, parseLine)
    // An oversize log is never dropped: the complete lines within the limit
    // are kept, so attempts already shown never vanish when the file grows.
    const isOversize = snap.size > TRACE_LOG_MAX_BYTES
    return {
      record: {
        file,
        size: snap.size,
        mtimeNs: snap.mtimeNs,
        facts,
        state: isOversize ? 'oversize' : 'fresh',
        reason: isOversize ? 'over-limit' : 'current',
      },
      snapshot: snap,
    }
  }
  try {
    return await parsed(snapshot)
  } catch (error) {
    if (!isUnstable(error)) return { record: failed(error, false), snapshot }
    try {
      return await parsed(await snapshotFile(fs, file))
    } catch (retryError) {
      return { record: failed(retryError, isUnstable(retryError)), snapshot }
    }
  }
}

async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Map<number, R>()
  let next = 0
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      const item = items[index]
      if (item !== undefined) results.set(index, await task(item))
    }
  })
  await Promise.all(workers)
  return items.map((_, index) => {
    const value = results.get(index)
    if (value === undefined) throw new Error('tracePoolGap')
    return value
  })
}

export interface TraceListedFile {
  readonly file: string
  readonly stat: TraceLogFileStat
}

export type TraceListingOutcome = 'ok' | 'empty' | 'missing' | 'failed'

export interface TraceListing {
  /** Newest first by nanosecond mtime, then by name; at most the window. */
  readonly entries: readonly TraceListedFile[]
  readonly outcome: TraceListingOutcome
  /** `current` (listed), `no-files`, `no-directory`, or the errno word. */
  readonly reason: string
}

/**
 * One listing order, always the same: newest first by nanosecond mtime,
 * then by name (separators normalised, so Windows and POSIX agree), capped
 * at TRACE_LOG_MAX_FILES. The 200-file window can never flip between
 * refreshes: equal mtimes break the tie by name, never by pool order.
 */
export async function listTraceFiles(fs: TraceLogFs, directory: string): Promise<TraceListing> {
  let names: readonly string[]
  try {
    names = await fs.list(directory)
  } catch (error) {
    return isAbsentDirectory(error)
      ? { entries: [], outcome: 'missing', reason: 'no-directory' }
      : { entries: [], outcome: 'failed', reason: errorCode(error) }
  }
  const candidates: string[] = []
  for (const name of names) {
    if (name.endsWith(TRACE_LOG_FILE_SUFFIX)) candidates.push(path.join(directory, name))
  }
  // The pool never holds undefined (it cannot tell a gap from a miss),
  // so each task returns a wrapper: a missing stat is an absent file.
  const maybeListed = await mapPool(
    candidates,
    TRACE_LOG_READ_CONCURRENCY,
    async (file): Promise<{ file: string; stat: TraceLogFileStat | undefined }> => {
      try {
        return { file, stat: await fs.stat(file) }
      } catch {
        // Gone between the listing and the stat; the next listing retries.
        return { file, stat: undefined }
      }
    },
  )
  const stamped: TraceListedFile[] = []
  for (const entry of maybeListed) {
    if (entry.stat !== undefined) stamped.push({ file: entry.file, stat: entry.stat })
  }
  stamped.sort((a, b) => {
    if (a.stat.mtimeNs !== b.stat.mtimeNs)
      return BigInt(a.stat.mtimeNs) > BigInt(b.stat.mtimeNs) ? -1 : 1
    const left = a.file.replaceAll('\\', '/')
    const right = b.file.replaceAll('\\', '/')
    if (left === right) return 0
    return left < right ? -1 : 1
  })
  const entries = stamped.slice(0, TRACE_LOG_MAX_FILES)
  return entries.length === 0
    ? { entries, outcome: 'empty', reason: 'no-files' }
    : { entries, outcome: 'ok', reason: 'current' }
}

export type TraceSummaryState = 'ok' | 'behind' | 'unavailable'

/** One value carries the trace read to EVERY surface: page, chat, export. */
export interface TraceReadSummary {
  /** Facts from every record that has a parse; `unreadable` files add none. */
  readonly facts: readonly TraceLogFacts[]
  readonly records: readonly TraceFileRecord[]
  readonly listing: TraceListing
  readonly state: TraceSummaryState
  /** The distinct failure words behind a non-`ok` state. */
  readonly reasons: readonly string[]
  /**
   * True ONLY when the listing succeeded and found no file: the only case
   * where a surface may say no trace logs were found on this machine.
   */
  readonly empty: boolean
}

/**
 * The one function that builds the carried value from the file records and
 * the listing result. The page, the chat insights and the export all render
 * their notice from this value, so the three surfaces tell the same truth.
 */
export function summarizeTraceRead(
  records: readonly TraceFileRecord[],
  listing: TraceListing,
): TraceReadSummary {
  const usable = records.filter((record) => record.state !== 'unreadable')
  if (listing.outcome === 'failed')
    return {
      facts: [],
      records,
      listing,
      state: 'unavailable',
      reasons: [listing.reason],
      empty: false,
    }
  if (records.some((record) => record.state !== 'fresh')) {
    const reasons = [
      ...new Set(records.flatMap((record) => (record.state === 'fresh' ? [] : [record.reason]))),
    ]
    if (usable.length > 0)
      return {
        facts: usable.map((record) => record.facts),
        records,
        listing,
        state: 'behind',
        reasons,
        empty: false,
      }
    return { facts: [], records, listing, state: 'unavailable', reasons, empty: false }
  }
  return {
    facts: records.map((record) => record.facts),
    records,
    listing,
    state: 'ok',
    reasons: [],
    empty: listing.outcome !== 'ok',
  }
}

function attemptsOf(logs: readonly TraceLogFacts[]): UsagePageState['attempts'] {
  const groups = new Map<string, UsagePageState['attempts'][number]>()
  for (const log of logs) {
    for (const attempt of log.attempts) {
      const date = new Date(attempt.atMs)
      const day =
        new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
          .toISOString()
          .split('T', 1)[0] ?? ''
      const origin = classifyRun(log.runs.get(attempt.runId))
      const key = `${day}:${origin}`
      const row = groups.get(key) ?? { day, origin, attempts: 0 }
      row.attempts += 1
      groups.set(key, row)
    }
  }
  return Array.from(groups, (entry) => entry[1]).toSorted(
    (a, b) => a.day.localeCompare(b.day) || a.origin.localeCompare(b.origin),
  )
}

/** A fresh reader over one home folder; prefer getTraceLogReader to share. */
export function createTraceLogReader(deps: TraceLogDeps): TraceLogReader {
  const fs = deps.fs ?? defaultTraceLogFs
  const parseLine = deps.parseLine ?? parseTraceLine
  const directory = traceLogDirectory(deps)
  const files = new Map<string, CachedTraceFile>()
  const inflight = new Map<string, Promise<TraceFileRecord>>()
  let wasRefreshStale = false

  function recordFor(file: string, snapshot: TraceFileSnapshot): Promise<TraceFileRecord> {
    const running = inflight.get(file)
    if (running !== undefined) return running
    const cached = files.get(file)
    // An unchanged file with a usable record is never opened again. A file
    // whose record is `unreadable` is always retried: releasing a lock does
    // not move the mtime, and the next read must see it.
    if (
      cached !== undefined &&
      cached.record.state !== 'unreadable' &&
      isSameSnapshot(cached, snapshot)
    ) {
      if (cached.record.state !== 'fresh') wasRefreshStale = true
      return Promise.resolve(cached.record)
    }
    // parseFileRecord never rejects (every path returns a record), so an
    // unconditional delete cannot drop a newer parse: recordFor joins the
    // running parse instead of starting another while one is in flight.
    const invoke = async (): Promise<TraceFileRecord> => {
      const parsed = await parseFileRecord(fs, file, snapshot, parseLine, files.get(file))
      if (parsed.record.state === 'unreadable') files.delete(file)
      else files.set(file, { ...parsed.snapshot, record: parsed.record })
      // Any record that is not a fresh parse (a stand-in, a partial
      // oversize read, or nothing at all) may leave numbers behind.
      if (parsed.record.state !== 'fresh') wasRefreshStale = true
      return parsed.record
    }
    const pending = (async (): Promise<TraceFileRecord> => {
      const record = await invoke()
      inflight.delete(file)
      return record
    })()
    inflight.set(file, pending)
    return pending
  }

  async function readNeeded(nowMs: number, fromDay?: string): Promise<TraceReadSummary> {
    const listing = await listTraceFiles(fs, directory)
    if (listing.outcome === 'missing' || listing.outcome === 'failed') {
      wasRefreshStale = false
      return summarizeTraceRead([], listing)
    }
    // Each caller computes the set of files ITS OWN question needs: no
    // caller's cutoff is ever applied to another caller's read. A file
    // skipped here is simply not parsed yet.
    const cutoff = traceLogCutoffMs(nowMs, fromDay)
    const needed = listing.entries.filter((entry) => entry.stat.mtimeMs >= cutoff)
    wasRefreshStale = false
    const snapshots = await mapPool(
      needed,
      TRACE_LOG_READ_CONCURRENCY,
      async (entry): Promise<{ snapshot: TraceFileSnapshot | undefined }> => {
        try {
          return { snapshot: await snapshotFile(fs, entry.file) }
        } catch {
          // Vanished between the listing and the snapshot: the record says so.
          return { snapshot: undefined }
        }
      },
    )
    const withSnapshots = needed.map((entry, index) => ({
      entry,
      snapshot: snapshots[index]?.snapshot,
    }))
    const records = await mapPool(
      withSnapshots,
      TRACE_LOG_READ_CONCURRENCY,
      async ({ entry, snapshot }): Promise<TraceFileRecord> => {
        if (snapshot === undefined)
          return {
            file: entry.file,
            size: 0,
            mtimeNs: '0',
            facts: EMPTY_TRACE_FACTS,
            state: 'unreadable',
            reason: 'vanished',
          }
        return await recordFor(entry.file, snapshot)
      },
    )
    // Files that left the newest-N window leave the cache with it: at most
    // TRACE_LOG_MAX_FILES entries are ever kept.
    const listed = new Set(listing.entries.map((entry) => entry.file))
    for (const file of files.keys()) {
      if (!listed.has(file) && !inflight.has(file)) files.delete(file)
    }
    return summarizeTraceRead(records, listing)
  }

  return {
    readLogs: async (nowMs = Date.now()) => {
      const summary = await readNeeded(nowMs)
      return summary.facts
    },
    readAttempts: async (nowMs = Date.now(), fromDay?: string) => {
      const summary = await readNeeded(nowMs, fromDay)
      return attemptsOf(summary.facts)
    },
    readSummary: async (nowMs = Date.now(), fromDay?: string) => {
      const summary = await readNeeded(nowMs, fromDay)
      return summary
    },
    isTraceStale: () => wasRefreshStale,
  }
}

const sharedReaders = new Map<string, TraceLogReader>()

/**
 * The reader for a home folder, shared by every caller in this process.
 * Readers with an injected file system are never shared. Entries are keyed
 * by home folder; processes are short-lived beside the one real home, so
 * the map stays small by construction.
 */
export function getTraceLogReader(deps: TraceLogDeps): TraceLogReader {
  if (deps.fs !== undefined || deps.parseLine !== undefined) return createTraceLogReader(deps)
  const key = deps.homeDir.replaceAll('\\', '/').replace(/\/+$/, '')
  let reader = sharedReaders.get(key)
  if (reader === undefined) {
    reader = createTraceLogReader(deps)
    sharedReaders.set(key, reader)
  }
  return reader
}

/**
 * Reads and summarises the logs on demand, at most once per TTL: the usage
 * modal asks on every open and on every `usage/changed`. Parsed file facts
 * come from the home folder's shared reader, so attempts reads reuse them.
 * The "no logs" sentence is reachable only through `empty`: a listing that
 * succeeded and found no file.
 */
export function createInsightsReader(deps: InsightsReaderDeps): InsightsReader {
  let cached: { readonly atMs: number; readonly result: TraceInsights } | undefined
  return {
    async read() {
      const nowMs = deps.now()
      if (cached !== undefined && nowMs - cached.atMs < USAGE_INSIGHTS_TTL_MS) {
        return cached.result
      }
      const summary = await getTraceLogReader(deps).readSummary(nowMs)
      const report =
        summary.facts.length === 0
          ? undefined
          : {
              day: summarizeInsights(summary.facts, nowMs, USAGE_WINDOW_DAY_MS),
              week: summarizeInsights(summary.facts, nowMs, USAGE_WINDOW_WEEK_MS),
            }
      const result: TraceInsights =
        report === undefined
          ? {
              report: undefined,
              notice: summary.state === 'unavailable' ? 'unavailable' : undefined,
              empty: summary.empty,
            }
          : {
              report,
              notice: summary.state === 'behind' ? 'behind' : undefined,
              empty: false,
            }
      cached = { atMs: nowMs, result }
      return result
    },
  }
}

/** The readable logs, newest first, capped; an absent directory is no logs. */
export async function readTraceLogs(deps: TraceLogDeps): Promise<readonly TraceLogFacts[]> {
  return await getTraceLogReader(deps).readLogs(Date.now())
}

/** Attempts with the reader's staleness: true when a kept-changing log's last good parse stands in. */
export async function readTraceAttemptSummary(
  deps: TraceLogDeps,
  fromDay?: string,
): Promise<{ attempts: UsagePageState['attempts']; stale: boolean }> {
  const reader = getTraceLogReader(deps)
  const attempts = await reader.readAttempts(Date.now(), fromDay)
  return { attempts, stale: reader.isTraceStale() }
}

/** Attempts by recorded timestamp and origin, across every retained log. */
export async function readTraceAttempts(
  deps: TraceLogDeps,
  fromDay?: string,
): Promise<UsagePageState['attempts']> {
  const summary = await readTraceAttemptSummary(deps, fromDay)
  return summary.attempts
}
