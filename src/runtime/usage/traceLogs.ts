// Muse Code trace facts are shared per home and per file. Read a held file's
// complete-line snapshot; never truncate history by file count, size or age.
import { createHash } from 'node:crypto'
import { open, readdir, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { fileReadIdentity, sameFile, statIdentity } from '../../core/fs/fileIdentity'
import {
  classifyRun,
  createTraceLogBuilder,
  parseTraceLine,
  summarizeInsights,
  type TraceLogFacts,
} from '../../core/usage/insights'
import {
  MUSE_TRACE_LOG_SEGMENTS,
  TRACE_LOG_FILE_SUFFIX,
  TRACE_LOG_HEAD_BYTES,
  USAGE_INSIGHTS_TTL_MS,
  USAGE_WINDOW_DAY_MS,
  USAGE_WINDOW_WEEK_MS,
} from '../../shared/constants'
import type { UsageInsights } from '../../shared/usage'
import type { UsagePageState } from '../../shared/usagePage'

type TraceStat = Awaited<ReturnType<typeof statIdentity>>

export interface UsageInsightsReport {
  readonly day: UsageInsights
  readonly week: UsageInsights
}
export interface TraceLogDeps {
  readonly homeDir: string
}
export interface InsightsReaderDeps extends TraceLogDeps {
  readonly now: () => number
}
export interface TraceInsights {
  readonly report: UsageInsightsReport | undefined
  readonly notice: 'behind' | 'unavailable' | undefined
  readonly empty: boolean
}
export interface InsightsReader {
  read(): Promise<TraceInsights>
}

type TraceFileReason = 'current' | 'locked' | 'denied' | 'vanished' | 'changing' | 'io-error'
interface TraceFileRecord {
  readonly file: string
  readonly facts: TraceLogFacts | undefined
  readonly state: 'fresh' | 'behind' | 'unreadable'
  readonly reason: TraceFileReason
  readonly cause?: unknown
}
interface TraceReadSummary {
  readonly facts: readonly TraceLogFacts[]
  readonly records: readonly TraceFileRecord[]
  readonly state: 'ok' | 'behind' | 'unavailable'
  readonly empty: boolean
  readonly cause?: unknown
}
interface CachedTraceFile {
  readonly stat: TraceStat
  readonly head: string
  readonly facts: TraceLogFacts
}
interface TraceLogReader {
  readonly readSummary: () => Promise<TraceReadSummary>
}

export function traceLogDirectory(deps: TraceLogDeps): string {
  return path.join(deps.homeDir, ...MUSE_TRACE_LOG_SEGMENTS)
}

function readErrorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}
function isAbsentDirectory(error: unknown): boolean {
  return readErrorCode(error) === 'ENOENT'
}
function classifyReadError(error: unknown): TraceFileReason {
  const code = readErrorCode(error)
  if (code === 'EPERM' || code === 'EBUSY') return 'locked'
  if (code === 'EACCES') return 'denied'
  return code === 'ENOENT' ? 'vanished' : 'io-error'
}

/** Search only newly received characters, keeping a torn tail for the next chunk. */
export function createTraceLineSplitter(onLine: (line: string) => void): {
  readonly push: (chunk: string) => void
} {
  let tail = ''
  return {
    push: (chunk) => {
      let start = 0
      let newline = chunk.indexOf('\n')
      while (newline !== -1) {
        const raw = tail + chunk.slice(start, newline)
        onLine(raw.endsWith('\r') ? raw.slice(0, -1) : raw)
        tail = ''
        start = newline + 1
        newline = chunk.indexOf('\n', start)
      }
      tail += chunk.slice(start)
    },
  }
}

async function fingerprint(handle: FileHandle, size: number): Promise<string> {
  const buffer = Buffer.alloc(Math.min(size, TRACE_LOG_HEAD_BYTES))
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
  return createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex')
}

