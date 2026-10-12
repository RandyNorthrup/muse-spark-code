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
  identity: FileIdentity
  locked: boolean
  /** When set, stat reports the content growing on every call (mid-read swap). */
  shifting: boolean
}

/** In-memory file system with an open counter for the refresh assertions. */
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
    port: TraceLogFs
  } = {
    files: new Map<string, FakeFile>(),
    opens: 0,
    listError: undefined,
    gate: undefined,
    inFlight: 0,
    port: undefined as unknown as TraceLogFs,
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
    stat: (file): Promise<{ size: number; mtimeMs: number; identity: FileIdentity }> => {
      const entry = state.files.get(file)
      if (entry === undefined) return Promise.reject(errno('ENOENT'))
      if (entry.shifting) entry.content += 'x'
      return Promise.resolve({
        size: Buffer.byteLength(entry.content, 'utf8'),
        mtimeMs: entry.mtimeMs,
        identity: entry.identity,
      })
    },
    streamLines: (file, onLine): Promise<void> => {
      state.opens += 1
      state.inFlight += 1
      return (async (): Promise<void> => {
        try {
          if (state.gate !== undefined) await state.gate()
          const entry = state.files.get(file)
          if (entry === undefined) throw errno('ENOENT')
          if (entry.locked) throw errno('EPERM')
          for (const line of entry.content.split(/\r?\n/)) onLine(line)
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
    fs.files.set(path.join(directory, name), {
      content: admission('2026-10-12T05:00:00.000Z', name),
      mtimeMs: NOW - 1000,
      identity: { dev: 1n, ino: BigInt(100 + index) },
      locked: false,
      shifting: false,
    })
  }
  return directory
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
    const third = await reader.readLogs(NOW)
    expect(fs.opens).toBe(4)
    expect(third.flatMap((facts) => facts.attempts)).toHaveLength(4)
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
    locked.locked = false
    expect(await reader.readLogs(NOW)).toHaveLength(2)
    expect(fs.opens).toBe(3)
  })

  it('a file replaced mid-read is skipped and retried next refresh', async () => {
    const home = tempHome()
    const fs = fakeFs()
    const directory = seed(fs, home, ['cli-a.log'])
    const shifting = fs.files.get(path.join(directory, 'cli-a.log'))
    if (shifting === undefined) throw new Error('seeded file missing')
    shifting.shifting = true
    const reader = createTraceLogReader({ homeDir: home, fs: fs.port })
    expect(await reader.readLogs(NOW)).toHaveLength(0)
    shifting.shifting = false
    expect(await reader.readLogs(NOW)).toHaveLength(1)
  })

  it('an oversize file is skipped without opening it', async () => {
    const home = tempHome()
    const fs = fakeFs()
    const directory = traceLogDirectory({ homeDir: home })
    fs.files.set(path.join(directory, 'cli-huge.log'), {
      content: admission('2026-10-12T05:00:00.000Z', 'huge'),
      mtimeMs: NOW - 1000,
      identity: { dev: 1n, ino: 7n },
      locked: false,
      shifting: false,
    })
    // The byte count is what matters, not the string length above: report big.
    const oversize: TraceLogFs = {
      ...fs.port,
      stat: () =>
        Promise.resolve({
          size: 9 * 1024 * 1024,
          mtimeMs: NOW - 1000,
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
      fs.files.set(path.join(directory, name), {
        content: admission('2026-10-12T05:00:00.000Z', name),
        mtimeMs: NOW - (names.length - i) * 1000,
        identity: { dev: 1n, ino: BigInt(1000 + i) },
        locked: false,
        shifting: false,
      })
    }
    const reader = createTraceLogReader({ homeDir: home, fs: fs.port })
    expect(await reader.readLogs(NOW)).toHaveLength(200)
    expect(fs.opens).toBe(200)
  })
})

describe('trace mtime cutoff', () => {
  it('skips files older than the widest caller window without opening them', async () => {
    const home = tempHome()
    const fs = fakeFs()
    const directory = traceLogDirectory({ homeDir: home })
    const cutoff = traceLogCutoffMs(NOW)
    expect(cutoff).toBe(NOW - USAGE_HISTORY_DAYS_MAX * USAGE_WINDOW_DAY_MS)
    fs.files.set(path.join(directory, 'cli-old.log'), {
      content: admission('2020-01-01T00:00:00.000Z', 'old'),
      mtimeMs: cutoff - 1,
      identity: { dev: 1n, ino: 1n },
      locked: false,
      shifting: false,
    })
    fs.files.set(path.join(directory, 'cli-edge.log'), {
      content: admission('2020-01-01T00:00:00.000Z', 'edge'),
      mtimeMs: cutoff,
      identity: { dev: 1n, ino: 2n },
      locked: false,
      shifting: false,
    })
    const reader = createTraceLogReader({ homeDir: home, fs: fs.port })
    const logs = await reader.readLogs(NOW)
    expect(logs).toHaveLength(2)
    // Only the boundary file was opened; the older one contributes nothing.
    expect(fs.opens).toBe(1)
    expect(logs.flatMap((facts) => facts.attempts).map((attempt) => attempt.runId)).toEqual([
      'edge',
    ])
  })
})

describe('streaming file reads', () => {
  it('a CRLF file with a partial last line matches the whole-text parse', async () => {
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
    expect(logs[0]).toEqual(parseTraceLog(content))
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
      streamLines: (file, onLine): Promise<void> => {
        opens += 1
        return defaultTraceLogFs.streamLines(file, onLine)
      },
    }
    const reader = createTraceLogReader({ homeDir: home, fs: counting })
    expect(await reader.readAttempts(NOW)).toHaveLength(1)
    expect(opens).toBe(1)
    expect(await reader.readAttempts(NOW)).toHaveLength(1)
    expect(opens).toBe(1)
  })
})
