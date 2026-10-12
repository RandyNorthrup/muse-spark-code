import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  TRACE_LOG_HEAD_BYTES,
  USAGE_HISTORY_DAYS_MAX,
  USAGE_WINDOW_DAY_MS,
} from '../../src/shared/constants'
import type { FileIdentity } from '../../src/core/fs/fileIdentity'
import { parseTraceLog } from '../../src/core/usage/insights'
import {
  createTraceLogReader,
  createTraceLineSplitter,
  defaultTraceLogFs,
  getTraceLogReader,
  summarizeTraceRead,
  traceLogCutoffMs,
  traceLogDirectory,
  type TraceFileRecord,
  type TraceListing,
  type TraceLogFs,
  type TraceLogReader,
} from '../../src/runtime/usage/traceLogs'
import { removeFolder } from './helpers/temporaryFolders'

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await removeFolder(folder)
})
function tempHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), 'muse-trace-reader-'))
  folders.push(home)
  return home
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

function headOf(content: string): string {
  return createHash('sha256')
    .update(Buffer.from(content, 'utf8').subarray(0, TRACE_LOG_HEAD_BYTES))
    .digest('hex')
}

interface FakeFile {
  content: string
  mtimeMs: number
  mtimeNs: string
  identity: FileIdentity
  locked: boolean
  /** Appended to the content while a stream is open (a host writing mid-read). */
  appendDuringStream: string
  /** One-shot: replaced content (and identity) while a stream is open. */
  shrinkDuringStream: { content: string; identity: FileIdentity } | undefined
  /** One-shot: replaced content on the SAME identity while a stream is open. */
  rewriteDuringStream: string | undefined
  /** The entry is removed when a stream opens: vanished between stat and read. */
  unlinkOnStream: boolean
  /** Every stat hands out a new identity and content: the file never settles. */
  churn: boolean
}

function fakeFile(content: string, mtimeMs: number, ino: number | bigint): FakeFile {
  return {
    content,
    mtimeMs,
    mtimeNs: String(BigInt(mtimeMs) * 1_000_000n),
    identity: { dev: 1n, ino: BigInt(ino) },
    locked: false,
    appendDuringStream: '',
    shrinkDuringStream: undefined,
    rewriteDuringStream: undefined,
    unlinkOnStream: false,
    churn: false,
  }
}

/**
 * In-memory file system honouring the snapshot contract: `streamLines`
 * reports only complete lines in the first `maxBytes` bytes (LF and CRLF;
 * a lone CR stays inside its line; the unterminated tail is dropped),
 * `readHead` fingerprints the first TRACE_LOG_HEAD_BYTES bytes as the
 * production reader does, and `stat` reports the content as it stands when
 * called.
 */