function isUnchanged(left: TraceStat, right: TraceStat): boolean {
  return (
    sameFile(left, right) &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}

/** No retry ceiling: a refresh reports a changing snapshot instead of inventing complete facts. */
async function readFileRecord(
  file: string,
  cache: Map<string, CachedTraceFile>,
): Promise<TraceFileRecord> {
  const previous = cache.get(file)
  let handle: FileHandle | undefined
  try {
    handle = await open(file, 'r')
    const before = await handle.stat({ bigint: true })
    if (!before.isFile()) throw new TypeError('traceLogNotFile')
    const size = fileReadIdentity(before).size
    const head = await fingerprint(handle, size)
    if (previous !== undefined && isUnchanged(previous.stat, before) && previous.head === head) {
      return { file, facts: previous.facts, state: 'fresh', reason: 'current' }
    }
    const builder = createTraceLogBuilder()
    const splitter = createTraceLineSplitter((line) => {
      parseTraceLine(builder, line)
    })
    if (size > 0) {
      // A held descriptor prevents rotation from mixing two different files.
      // end is inclusive; bytes appended later belong to the next refresh.
      const stream = handle.createReadStream({
        encoding: 'utf8',
        start: 0,
        end: size - 1,
        autoClose: false,
      })
      for await (const chunk of stream) {
        if (typeof chunk !== 'string') throw new TypeError('traceLogInvalidChunk')
        splitter.push(chunk)
      }
    }
    const after = await handle.stat({ bigint: true })
    const named = await statIdentity(file)
    const isStable =
      sameFile(before, named) &&
      after.size >= before.size &&
      (after.size > before.size || isUnchanged(before, after)) &&
      (await fingerprint(handle, size)) === head
    if (!isStable) {
      return {
        file,
        facts: previous?.facts,
        state: previous === undefined ? 'unreadable' : 'behind',
        reason: 'changing',
      }
    }
    const facts: TraceLogFacts = builder
    cache.set(file, { stat: before, head, facts })
    return { file, facts, state: 'fresh', reason: 'current' }
  } catch (error) {
    // Every failure is carried to the page/chat notice, never mistaken for no logs.
    return {
      file,
      facts: previous?.facts,
      state: previous === undefined ? 'unreadable' : 'behind',
      reason: classifyReadError(error),
      cause: error,
    }
  } finally {
    await handle?.close()
  }
}

function summarizeRead(records: readonly TraceFileRecord[]): TraceReadSummary {
  const facts = records.flatMap((record) => (record.facts === undefined ? [] : [record.facts]))
  let state: TraceReadSummary['state'] = 'unavailable'
  if (records.every((record) => record.state === 'fresh')) state = 'ok'
  else if (facts.length > 0) state = 'behind'
  return { facts, records, state, empty: records.length === 0 }
}

function createTraceLogReader(deps: TraceLogDeps): TraceLogReader {
  const directory = traceLogDirectory(deps)
  const cache = new Map<string, CachedTraceFile>()
  const inflight = new Map<string, Promise<TraceFileRecord>>()
  async function recordFor(file: string): Promise<TraceFileRecord> {
    const running = inflight.get(file)
    if (running !== undefined) return await running
    const pending = readFileRecord(file, cache)
    inflight.set(file, pending)
    try {
      return await pending
    } finally {
      inflight.delete(file)
    }
  }
  return {
    readSummary: async () => {
      let names: string[]
      try {
        names = await readdir(directory)
      } catch (error) {
        if (isAbsentDirectory(error)) return summarizeRead([])
        return {
          facts: [],
          records: [],
          state: 'unavailable',
          empty: false,
          cause: error,
        }
      }
      const files = names
        .filter((name) => name.endsWith(TRACE_LOG_FILE_SUFFIX))
        .map((name) => path.join(directory, name))
        .toSorted((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      const records: TraceFileRecord[] = []
      // Stream sequentially: all files are processed without holding all streams open.
      for (const file of files) records.push(await recordFor(file))
      const listed = new Set(files)
      for (const file of cache.keys()) {
        if (!listed.has(file) && !inflight.has(file)) cache.delete(file)
      }
      return summarizeRead(records)
    },
  }
}

const sharedReaders = new Map<string, TraceLogReader>()
function getTraceLogReader(deps: TraceLogDeps): TraceLogReader {
  const key = path.resolve(deps.homeDir)
  let reader = sharedReaders.get(key)
  if (reader === undefined) {
    reader = createTraceLogReader(deps)
    sharedReaders.set(key, reader)
  }
  return reader
}

export function createInsightsReader(deps: InsightsReaderDeps): InsightsReader {
  let cached: { readonly atMs: number; readonly result: TraceInsights } | undefined
  return {
    read: async () => {
      const nowMs = deps.now()
      if (cached !== undefined && nowMs - cached.atMs < USAGE_INSIGHTS_TTL_MS) {
        return cached.result
      }
      const summary = await getTraceLogReader(deps).readSummary()
      const result: TraceInsights = {
        report:
          summary.facts.length === 0
            ? undefined
            : {
                day: summarizeInsights(summary.facts, nowMs, USAGE_WINDOW_DAY_MS),
                week: summarizeInsights(summary.facts, nowMs, USAGE_WINDOW_WEEK_MS),
              },
        notice: summary.state === 'ok' ? undefined : summary.state,
        empty: summary.empty,
      }
      cached = { atMs: nowMs, result }
      return result
    },
  }
}

/** Compatibility-free facts API: callers must handle an incomplete read explicitly. */
export async function readTraceLogs(deps: TraceLogDeps): Promise<readonly TraceLogFacts[]> {
  const summary = await getTraceLogReader(deps).readSummary()
  if (summary.state !== 'ok') throw new Error('traceLogsUnavailable')
  return summary.facts
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

export async function readTraceAttemptSummary(
  deps: TraceLogDeps,
): Promise<{ attempts: UsagePageState['attempts']; stale: boolean }> {
  const summary = await getTraceLogReader(deps).readSummary()
  if (summary.state === 'unavailable') throw new Error('traceLogsUnavailable')
  return { attempts: attemptsOf(summary.facts), stale: summary.state === 'behind' }
}

export async function readTraceAttempts(deps: TraceLogDeps): Promise<UsagePageState['attempts']> {
  return attemptsOf(await readTraceLogs(deps))
}
