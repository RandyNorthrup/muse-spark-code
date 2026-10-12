// Reads the Muse Code CLI's trace logs for the usage insights (PLAN.md D17):
// `~/.local/share/muse/local-tracing/bootstrap/cli-<uuid>.log`, one per
// `muse serve` process, newest first, a bounded number of bounded files.
// The lines are read by the pure parser in src/core/usage/insights.ts.
//
// One reader per home folder is shared by every caller (the attempts read on
// each usage page and the TTL-cached insights read): parsed facts are kept
// per file, keyed by path with size, nanosecond mtime and inode, so an
// unchanged file is never opened again. A refresh reads a SNAPSHOT of each
// new or changed file: only the first `size` bytes seen by the first stat,
// so a host appending during the read can neither tear a line nor lose the
// file. Only complete lines (LF and CRLF, exactly as the old whole-text
// split) are counted; a trailing piece without its newline is a torn write,
// not a line yet. At most TRACE_LOG_READ_CONCURRENCY files parse at once;
// the worst case holds that many stream buffers plus parsed facts, never
// whole files side by side. A file that shrank or changed identity is
// re-read once in the same refresh; one that keeps changing keeps its last
// good parse and marks the reader stale, so the page can say so.

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

export interface TraceLogFileStat {
  readonly size: number
  readonly mtimeMs: number
  /** Nanosecond mtime: separates rewrites inside one millisecond (P3-1). */
  readonly mtimeNs: string
  /** The native file identity (device and inode as BigInt, never aliased). */
  readonly identity: FileIdentity
}

/** The file-system surface the reader needs; tests inject a counting fake. */
export interface TraceLogFs {
  readonly list: (directory: string) => Promise<readonly string[]>
  readonly stat: (file: string) => Promise<TraceLogFileStat>
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
}

export interface InsightsReaderDeps extends TraceLogDeps {
  readonly now: () => number
}

export interface InsightsReader {
  /** The day and week windows; undefined when there are no logs at all. */
  read(): Promise<UsageInsightsReport | undefined>
}