function fakeFs(): {
  files: Map<string, FakeFile>
  opens: number
  listError: NodeJS.ErrnoException | undefined
  gate: (() => Promise<void>) | undefined
  port: TraceLogFs
} {
  const state: {
    files: Map<string, FakeFile>
    opens: number
    listError: NodeJS.ErrnoException | undefined
    gate: (() => Promise<void>) | undefined
    inFlight: number
    churns: number
    port: TraceLogFs
  } = {
    files: new Map<string, FakeFile>(),
    opens: 0,
    listError: undefined,
    gate: undefined,
    inFlight: 0,
    churns: 0,
    port: undefined as unknown as TraceLogFs,
  }
  const snapshotOf = (entry: FakeFile): { size: number; mtimeMs: number; mtimeNs: string } => {
    if (entry.churn) {
      state.churns += 1
      entry.identity = { dev: 1n, ino: BigInt(1_000_000 + state.churns) }
      entry.content += 'x'
      entry.mtimeNs = String(BigInt(entry.mtimeMs) * 1_000_000n + BigInt(state.churns))
    }
    return {
      size: Buffer.byteLength(entry.content, 'utf8'),
      mtimeMs: entry.mtimeMs,
      mtimeNs: entry.mtimeNs,
    }
  }
  state.port = {
    list: (directory): Promise<readonly string[]> => {
      if (state.listError !== undefined) return Promise.reject(state.listError)
      const names: string[] = []
      for (const file of state.files.keys()) {
        if (path.dirname(file) === directory) names.push(path.basename(file))
      }
      return Promise.resolve(names)
    },
    stat: (
      file,
    ): Promise<{ size: number; mtimeMs: number; mtimeNs: string; identity: FileIdentity }> => {
      const entry = state.files.get(file)
      if (entry === undefined) return Promise.reject(errno('ENOENT'))
      const snapshot = snapshotOf(entry)
      return Promise.resolve({ ...snapshot, identity: entry.identity })
    },
    readHead: (file): Promise<string> => {
      const entry = state.files.get(file)
      if (entry === undefined) return Promise.reject(errno('ENOENT'))
      return entry.locked ? Promise.reject(errno('EPERM')) : Promise.resolve(headOf(entry.content))
    },
    streamLines: (file, maxBytes, onLine): Promise<void> => {
      state.opens += 1
      state.inFlight += 1
      return (async (): Promise<void> => {
        try {
          if (state.gate !== undefined) await state.gate()
          if (state.files.get(file)?.unlinkOnStream === true) state.files.delete(file)
          const entry = state.files.get(file)
          if (entry === undefined) throw errno('ENOENT')
          if (entry.locked) throw errno('EPERM')
          // The snapshot is the prefix as the first stat saw it: a host
          // write lands past it and only moves the after-stat.
          const prefix = Buffer.from(entry.content, 'utf8').subarray(0, maxBytes).toString('utf8')
          // One shot: the append lands during this read only, so a retry
          // parses a settled file the way a real host's write settles.
          if (entry.appendDuringStream !== '') {
            entry.content += entry.appendDuringStream
            entry.appendDuringStream = ''
          }
          const replacement = entry.shrinkDuringStream
          if (replacement !== undefined) {
            entry.shrinkDuringStream = undefined
            entry.content = replacement.content
            entry.identity = replacement.identity
            entry.mtimeMs = Date.now()
            entry.mtimeNs = String(BigInt(entry.mtimeMs) * 1_000_000n)
          }
          if (entry.rewriteDuringStream !== undefined) {
            entry.content = entry.rewriteDuringStream
            entry.rewriteDuringStream = undefined
            entry.mtimeMs = Date.now()
            entry.mtimeNs = String(BigInt(entry.mtimeMs) * 1_000_000n)
          }
          const complete = prefix.endsWith('\n') ? prefix.slice(0, -1) : null
          const body = complete ?? prefix.slice(0, prefix.lastIndexOf('\n'))
          if (complete !== null || prefix.includes('\n')) {
            for (const line of body.split('\n'))
              onLine(line.endsWith('\r') ? line.slice(0, -1) : line)
          }
        } finally {
          state.inFlight -= 1
        }
      })()
    },
  }
  return state
}

const NOW = Date.parse('2026-10-12T06:00:00.000Z')
const admission = (at: string, runId: string) =>
  `${at} INFO tbh.local.model x event="model.attempt.lifecycle" run_id="${runId}" attempt_id="a" task_id="t" phase="admission" outcome="accepted"\n`

function seed(fs: ReturnType<typeof fakeFs>, home: string, names: readonly string[]): string {
  const directory = traceLogDirectory({ homeDir: home })
  for (const [index, name] of names.entries()) {
    fs.files.set(
      path.join(directory, name),
      fakeFile(admission('2026-10-12T05:00:00.000Z', name), NOW - 1000, 100 + index),
    )
  }
  return directory
}

function seededReader(): {
  home: string
  fs: ReturnType<typeof fakeFs>
  directory: string
  reader: TraceLogReader
} {
  const home = tempHome()
  const fs = fakeFs()
  const directory = seed(fs, home, ['cli-a.log'])
  const reader = createTraceLogReader({ homeDir: home, fs: fs.port })
  return { home, fs, directory, reader }
}

function attemptTotal(rows: readonly { attempts: number }[]): number {
  return rows.reduce((total, row) => total + row.attempts, 0)
}

function filesOf(records: readonly TraceFileRecord[]): string[] {
  return records.map((record) => path.basename(record.file))
}

function testListing(outcome: TraceListing['outcome']): TraceListing {
  return {
    entries: [],
    outcome,
    reason: outcome === 'ok' ? 'current' : outcome,
  }
}

function testRecord(
  state: TraceFileRecord['state'],
  reason: TraceFileRecord['reason'],
): TraceFileRecord {
  return {
    file: 'cli-a.log',
    size: 10,
    mtimeNs: '1',
    facts: {
      firstMs: undefined,
      lastMs: undefined,
      attempts: [],
      runs: new Map(),
    },
    state,
    reason,
  }
}

