import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { USAGE_HISTORY_DAYS_MAX, USAGE_WINDOW_DAY_MS } from '../../src/shared/constants'
import type { FileIdentity } from '../../src/core/fs/fileIdentity'
import { parseTraceLog } from '../../src/core/usage/insights'
import {
  createTraceLogReader,
  defaultTraceLogFs,
  getTraceLogReader,
  traceLogCutoffMs,
  traceLogDirectory,
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
  /** Every stat hands out a new identity and content: the file never settles. */
  churn: boolean
}

function fakeFile(content: string, mtimeMs: number, ino: number): FakeFile {
  return {
    content,
    mtimeMs,
    mtimeNs: String(BigInt(mtimeMs) * 1_000_000n),
    identity: { dev: 1n, ino: BigInt(ino) },
    locked: false,
    appendDuringStream: '',
    shrinkDuringStream: undefined,
    churn: false,
  }
}

/**
 * In-memory file system honouring the snapshot contract: `streamLines`
 * reports only complete lines in the first `maxBytes` bytes (LF and CRLF;
 * a lone CR stays inside its line; the unterminated tail is dropped), and
 * `stat` reports the content as it stands when called.
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
    streamLines: (file, maxBytes, onLine): Promise<void> => {
      state.opens += 1
      state.inFlight += 1
      return (async (): Promise<void> => {
        try {
          if (state.gate !== undefined) await state.gate()
          const entry = state.files.get(file)
          if (entry === undefined) throw errno('ENOENT')
          if (entry.locked) throw errno('EPERM')
          // The snapshot is the prefix as the first stat saw it: a host
          // write lands past it and only moves the after-stat.
          const prefix = Buffer.from(entry.content, 'utf8').subarray(0, maxBytes).toString('utf8')
          if (entry.appendDuringStream !== '') entry.content += entry.appendDuringStream
          const replacement = entry.shrinkDuringStream
          if (replacement !== undefined) {
            entry.shrinkDuringStream = undefined
            entry.content = replacement.content
            entry.identity = replacement.identity
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
    expect(attempts.reduce((total, row) => total + row.attempts, 0)).toBe(2)
    expect(fs.opens).toBe(2)
  })

  it('a listing failure rejects every sharer, keeps the cache, and retries next call', async () => {
    const home = tempHome()
    const fs = fakeFs()
    seed(fs, home, ['cli-a.log'])
    const reader = createTraceLogReader({ homeDir: home, fs: fs.port })
    expect(await reader.readLogs(NOW)).toHaveLength(1)
    expect(fs.opens).toBe(1)
    fs.listError = errno('EACCES')
    await expect(
      Promise.all([reader.readLogs(NOW), reader.readLogs(NOW), reader.readAttempts(NOW)]),
    ).rejects.toMatchObject({ code: 'EACCES' })
    expect(fs.opens).toBe(1)
    fs.listError = undefined
    // The cache survived the failed refresh: nothing reopens.
    expect(await reader.readLogs(NOW)).toHaveLength(1)
    expect(fs.opens).toBe(1)
  })

  it('an absent directory reads as no logs', async () => {
    const home = tempHome()
    const fs = fakeFs()
    fs.listError = errno('ENOENT')
    const reader = createTraceLogReader({ homeDir: home, fs: fs.port })
    expect(await reader.readLogs(NOW)).toEqual([])
    expect(await reader.readAttempts(NOW)).toEqual([])
  })

  it('a locked file is skipped and retried, never cached as empty', async () => {
    const home = tempHome()
    const fs = fakeFs()
    const directory = seed(fs, home, ['cli-a.log', 'cli-locked.log'])
    const locked = fs.files.get(path.join(directory, 'cli-locked.log'))
    if (locked === undefined) throw new Error('seeded file missing')
    locked.locked = true
    const reader = createTraceLogReader({ homeDir: home, fs: fs.port })
    expect(await reader.readLogs(NOW)).toHaveLength(1)
    expect(fs.opens).toBe(2)
    expect(reader.isTraceStale()).toBe(false)
    locked.locked = false
    expect(await reader.readLogs(NOW)).toHaveLength(2)
    expect(fs.opens).toBe(3)
  })

  it('a file growing mid-read counts its snapshot lines and parses the tail next refresh', async () => {
    const home = tempHome()
    const fs = fakeFs()
    const directory = seed(fs, home, ['cli-a.log'])
    const growing = fs.files.get(path.join(directory, 'cli-a.log'))
    if (growing === undefined) throw new Error('seeded file missing')
    // The host appends one complete line and one torn piece while streaming.
    growing.appendDuringStream = `${admission('2026-10-12T05:30:00.000Z', 'next')}2026-10-12T05:31:00.000Z INFO torn`
    const reader = createTraceLogReader({ homeDir: home, fs: fs.port })
    // The snapshot's complete line is counted: nothing is dropped.
    const first = await reader.readLogs(NOW)
    expect(first).toHaveLength(1)
    expect(first.flatMap((facts) => facts.attempts)).toHaveLength(1)
    expect(reader.isTraceStale()).toBe(false)
    growing.appendDuringStream = ''
    // The next refresh sees the growth and parses the new tail in full.
    const second = await reader.readLogs(NOW)
    expect(fs.opens).toBe(2)
    expect(second.flatMap((facts) => facts.attempts)).toHaveLength(2)
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

  it('a file that keeps changing keeps its last good parse and reports stale', async () => {
    const { fs, directory, reader } = seededReader()
    expect(await reader.readLogs(NOW)).toHaveLength(1)
    expect(reader.isTraceStale()).toBe(false)
    const churning = fs.files.get(path.join(directory, 'cli-a.log'))
    if (churning === undefined) throw new Error('seeded file missing')
    churning.churn = true
    // Every stat hands out a new identity, so both parse attempts go stale:
    // the served numbers are the last good parse, and the reader says so.
    const second = await reader.readLogs(NOW)
    expect(second).toHaveLength(1)
    expect(second.flatMap((facts) => facts.attempts).map((attempt) => attempt.runId)).toEqual([
      'cli-a.log',
    ])
    expect(reader.isTraceStale()).toBe(true)
    churning.churn = false
    expect(await reader.readLogs(NOW)).toHaveLength(1)
    expect(reader.isTraceStale()).toBe(false)
  })

  it('an oversize file is skipped without opening it', async () => {
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
    expect(await reader.readLogs(NOW)).toEqual([])
    expect(fs.opens).toBe(0)
  })

  it('reads at most the newest 200 files', async () => {
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
    expect(logs).toHaveLength(2)
    // Only the boundary file was opened; the older one contributes nothing.
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
    expect(attempts.reduce((total, row) => total + row.attempts, 0)).toBe(1)
    // And a query starting after the file's mtime skips it without opening.
    const fsOpens = fs.opens
    const fresh = createTraceLogReader({ homeDir: home, fs: fs.port })
    await fresh.readAttempts(NOW, '2021-01-01')
    expect(fs.opens).toBe(fsOpens)
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
