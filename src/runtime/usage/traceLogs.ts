// Reads the Muse Code CLI's trace logs for the usage insights (PLAN.md D17):
// `~/.local/share/muse/local-tracing/bootstrap/cli-<uuid>.log`, one per
// `muse serve` process, newest first, a bounded number of bounded files. A
// running host holds its log locked; that file is skipped, not waited for.
// The lines are read by the pure parser in src/core/usage/insights.ts.
//
// One reader per home folder is shared by every caller (the attempts read on
// each usage page and the TTL-cached insights read): parsed facts are kept
// per file, keyed by path with size, mtime and inode, so an unchanged file
// is never opened again. A refresh reads only new or changed files, at most
// TRACE_LOG_READ_CONCURRENCY at once, each as a stream of lines; the
// worst case holds that many stream buffers plus parsed facts, never whole
// files side by side.

import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import {
  identityOf,
  sameFile as isSameNativeFile,
  statIdentity,
  type FileIdentity,
} from '../../core/fs/fileIdentity'
import {
  createTraceLogBuilder,
  parseTraceLine,
  summarizeInsights,
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
  /** The native file identity (device and inode as BigInt, never aliased). */
  readonly identity: FileIdentity
}

/** The file-system surface the reader needs; tests inject a counting fake. */
export interface TraceLogFs {
  readonly list: (directory: string) => Promise<readonly string[]>
  readonly stat: (file: string) => Promise<TraceLogFileStat>
  readonly streamLines: (file: string, onLine: (line: string) => void) => Promise<void>
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
  readAttempts(nowMs?: number): Promise<UsagePageState['attempts']>
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
 * A file older than every window any caller shows (the usage history and the
 * week insights) cannot hold an attempt inside one: attempts carry the line's
 * own timestamp, and a log line is written no later than the file's mtime.
 */
export function traceLogCutoffMs(nowMs: number): number {
  return nowMs - Math.max(USAGE_WINDOW_WEEK_MS, USAGE_HISTORY_DAYS_MAX * USAGE_WINDOW_DAY_MS)
}

function streamTraceLines(file: string, onLine: (line: string) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let isSettled = false
    const done = (error?: Error): void => {
      if (isSettled) return
      isSettled = true
      if (error === undefined) resolve()
      else reject(error)
    }
    const input = createReadStream(file, { encoding: 'utf8' })
    const lines = createInterface({ input, crlfDelay: Infinity })
    input.on('error', (error) => {
      lines.close()
      done(error)
    })
    void (async () => {
      try {
        for await (const line of lines) onLine(line)
        done()
      } catch (error) {
        done(error instanceof Error ? error : new Error('traceLogStreamFailed'))
      } finally {
        lines.close()
        input.destroy()
      }
    })()
  })
}

/** The production file system; tests wrap it to count opens. */
export const defaultTraceLogFs: TraceLogFs = {
  list: (directory) => readdir(directory),
  stat: async (file) => {
    const info = await statIdentity(file)
    return { size: Number(info.size), mtimeMs: Number(info.mtimeMs), identity: identityOf(info) }
  },
  streamLines: (file, onLine) => streamTraceLines(file, onLine),
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
    cached.mtimeMs === fresh.mtimeMs &&
    isSameNativeFile(cached.identity, fresh.identity)
  )
}

async function parseTraceFile(
  fs: TraceLogFs,
  file: string,
): Promise<{ stat: TraceLogFileStat; facts: TraceLogFacts }> {
  const fileStat = await fs.stat(file)
  if (fileStat.size > TRACE_LOG_MAX_BYTES) throw new Error('traceLogTooLarge')
  const builder = createTraceLogBuilder()
  await fs.streamLines(file, (line) => {
    parseTraceLine(builder, line)
  })
  // A second stat rejects a file replaced mid-read: its facts are unusable.
  const after = await fs.stat(file)
  if (
    after.size !== fileStat.size ||
    after.mtimeMs !== fileStat.mtimeMs ||
    !isSameNativeFile(fileStat.identity, after.identity)
  )
    throw new Error('traceLogChanged')
  return {
    stat: fileStat,
    facts: {
      firstMs: builder.firstMs,
      lastMs: builder.lastMs,
      attempts: builder.attempts,
      runs: builder.runs,
    },
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

  async function refresh(nowMs: number): Promise<readonly TraceLogFacts[]> {
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
    const stamped: { file: string; stat: TraceLogFileStat }[] = []
    for (const name of names) {
      if (!name.endsWith(TRACE_LOG_FILE_SUFFIX)) continue
      const file = path.join(directory, name)
      try {
        stamped.push({ file, stat: await fs.stat(file) })
      } catch {
        // Gone between the listing and the stat; the next refresh retries.
      }
    }
    const newestFirst = stamped
      .toSorted((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
      .slice(0, TRACE_LOG_MAX_FILES)
    const cutoff = traceLogCutoffMs(nowMs)
    const next = new Map<string, CachedTraceFile>()
    const ordered: (TraceLogFacts | undefined)[] = []
    const stale: { index: number; file: string }[] = []
    for (const [index, entry] of newestFirst.entries()) {
      const cached = files.get(entry.file)
      if (cached !== undefined && isUnchangedFile(cached, entry.stat)) {
        next.set(entry.file, cached)
        ordered[index] = cached.facts
      } else if (entry.stat.mtimeMs < cutoff) {
        // Too old to hold an in-window attempt: empty facts without
        // opening the file, and nothing cached to retry.
        ordered[index] = EMPTY_TRACE_FACTS
      } else if (entry.stat.size <= TRACE_LOG_MAX_BYTES) {
        stale.push({ index, file: entry.file })
      }
      // Over the size cap: skipped as before, contributing nothing.
    }
    // Entries for files that left the newest-N set are dropped here: only
    // files seen above ever enter `next`, so at most TRACE_LOG_MAX_FILES.
    await mapPool(stale, TRACE_LOG_READ_CONCURRENCY, async ({ index, file }) => {
      try {
        const parsed = await parseTraceFile(fs, file)
        next.set(file, { ...parsed.stat, facts: parsed.facts })
        ordered[index] = parsed.facts
      } catch {
        // Locked by a running host, or gone between the stat and the read:
        // skipped as before, and never cached as empty, so the next
        // refresh retries. A replaced-mid-read file retries the same way.
      }
    })
    // The swap is atomic: a throwing refresh below never runs (per-file
    // failures are caught), but any future throw leaves `files` as it was.
    files.clear()
    for (const [file, cached] of next) files.set(file, cached)
    return ordered.filter((facts): facts is TraceLogFacts => facts !== undefined)
  }

  async function settledRefresh(nowMs: number): Promise<readonly TraceLogFacts[]> {
    try {
      return await refresh(nowMs)
    } finally {
      inflight = undefined
    }
  }

  function shared(nowMs: number): Promise<readonly TraceLogFacts[]> {
    inflight ??= settledRefresh(nowMs)
    return inflight
  }

  return {
    readLogs: async (nowMs = Date.now()) => await shared(nowMs),
    readAttempts: async (nowMs = Date.now()) => attemptsOf(await shared(nowMs)),
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

/** Attempts by recorded timestamp and origin, across every retained log. */
export async function readTraceAttempts(deps: TraceLogDeps): Promise<UsagePageState['attempts']> {
  return await getTraceLogReader(deps).readAttempts(Date.now())
}