describe('cached trace reader', () => {
  it('opens every file once, then zero when nothing changed, then one when one file grew', async () => {
    const home = tempHome()
    const fs = fakeFs()
    seed(fs, home, ['cli-a.log', 'cli-b.log', 'cli-c.log'])
    const reader = createTraceLogReader({ homeDir: home, fs: fs.port })
    const first = await reader.readLogs(NOW)
    expect(first).toHaveLength(3)
    expect(fs.opens).toBe(3)
    expect(await reader.readLogs(NOW)).toHaveLength(3)
    expect(fs.opens).toBe(3)
    const directory = traceLogDirectory({ homeDir: home })
    const grown = fs.files.get(path.join(directory, 'cli-b.log'))
    if (grown === undefined) throw new Error('seeded file missing')
    grown.content += admission('2026-10-12T05:30:00.000Z', 'cli-b.log')
    grown.mtimeMs = NOW
    grown.mtimeNs = String(BigInt(NOW) * 1_000_000n)
    const third = await reader.readLogs(NOW)
    expect(fs.opens).toBe(4)
    expect(third.flatMap((facts) => facts.attempts)).toHaveLength(4)
  })

  it('a rewrite inside one millisecond re-parses by nanosecond mtime', async () => {
    const { fs, directory, reader } = seededReader()
    expect(await reader.readLogs(NOW)).toHaveLength(1)
    expect(fs.opens).toBe(1)
    const rewritten = fs.files.get(path.join(directory, 'cli-a.log'))
    if (rewritten === undefined) throw new Error('seeded file missing')
    // Same byte size, same millisecond, same inode: only the content and
    // the nanosecond mtime move, so only mtimeNs can notice.
    rewritten.content = rewritten.content.replace('cli-a.log', 'cli-b.log')
    rewritten.mtimeNs = String(BigInt(rewritten.mtimeMs) * 1_000_000n + 7n)
    const second = await reader.readLogs(NOW)
    expect(fs.opens).toBe(2)
    expect(second.flatMap((facts) => facts.attempts).map((attempt) => attempt.runId)).toEqual([
      'cli-b.log',
    ])
  })

  it('concurrent callers share one refresh in flight', async () => {
    const home = tempHome()
    const fs = fakeFs()
    const { promise: gate, resolve: release } = Promise.withResolvers<undefined>()
    fs.gate = async () => {
      await gate
    }
    seed(fs, home, ['cli-a.log', 'cli-b.log'])
    const reader = createTraceLogReader({ homeDir: home, fs: fs.port })
    const firstPending = reader.readLogs(NOW)
    const secondPending = reader.readLogs(NOW)
    const attemptsPending = reader.readAttempts(NOW)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fs.opens).toBeLessThanOrEqual(2)
    release(undefined)
    const [first, second, attempts] = await Promise.all([
      firstPending,
      secondPending,
      attemptsPending,
    ])
    expect(first).toHaveLength(2)
    expect(second).toHaveLength(2)
    // Both files' attempts share one day and origin, so one grouped row.
    expect(attemptTotal(attempts)).toBe(2)
    expect(fs.opens).toBe(2)
  })

  it('two concurrent reads with different cutoffs each get their full answer', async () => {
    for (const isPageFirst of [true, false]) {
      const home = tempHome()
      const fs = fakeFs()
      const directory = traceLogDirectory({ homeDir: home })
      // One log from an earlier day, one from today: the page asks for
      // today only while the insights read takes the long backstop.
      fs.files.set(
        path.join(directory, 'cli-old.log'),
        fakeFile(
          admission('2026-10-01T05:00:00.000Z', 'old'),
          Date.parse('2026-10-01T06:00:00.000Z'),
          1,
        ),
      )
      fs.files.set(
        path.join(directory, 'cli-new.log'),
        fakeFile(admission('2026-10-12T05:00:00.000Z', 'new'), NOW - 1000, 2),
      )
      const { promise: gate, resolve: release } = Promise.withResolvers<undefined>()
      fs.gate = async () => {
        await gate
      }
      const reader = createTraceLogReader({ homeDir: home, fs: fs.port })
      // The page's day in local days, whatever the rig's timezone: the new
      // log's mtime is inside it and the old log's is outside it.
      const day = new Date(NOW - 1000)
      const today = `${String(day.getFullYear())}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
      // Start order must not matter: the narrower read starts first on one
      // pass and second on the other; the gate holds both inside the read.
      let page: Awaited<ReturnType<TraceLogReader['readAttempts']>>
      let insights: Awaited<ReturnType<TraceLogReader['readLogs']>>
      if (isPageFirst) {
        const pagePending = reader.readAttempts(NOW, today)
        const insightsPending = reader.readLogs(NOW)
        await new Promise((resolve) => setTimeout(resolve, 20))
        release(undefined)
        page = await pagePending
        insights = await insightsPending
      } else {
        const insightsPending = reader.readLogs(NOW)
        const pagePending = reader.readAttempts(NOW, today)
        await new Promise((resolve) => setTimeout(resolve, 20))
        release(undefined)
        insights = await insightsPending
        page = await pagePending
      }
      // The page sees today's log only; the joined wider read loses nothing.
      expect(attemptTotal(page)).toBe(1)
      expect(insights).toHaveLength(2)
      // Each file parsed exactly once across both callers: the wider read
      // joined the narrower read's in-flight parse of the shared file.
      expect(fs.opens).toBe(2)
      // A third read that needs everything reuses both parses.
      fs.gate = undefined
      expect(await reader.readLogs(NOW)).toHaveLength(2)
      expect(fs.opens).toBe(2)
    }
  })

  it('a listing failure reads as unavailable, keeps the cache, and retries next call', async () => {
    const home = tempHome()
    const fs = fakeFs()
    seed(fs, home, ['cli-a.log'])
    const reader = createTraceLogReader({ homeDir: home, fs: fs.port })
    expect(await reader.readLogs(NOW)).toHaveLength(1)
    expect(fs.opens).toBe(1)
    fs.listError = errno('EACCES')
    // No caller throws for a listing failure: the summary says so, with the
    // errno word as its reason, and the cache is untouched.
    const failed = await reader.readSummary(NOW)
    expect(failed.state).toBe('unavailable')
    expect(failed.reasons).toEqual(['EACCES'])
    expect(failed.empty).toBe(false)
    expect(await reader.readLogs(NOW)).toEqual([])
    expect(fs.opens).toBe(1)
    fs.listError = undefined
    // The cache survived the failed listing: nothing reopens.
    expect(await reader.readLogs(NOW)).toHaveLength(1)
    expect(fs.opens).toBe(1)
  })

  it('an absent directory reads as no logs, and only then as empty', async () => {
    const home = tempHome()
    const fs = fakeFs()
    fs.listError = errno('ENOENT')
    const reader = createTraceLogReader({ homeDir: home, fs: fs.port })
    expect(await reader.readLogs(NOW)).toEqual([])
    expect(await reader.readAttempts(NOW)).toEqual([])
    const summary = await reader.readSummary(NOW)
    expect(summary.state).toBe('ok')
    expect(summary.empty).toBe(true)
  })

  it('a locked file with no earlier parse is unreadable, never silent nothing', async () => {
    const home = tempHome()
    const fs = fakeFs()
    const directory = seed(fs, home, ['cli-a.log', 'cli-locked.log'])
    const locked = fs.files.get(path.join(directory, 'cli-locked.log'))
    if (locked === undefined) throw new Error('seeded file missing')
    locked.locked = true
    const reader = createTraceLogReader({ homeDir: home, fs: fs.port })
    // The locked file contributes no facts, but it always contributes a
    // record: the read is behind, with the lock as its reason.
    const summary = await reader.readSummary(NOW)
    expect(summary.facts).toHaveLength(1)
    expect(summary.state).toBe('behind')
    expect(summary.reasons).toEqual(['locked'])
    const records = new Map(summary.records.map((record) => [path.basename(record.file), record]))
    expect(records.get('cli-locked.log')).toMatchObject({ state: 'unreadable', reason: 'locked' })
    expect(records.get('cli-a.log')).toMatchObject({ state: 'fresh' })
    expect(reader.isTraceStale()).toBe(true)
    // A locked file is never cached as empty: releasing the lock parses it.
    locked.locked = false
    const recovered = await reader.readSummary(NOW)
    expect(recovered.state).toBe('ok')
    expect(recovered.facts).toHaveLength(2)
    expect(reader.isTraceStale()).toBe(false)
    expect(fs.opens).toBe(3)
  })

  it('a locked file with an earlier parse stands in as behind', async () => {
    const { fs, directory, reader } = seededReader()
    expect(await reader.readLogs(NOW)).toHaveLength(1)
    const locked = fs.files.get(path.join(directory, 'cli-a.log'))
    if (locked === undefined) throw new Error('seeded file missing')
    locked.locked = true
    const summary = await reader.readSummary(NOW)
    expect(summary.state).toBe('behind')
    expect(summary.reasons).toEqual(['locked'])
    expect(summary.records).toHaveLength(1)
    expect(summary.records[0]).toMatchObject({ state: 'behind', reason: 'locked' })
    // The served numbers are the last good parse, and the reader says so.
    expect(
      summary.facts.flatMap((facts) => facts.attempts).map((attempt) => attempt.runId),
    ).toEqual(['cli-a.log'])
    expect(reader.isTraceStale()).toBe(true)
    locked.locked = false
    const unlocked = await reader.readSummary(NOW)
    expect(unlocked.state).toBe('ok')
    expect(reader.isTraceStale()).toBe(false)
  })

  it('a log locked for the whole read stays unreadable across reads', async () => {
    const { fs, directory, reader } = seededReader()
    const locked = fs.files.get(path.join(directory, 'cli-a.log'))
    if (locked === undefined) throw new Error('seeded file missing')
    locked.locked = true
    for (let round = 0; round < 2; round += 1) {
      const summary = await reader.readSummary(NOW)
      expect(summary.state).toBe('unavailable')
      expect(summary.facts).toEqual([])
      expect(summary.records).toMatchObject([{ state: 'unreadable', reason: 'locked' }])
    }
    // On Windows a running host may hold its log locked for the whole
    // session; unlocking parses it on the next read without a restart.
    locked.locked = false
    const recovered = await reader.readSummary(NOW)
    expect(recovered.state).toBe('ok')
    expect(recovered.facts).toHaveLength(1)
  })

  it('a file grown between reads parses the new tail on the next read', async () => {
    const home = tempHome()
    const fs = fakeFs()
    const directory = seed(fs, home, ['cli-a.log'])
    const growing = fs.files.get(path.join(directory, 'cli-a.log'))
    if (growing === undefined) throw new Error('seeded file missing')
    const reader = createTraceLogReader({ homeDir: home, fs: fs.port })
    const before = await reader.readLogs(NOW)
    expect(before.flatMap((facts) => facts.attempts)).toHaveLength(1)
    expect(fs.opens).toBe(1)
    // The host appends one complete line and one torn piece after the read.
    growing.content += `${admission('2026-10-12T05:30:00.000Z', 'next')}2026-10-12T05:31:00.000Z INFO torn`
    growing.mtimeMs = NOW
    growing.mtimeNs = String(BigInt(NOW) * 1_000_000n)
    const second = await reader.readLogs(NOW)
    expect(fs.opens).toBe(2)
    // The torn tail is not a line yet: exactly the new complete line joins.
    expect(second.flatMap((facts) => facts.attempts)).toHaveLength(2)
    expect(reader.isTraceStale()).toBe(false)
  })

  it('an append during the read is picked up by the one re-read', async () => {
    const home = tempHome()
    const fs = fakeFs()
    const directory = seed(fs, home, ['cli-a.log'])
    const growing = fs.files.get(path.join(directory, 'cli-a.log'))
    if (growing === undefined) throw new Error('seeded file missing')
    // The host appends one complete line and one torn piece while streaming.
    growing.appendDuringStream = `${admission('2026-10-12T05:30:00.000Z', 'next')}2026-10-12T05:31:00.000Z INFO torn`
    const reader = createTraceLogReader({ homeDir: home, fs: fs.port })
    // The first snapshot went stale mid-read, so the single re-read parses
    // the fresh snapshot: nothing is dropped and nothing is counted twice.
    const first = await reader.readLogs(NOW)
    expect(first).toHaveLength(1)
    expect(first.flatMap((facts) => facts.attempts)).toHaveLength(2)
    expect(reader.isTraceStale()).toBe(false)
    expect(fs.opens).toBe(2)
  })

  it('a file shrinking mid-read is re-read once in the same refresh', async () => {
    const home = tempHome()
    const fs = fakeFs()
    const directory = seed(fs, home, ['cli-a.log'])
    const shrinking = fs.files.get(path.join(directory, 'cli-a.log'))
    if (shrinking === undefined) throw new Error('seeded file missing')
    shrinking.shrinkDuringStream = {
      content: admission('2026-10-12T05:30:00.000Z', 'rotated'),
      identity: { dev: 1n, ino: 999n },
    }
    const reader = createTraceLogReader({ homeDir: home, fs: fs.port })
    const first = await reader.readLogs(NOW)
    expect(first).toHaveLength(1)
    expect(first.flatMap((facts) => facts.attempts).map((attempt) => attempt.runId)).toEqual([
      'rotated',
    ])
    expect(reader.isTraceStale()).toBe(false)
  })

  it('a same-size rewrite on the same inode is seen by its head', async () => {
    const { fs, directory, reader } = seededReader()
    expect(await reader.readLogs(NOW)).toHaveLength(1)
    expect(fs.opens).toBe(1)
    const rewritten = fs.files.get(path.join(directory, 'cli-a.log'))
    if (rewritten === undefined) throw new Error('seeded file missing')
    // Truncated and rewritten in place: same inode, same or larger size,
    // new content. The head fingerprint moves, so the next read re-parses
    // instead of serving the stale facts as fresh.
    rewritten.content = admission('2026-10-12T05:30:00.000Z', 'rewritten')
    rewritten.mtimeNs = String(BigInt(rewritten.mtimeMs) * 1_000_000n + 11n)
    const second = await reader.readSummary(NOW)
    expect(fs.opens).toBe(2)
    expect(second.state).toBe('ok')
    expect(second.facts.flatMap((facts) => facts.attempts).map((attempt) => attempt.runId)).toEqual(
      ['rewritten'],
    )
  })

  it('a same-size rewrite during the read is re-read once in the same refresh', async () => {
    const { fs, directory, reader } = seededReader()
    const target = fs.files.get(path.join(directory, 'cli-a.log'))
    if (target === undefined) throw new Error('seeded file missing')
    target.rewriteDuringStream = admission('2026-10-12T05:30:00.000Z', 'rewritten')
    const summary = await reader.readSummary(NOW)
    expect(summary.state).toBe('ok')
    expect(
      summary.facts.flatMap((facts) => facts.attempts).map((attempt) => attempt.runId),
    ).toEqual(['rewritten'])
    expect(reader.isTraceStale()).toBe(false)
  })

  it('files on an inode-0 file system are told apart by their heads', async () => {
    const home = tempHome()
    const fs = fakeFs()
    const directory = traceLogDirectory({ homeDir: home })
    // Network shares and FAT/exFAT report ino 0 for every file: device and
    // inode alone alias them all into one file. The head hash separates them.
    for (const name of ['cli-a.log', 'cli-b.log']) {
      fs.files.set(path.join(directory, name), {
        ...fakeFile(admission('2026-10-12T05:00:00.000Z', name), NOW - 1000, 0),
        identity: { dev: 0n, ino: 0n },
      })
    }
    const reader = createTraceLogReader({ homeDir: home, fs: fs.port })
    const first = await reader.readLogs(NOW)
    expect(first).toHaveLength(2)
    expect(fs.opens).toBe(2)
    // ... and an unchanged inode-0 file is never opened again.
    expect(await reader.readLogs(NOW)).toHaveLength(2)
    expect(fs.opens).toBe(2)
  })

  it('a file that keeps changing is unreadable after one re-read', async () => {
    const { fs, directory, reader } = seededReader()
    expect(await reader.readLogs(NOW)).toHaveLength(1)
    expect(reader.isTraceStale()).toBe(false)
    const churning = fs.files.get(path.join(directory, 'cli-a.log'))
    if (churning === undefined) throw new Error('seeded file missing')
    churning.churn = true
    // Every stat hands out a new identity and head, so both parse attempts
    // go stale: the record is unreadable ("still changing"), never a
    // silent gap and never served as fresh.
    const second = await reader.readSummary(NOW)
    expect(second.state).toBe('unavailable')
    expect(second.records).toMatchObject([{ state: 'unreadable', reason: 'changing' }])
    churning.churn = false
    const recovered = await reader.readSummary(NOW)
    expect(recovered.state).toBe('ok')
    expect(recovered.facts).toHaveLength(1)
    expect(reader.isTraceStale()).toBe(false)
  })

  it('a file that vanished between the listing and the read is unreadable', async () => {
    const { fs, directory, reader } = seededReader()
    const target = fs.files.get(path.join(directory, 'cli-a.log'))
    if (target === undefined) throw new Error('seeded file missing')
    target.unlinkOnStream = true
    const summary = await reader.readSummary(NOW)
    expect(summary.state).toBe('unavailable')
    expect(summary.records).toMatchObject([{ state: 'unreadable', reason: 'vanished' }])
  })

  it('an oversize file keeps its within-limit lines and never vanishes', async () => {
    const home = tempHome()
    const fs = fakeFs()
    const directory = traceLogDirectory({ homeDir: home })
    fs.files.set(
      path.join(directory, 'cli-huge.log'),
      fakeFile(admission('2026-10-12T05:00:00.000Z', 'huge'), NOW - 1000, 7),
    )
    // The byte count is what matters, not the string length above: report big.
    const oversize: TraceLogFs = {
      ...fs.port,
      stat: () =>
        Promise.resolve({
          size: 9 * 1024 * 1024,
          mtimeMs: NOW - 1000,
          mtimeNs: String(BigInt(NOW - 1000) * 1_000_000n),
          identity: { dev: 1n, ino: 7n },
        }),
    }
    const reader = createTraceLogReader({ homeDir: home, fs: oversize })
    const summary = await reader.readSummary(NOW)
    expect(summary.state).toBe('behind')
    expect(summary.reasons).toEqual(['over-limit'])
    expect(summary.records).toMatchObject([{ state: 'oversize', reason: 'over-limit' }])
    // The complete lines within the limit are kept: the attempt still shows.
    expect(
      summary.facts.flatMap((facts) => facts.attempts).map((attempt) => attempt.runId),
    ).toEqual(['huge'])
    expect(fs.opens).toBe(1)
  })

  it('a throw from the line parser is that file’s unreadable record', async () => {
    const home = tempHome()
    const fs = fakeFs()
    seed(fs, home, ['cli-a.log'])
    const reader = createTraceLogReader({
      homeDir: home,
      fs: fs.port,
      parseLine: () => {
        throw new Error('parser canary')
      },
    })
    // The throw never escapes the read: the file is unreadable, named.
    const summary = await reader.readSummary(NOW)
    expect(summary.state).toBe('unavailable')
    expect(summary.records).toMatchObject([{ state: 'unreadable', reason: 'unparseable' }])
    expect(summary.facts).toEqual([])
  })

  it('reads at most the newest 200 files in a fixed order', async () => {
    const home = tempHome()
    const fs = fakeFs()
    const names = Array.from({ length: 201 }, (_, i) => `cli-${String(i).padStart(3, '0')}.log`)
    const directory = traceLogDirectory({ homeDir: home })
    for (const [i, name] of names.entries()) {
      fs.files.set(
        path.join(directory, name),
        fakeFile(
          admission('2026-10-12T05:00:00.000Z', name),
          NOW - (names.length - i) * 1000,
          1000 + i,
        ),
      )
    }
    const reader = createTraceLogReader({ homeDir: home, fs: fs.port })
    expect(await reader.readLogs(NOW)).toHaveLength(200)
    expect(fs.opens).toBe(200)
  })

  it('equal mtimes break ties by name, so the window never flips', async () => {
    const home = tempHome()
    const fs = fakeFs()
    const directory = traceLogDirectory({ homeDir: home })
    // 201 files with the SAME nanosecond mtime: sort order alone decides
    // the window, never the pool's push order.
    for (let i = 200; i >= 0; i -= 1) {
      const name = `cli-${String(i).padStart(3, '0')}.log`
      fs.files.set(
        path.join(directory, name),
        fakeFile(admission('2026-10-12T05:00:00.000Z', name), NOW - 1000, 1000 + i),
      )
    }
    // Reverse the listing order underneath: the window must not follow it.
    const listed: string[] = []
    for (const file of fs.files.keys()) listed.unshift(file)
    const reversed: TraceLogFs = {
      ...fs.port,
      list: async (dir) => {
        await fs.port.list(dir)
        return listed
          .filter((file) => path.dirname(file) === dir)
          .map((file) => path.basename(file))
      },
    }
    const reader = createTraceLogReader({ homeDir: home, fs: reversed })
    const first = await reader.readSummary(NOW)
    const second = await reader.readSummary(NOW)
    expect(first.records).toHaveLength(200)
    // Newest-first by mtime (all equal), then by name: cli-000..cli-199.
    expect(filesOf(first.records)).toEqual(filesOf(second.records))
    expect(filesOf(first.records)[0]).toBe('cli-000.log')
    expect(filesOf(first.records)[199]).toBe('cli-199.log')
  })
})

describe('trace age cutoff', () => {
  it('with no query keeps the old backstop and skips older files unopened', async () => {
    const home = tempHome()
    const fs = fakeFs()
    const directory = traceLogDirectory({ homeDir: home })
    const cutoff = traceLogCutoffMs(NOW)
    expect(cutoff).toBe(NOW - USAGE_HISTORY_DAYS_MAX * USAGE_WINDOW_DAY_MS)
    fs.files.set(
      path.join(directory, 'cli-old.log'),
      fakeFile(admission('2020-01-01T00:00:00.000Z', 'old'), cutoff - 1, 1),
    )
    fs.files.set(
      path.join(directory, 'cli-edge.log'),
      fakeFile(admission('2020-01-01T00:00:00.000Z', 'edge'), cutoff, 2),
    )
    const reader = createTraceLogReader({ homeDir: home, fs: fs.port })
    const logs = await reader.readLogs(NOW)
    expect(logs).toHaveLength(1)
    // Only the boundary file was opened; the older one was never parsed.
    expect(fs.opens).toBe(1)
    expect(logs.flatMap((facts) => facts.attempts).map((attempt) => attempt.runId)).toEqual([
      'edge',
    ])
  })

  it('a custom range before the old backstop still counts an old-mtime file', async () => {
    const home = tempHome()
    const fs = fakeFs()
    const directory = traceLogDirectory({ homeDir: home })
    const mtime = Date.parse('2020-06-01T12:00:00.000Z')
    fs.files.set(
      path.join(directory, 'cli-old.log'),
      fakeFile(admission('2020-01-01T00:00:00.000Z', 'old'), mtime, 1),
    )
    const reader = createTraceLogReader({ homeDir: home, fs: fs.port })
    // The query reaches back to 2020: the old-mtime file is opened, not cut.
    const attempts = await reader.readAttempts(NOW, '2020-01-01')
    expect(fs.opens).toBe(1)
    expect(attemptTotal(attempts)).toBe(1)
    // And a query starting after the file's mtime skips it without opening.
    const fsOpens = fs.opens
    const fresh = createTraceLogReader({ homeDir: home, fs: fs.port })
    await fresh.readAttempts(NOW, '2021-01-01')
    expect(fs.opens).toBe(fsOpens)
  })
})

describe('single-scan line splitter', () => {
  it('scans an 8 MiB line once, not once per chunk', () => {
    const lines: string[] = []
    const splitter = createTraceLineSplitter((line) => {
      lines.push(line)
    })
    const total = 8 * 1024 * 1024
    const line = `2026-10-12T05:00:00.000Z INFO ${'x'.repeat(total - 64)}\n`
    const chunkSize = 64 * 1024
    for (let offset = 0; offset < line.length; offset += chunkSize) {
      splitter.push(line.slice(offset, offset + chunkSize))
    }
    splitter.finish()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe(line.slice(0, -1))
    // The old re-splitting tail scanned the growing line ~128 times
    // (8 MiB / 64 KiB chunks); each byte is now searched once.
    expect(splitter.scannedBytes).toBeLessThanOrEqual(2 * Buffer.byteLength(line, 'utf8'))
  })

  it('splits CRLF across chunks and keeps a lone CR inside its line', () => {
    const lines: string[] = []
    const splitter = createTraceLineSplitter((line) => {
      lines.push(line)
    })
    // A CRLF split across two pushes still ends one line...
    splitter.push('first line\r')
    splitter.push('\nsecond')
    // ... a lone CR stays inside its line, and the torn tail is dropped.
    splitter.push(' with\rcarriage\ntorn tail')
    splitter.finish()
    expect(lines).toEqual(['first line', 'second with\rcarriage'])
  })
})

describe('summarizeTraceRead', () => {
  it('is ok only when every record is fresh, and empty only with no files', () => {
    const ok = summarizeTraceRead([testRecord('fresh', 'current')], testListing('ok'))
    expect(ok.state).toBe('ok')
    expect(ok.empty).toBe(false)
    expect(ok.reasons).toEqual([])
    const empty = summarizeTraceRead([], testListing('empty'))
    expect(empty.state).toBe('ok')
    expect(empty.empty).toBe(true)
    const behind = summarizeTraceRead(
      [testRecord('fresh', 'current'), testRecord('behind', 'locked')],
      testListing('ok'),
    )
    expect(behind.state).toBe('behind')
    expect(behind.reasons).toEqual(['locked'])
    expect(behind.empty).toBe(false)
    const failed = summarizeTraceRead([], testListing('failed'))
    expect(failed.state).toBe('unavailable')
    expect(failed.empty).toBe(false)
  })

  it('unreadable files add facts only through a behind stand-in', () => {
    const summary = summarizeTraceRead([testRecord('unreadable', 'denied')], testListing('ok'))
    expect(summary.state).toBe('unavailable')
    expect(summary.facts).toEqual([])
    expect(summary.reasons).toEqual(['denied'])
  })
})

describe('streaming file reads', () => {
  it('a CRLF file counts only complete lines, matching the whole-text parse of the complete prefix', async () => {
    const home = tempHome()
    const directory = traceLogDirectory({ homeDir: home })
    const { mkdirSync } = await import('node:fs')
    mkdirSync(directory, { recursive: true })
    const lines = [
      '2026-10-12T05:00:00.000Z INFO tbh.local.runtime x event="runtime.run.lifecycle" run_kind="turn" phase="started" command_id=r1 run_id=r1 outcome="running"',
      '2026-10-12T05:00:01.000Z INFO tbh.local.tool x event="tool.surface.registered" run_id=r1 epoch_ordinal=0 registered_tool_count=1 outcome="registered"',
      admission('2026-10-12T05:00:02.000Z', 'r1').trimEnd(),
      'garbage without a stamp',
    ]
    const content = `${lines.join('\r\n')}\r\n2026-10-12T05:00:03.000Z INFO partial line without ending`
    writeFileSync(path.join(directory, 'cli-crlf.log'), content)
    const reader = createTraceLogReader({ homeDir: home })
    const logs = await reader.readLogs(NOW)
    expect(logs).toHaveLength(1)
    // The torn tail is not a line yet: the facts equal the complete prefix.
    const complete = content.slice(0, content.lastIndexOf('\n') + 1)
    expect(logs[0]).toEqual(parseTraceLog(complete))
  })

  it('readers without an injected fs are shared per home folder', () => {
    const home = tempHome()
    expect(getTraceLogReader({ homeDir: home })).toBe(getTraceLogReader({ homeDir: home }))
    expect(getTraceLogReader({ homeDir: home })).not.toBe(createTraceLogReader({ homeDir: home }))
  })

  it('the default fs streams real files', async () => {
    const home = tempHome()
    const directory = traceLogDirectory({ homeDir: home })
    const { mkdirSync } = await import('node:fs')
    mkdirSync(directory, { recursive: true })
    writeFileSync(path.join(directory, 'cli-real.log'), admission('2026-10-12T05:00:00.000Z', 'r'))
    let opens = 0
    const counting: TraceLogFs = {
      ...defaultTraceLogFs,
      streamLines: (file, maxBytes, onLine): Promise<void> => {
        opens += 1
        return defaultTraceLogFs.streamLines(file, maxBytes, onLine)
      },
    }
    const reader = createTraceLogReader({ homeDir: home, fs: counting })
    expect(await reader.readAttempts(NOW)).toHaveLength(1)
    expect(opens).toBe(1)
    expect(await reader.readAttempts(NOW)).toHaveLength(1)
    expect(opens).toBe(1)
  })
})