/** One reader per home folder, shared by attempts and insights reads. */
export interface TraceLogReader {
  readLogs(nowMs?: number): Promise<readonly TraceLogFacts[]>
  readAttempts(nowMs?: number, fromDay?: string): Promise<UsagePageState['attempts']>
  /**
   * True when the latest refresh kept a last-good parse for a log that kept
   * changing underneath it: the served numbers for that log may be behind.
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

/**
 * The production streaming reader: each complete line in the file's first
 * `maxBytes` bytes. The string decoder heals multibyte characters split
 * across chunks; a trailing piece without its newline is dropped (a torn
 * write, not a line yet). `end` is inclusive, so `[0, maxBytes)` is exactly
 * the snapshot the first stat saw.
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
    let tail = ''
    input.on('data', (chunk: string | Buffer) => {
      const split = splitTraceChunk(
        tail,
        typeof chunk === 'string' ? chunk : chunk.toString('utf8'),
      )
      tail = split.tail
      for (const line of split.lines) onLine(line)
    })
    input.on('error', (error) => {
      done(error)
    })
    input.on('end', () => {
      done()
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
  streamLines: (file, maxBytes, onLine) => streamTraceLines(file, maxBytes, onLine),
}

interface CachedTraceFile extends TraceLogFileStat {
  readonly facts: TraceLogFacts
}

const EMPTY_TRACE_FACTS: TraceLogFacts = {
  firstMs: undefined,
  lastMs: undefined,
  attempts: [],
  runs: new Map(),
}

function isUnchangedFile(cached: CachedTraceFile, fresh: TraceLogFileStat): boolean {
  return (
    cached.size === fresh.size &&
    cached.mtimeNs === fresh.mtimeNs &&
    isSameNativeFile(cached.identity, fresh.identity)
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

/**
 * One snapshot parse: only the first `snapshot.size` bytes are read, so a
 * host appending mid-read adds lines past the snapshot instead of tearing
 * this parse. Accepted when the file is still itself and did not shrink; a
 * grown file's complete lines before the snapshot are all counted.
 */
async function parseSnapshot(
  fs: TraceLogFs,
  file: string,
  snapshot: TraceLogFileStat,
): Promise<TraceLogFacts> {
  if (snapshot.size > TRACE_LOG_MAX_BYTES) throw new Error('traceLogTooLarge')
  const builder = createTraceLogBuilder()
  await fs.streamLines(file, snapshot.size, (line) => {
    parseTraceLine(builder, line)
  })
  const after = await fs.stat(file)
  if (!isSameNativeFile(snapshot.identity, after.identity) || after.size < snapshot.size)
    throw new Error('traceLogUnstable')
  return factsOf(builder)
}

function isUnstable(error: unknown): boolean {
  return error instanceof Error && error.message === 'traceLogUnstable'
}

/**
 * A file that shrank or changed identity under the first parse is re-read
 * once against a fresh snapshot in the same refresh. Anything still failing
 * then (still changing, locked, vanished) throws to the caller, which keeps
 * the file's last good parse when it has one.
 */
async function parseStableFile(
  fs: TraceLogFs,
  file: string,
  snapshot: TraceLogFileStat,
): Promise<{ stat: TraceLogFileStat; facts: TraceLogFacts }> {
  try {
    return { stat: snapshot, facts: await parseSnapshot(fs, file, snapshot) }
  } catch (error) {
    if (!isUnstable(error)) throw error
    const fresh = await fs.stat(file)
    return { stat: fresh, facts: await parseSnapshot(fs, file, fresh) }
  }
}

async function mapPool<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]
      next += 1
      if (item !== undefined) await task(item)
    }
  })
  await Promise.all(workers)
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
  const directory = traceLogDirectory(deps)
  const files = new Map<string, CachedTraceFile>()
  let inflight: Promise<readonly TraceLogFacts[]> | undefined
  let wasRefreshStale = false

  async function refresh(nowMs: number, fromDay?: string): Promise<readonly TraceLogFacts[]> {
    let names: readonly string[]
    try {
      names = await fs.list(directory)
    } catch (error) {
      // An absent directory is no logs, as before, and the cache stands.
      // Any other listing failure rejects every caller sharing this
      // refresh; the cache is untouched and the next call retries.
      if (!isAbsentDirectory(error)) throw error
      return []
    }
    const candidates: string[] = []
    for (const name of names) {
      if (name.endsWith(TRACE_LOG_FILE_SUFFIX)) candidates.push(path.join(directory, name))
    }
    // Listed files are stat'ed with bounded concurrency (P3-5): the old
    // sequential loop paid one round trip per file on folders of hundreds.
    const stamped: { file: string; stat: TraceLogFileStat }[] = []
    await mapPool(candidates, TRACE_LOG_READ_CONCURRENCY, async (file) => {
      try {
        stamped.push({ file, stat: await fs.stat(file) })
      } catch {
        // Gone between the listing and the stat; the next refresh retries.
      }
    })
    const newestFirst = stamped
      .toSorted((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
      .slice(0, TRACE_LOG_MAX_FILES)
    const cutoff = traceLogCutoffMs(nowMs, fromDay)
    const next = new Map<string, CachedTraceFile>()
    const ordered: (TraceLogFacts | undefined)[] = []
    const pending: { index: number; file: string; stat: TraceLogFileStat }[] = []
    for (const [index, entry] of newestFirst.entries()) {
      const cached = files.get(entry.file)
      if (cached !== undefined && isUnchangedFile(cached, entry.stat)) {
        next.set(entry.file, cached)
        ordered[index] = cached.facts
      } else if (entry.stat.mtimeMs < cutoff) {
        // Too old to hold an in-query attempt: empty facts without
        // opening the file, and nothing cached to retry.
        ordered[index] = EMPTY_TRACE_FACTS
      } else if (entry.stat.size <= TRACE_LOG_MAX_BYTES) {
        pending.push({ index, file: entry.file, stat: entry.stat })
      }
      // Over the size cap: skipped as before, contributing nothing.
    }
    // Entries for files that left the newest-N set are dropped here: only
    // files seen above ever enter `next`, so at most TRACE_LOG_MAX_FILES.
    let isRefreshStale = false
    await mapPool(pending, TRACE_LOG_READ_CONCURRENCY, async ({ index, file, stat }) => {
      try {
        const parsed = await parseStableFile(fs, file, stat)
        next.set(file, { ...parsed.stat, facts: parsed.facts })
        ordered[index] = parsed.facts
      } catch {
        // Still changing after one re-read, locked by a running host, or
        // gone between the stat and the read: the file's last good parse
        // stands in and the reader reports stale, so the page can say the
        // numbers for that log may be behind. A file with no last good
        // parse contributes nothing and is never cached as empty, so the
        // next refresh retries it.
        const lastGood = files.get(file)
        if (lastGood !== undefined) {
          next.set(file, lastGood)
          ordered[index] = lastGood.facts
          isRefreshStale = true
        }
      }
    })
    // The swap is atomic: a throwing refresh below never runs (per-file
    // failures are caught), but any future throw leaves `files` as it was.
    files.clear()
    for (const [file, cached] of next) files.set(file, cached)
    wasRefreshStale = isRefreshStale
    return ordered.filter((facts): facts is TraceLogFacts => facts !== undefined)
  }

  async function settledRefresh(
    nowMs: number,
    fromDay?: string,
  ): Promise<readonly TraceLogFacts[]> {
    try {
      return await refresh(nowMs, fromDay)
    } finally {
      inflight = undefined
    }
  }

  function shared(nowMs: number, fromDay?: string): Promise<readonly TraceLogFacts[]> {
    inflight ??= settledRefresh(nowMs, fromDay)
    return inflight
  }

  return {
    readLogs: async (nowMs = Date.now()) => await shared(nowMs),
    readAttempts: async (nowMs = Date.now(), fromDay?: string) =>
      attemptsOf(await shared(nowMs, fromDay)),
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
  if (deps.fs !== undefined) return createTraceLogReader(deps)
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
 */
export function createInsightsReader(deps: InsightsReaderDeps): InsightsReader {
  let cached:
    { readonly atMs: number; readonly report: UsageInsightsReport | undefined } | undefined
  return {
    async read() {
      const nowMs = deps.now()
      if (cached !== undefined && nowMs - cached.atMs < USAGE_INSIGHTS_TTL_MS) {
        return cached.report
      }
      const logs = await getTraceLogReader(deps).readLogs(nowMs)
      const report =
        logs.length === 0
          ? undefined
          : {
              day: summarizeInsights(logs, nowMs, USAGE_WINDOW_DAY_MS),
              week: summarizeInsights(logs, nowMs, USAGE_WINDOW_WEEK_MS),
            }
      cached = { atMs: nowMs, report }
      return report
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
