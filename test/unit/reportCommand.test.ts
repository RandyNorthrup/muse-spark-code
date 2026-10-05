// Report a problem, lane A (M93, PLAN.md D72): the headless `report`
// subcommand and its recorder adapter in src/runtime/reportCommand.ts.
// No backend, auth or model ever starts here: every side effect is an
// injected fake, the network is a throwing stub, and a source guard pins
// the module's imports.

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import {
  appendReportJournalEntry,
  collectReportFacts,
  parseReportJournalBytes,
  reportJournalPath,
  runReportCommand,
  type ReportFactsDeps,
  type RunReportDeps,
} from '../../src/runtime/reportCommand'
import { buildProblemReportDraft } from '../../src/core/support/problemReport'
import {
  EXEC_EXIT,
  REDACTED_MARK,
  REPORT_JOURNAL_MAX_BYTES,
  type ReportEventKind,
  UI_TEXT,
} from '../../src/shared/constants'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOW_MS = 1_769_000_000_000
const VERSION = '0.12.1'

const VALID_ENTRY = {
  kind: 'backendExit',
  code: 'ECONNRESET',
  frames: [{ path: 'dist/extension.js', line: 12, column: 4 }],
  atMs: NOW_MS - 180_000,
}

function journalBytes(entries: readonly unknown[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ version: 1, entries }))
}

function factsDeps(overrides: Partial<ReportFactsDeps> = {}): ReportFactsDeps {
  return {
    version: VERSION,
    nodeVersion: 'v22.20.4',
    platform: 'linux',
    pathEntries: [],
    homeDir: '/home/tester',
    xdgConfigHome: undefined,
    museBinaryPath: '',
    fileExists: () => false,
    readTextFile: () => undefined,
    listDirectory: () => [],
    hasEnvironmentApiKey: false,
    hasStoredApiKey: false,
    ...overrides,
  }
}

interface Captured {
  readonly written: string[]
  readonly errors: string[]
  readonly files: Map<string, string>
}

function runDeps(
  journal: Uint8Array | undefined,
  overrides: Partial<RunReportDeps> = {},
): {
  deps: RunReportDeps
  captured: Captured
} {
  const captured: Captured = { written: [], errors: [], files: new Map() }
  const deps: RunReportDeps = {
    ...factsDeps(),
    options: { out: undefined, description: '', includeFacts: true, includeEvents: true },
    readStoredKeyPresence: () => Promise.resolve(false),
    nowMs: NOW_MS,
    journalPath: '/data/problem-report-journal.json',
    readJournal: () => Promise.resolve(journal),
    writeStdout: (text) => {
      captured.written.push(text)
    },
    writeOutFile: (file, text) => {
      captured.files.set(file, text)
      return Promise.resolve()
    },
    printError: (line) => {
      captured.errors.push(line)
    },
    ...overrides,
  }
  return { deps, captured }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

interface MemoryJournal {
  readonly files: Map<string, Uint8Array>
  readonly readBytes: (file: string) => Promise<Uint8Array | undefined>
  readonly writeBytes: (file: string, bytes: Uint8Array) => Promise<void>
  readonly ensureDir: (directory: string) => Promise<void>
  readonly dirs: string[]
}

function memory(initial?: Uint8Array): MemoryJournal {
  const files = new Map<string, Uint8Array>()
  if (initial !== undefined) {
    files.set('/data/problem-report-journal.json', initial)
  }
  const dirs: string[] = []
  return {
    files,
    readBytes: (file) => Promise.resolve(files.get(file)),
    writeBytes: (file, bytes) => {
      files.set(file, bytes)
      return Promise.resolve()
    },
    ensureDir: (directory) => {
      dirs.push(directory)
      return Promise.resolve()
    },
    dirs,
  }
}

describe('report argument parsing', () => {
  it('takes no arguments: the full scrubbed report on stdout', () => {
    expect(parseCommandLine(['report'])).toEqual({
      command: 'report',
      options: { out: undefined, description: '', includeFacts: true, includeEvents: true },
    })
  })

  it('takes --out, --description and the section switches', () => {
    expect(
      parseCommandLine([
        'report',
        '--out',
        'report.md',
        '--description',
        'the panel went blank',
        '--no-facts',
        '--no-events',
      ]),
    ).toEqual({
      command: 'report',
      options: {
        out: 'report.md',
        description: 'the panel went blank',
        includeFacts: false,
        includeEvents: false,
      },
    })
  })

  it('refuses positionals, unknown flags and an empty --out with exit 2', () => {
    for (const argv of [
      ['report', 'extra'],
      ['report', '--bogus'],
      ['report', '--out'],
      ['report', '--out', ''],
    ]) {
      const parsed = parseCommandLine(argv)
      expect(parsed, argv.join(' ')).toMatchObject({ command: 'invalid', exitCode: 2 })
      if (parsed.command === 'invalid') {
        expect(parsed.reason).toContain('Usage:')
      }
    }
  })

  it('answers --help with the top-level help', () => {
    expect(parseCommandLine(['report', '--help'])).toEqual({ command: 'help' })
  })
})

describe('runReportCommand', () => {
  it('prints the sealed draft and nothing else on stdout, exit 0', async () => {
    const { deps, captured } = runDeps(journalBytes([VALID_ENTRY]))
    const code = await runReportCommand(deps)
    expect(code).toBe(EXEC_EXIT.ok)
    expect(captured.errors).toEqual([])
    expect(captured.written).toHaveLength(1)
    const expected = buildProblemReportDraft({
      description: '',
      includeFacts: true,
      includeEvents: true,
      facts: collectReportFacts({ ...deps, hasStoredApiKey: false }),
      events: parseReportJournalBytes(journalBytes([VALID_ENTRY]), NOW_MS).events,
      recordingUnavailable: false,
      nowMs: NOW_MS,
      scrub: { workspaceRoots: [], homeDir: '/home/tester', extraLiterals: [] },
    })
    expect(captured.written[0]).toBe(expected.text)
    expect(captured.written[0]).toContain('Muse Spark problem report')
    expect(captured.written[0]).toContain('backendExit ECONNRESET')
  })

  it('honours the section switches', async () => {
    const { deps, captured } = runDeps(journalBytes([VALID_ENTRY]), {
      options: { out: undefined, description: '', includeFacts: false, includeEvents: false },
    })
    expect(await runReportCommand(deps)).toBe(EXEC_EXIT.ok)
    expect(captured.written).toHaveLength(1)
    expect(captured.written[0]).not.toContain('Support facts:')
    expect(captured.written[0]).not.toContain('Recent events')
  })

  it('--out writes the exact bytes to the file and nothing to stdout', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'm93a-report-'))
    const file = path.join(folder, 'report.md')
    let saved = ''
    const { deps, captured } = runDeps(journalBytes([VALID_ENTRY]), {
      options: { out: file, description: 'blank panel', includeFacts: true, includeEvents: true },
      writeOutFile: (target, text) => {
        saved = text
        writeFileSync(target, text, 'utf8')
        return Promise.resolve()
      },
    })
    expect(await runReportCommand(deps)).toBe(EXEC_EXIT.ok)
    expect(captured.written).toEqual([])
    expect(captured.errors).toEqual([])
    expect(readFileSync(file, 'utf8')).toBe(saved)
    expect(saved).toContain('What was happening:\nblank panel')
    expect(saved).toContain('Muse Spark problem report')
  })

  it('a missing journal reads as no events, not unavailable', async () => {
    const { deps, captured } = runDeps(undefined)
    expect(await runReportCommand(deps)).toBe(EXEC_EXIT.ok)
    expect(captured.written[0]).toContain('Recent events (0):')
    expect(captured.written[0]).not.toContain('was unavailable')
  })

  it('an oversize journal reads unavailable, exit 0', async () => {
    // Valid JSON past the cap: only the size gate refuses it (a drill that
    // removes the gate sees these events instead of the unavailable line).
    const entries: unknown[] = []
    while (
      new TextEncoder().encode(JSON.stringify({ version: 1, entries })).length <=
      REPORT_JOURNAL_MAX_BYTES
    ) {
      entries.push({ ...VALID_ENTRY, atMs: NOW_MS - entries.length })
    }
    expect(
      new TextEncoder().encode(JSON.stringify({ version: 1, entries })).length,
    ).toBeGreaterThan(REPORT_JOURNAL_MAX_BYTES)
    const { deps, captured } = runDeps(journalBytes(entries))
    expect(await runReportCommand(deps)).toBe(EXEC_EXIT.ok)
    expect(captured.written).toHaveLength(1)
    expect(captured.written[0]).toContain('event recording was unavailable')
    expect(captured.written[0]).not.toContain('backendExit ECONNRESET')
  })

  it.each([
    ['unparseable', 'not json{'],
    ['wrong version', JSON.stringify({ version: 999, entries: [VALID_ENTRY] })],
    ['entries not an array', JSON.stringify({ version: 1, entries: 'nope' })],
    ['no entries', JSON.stringify({ version: 1 })],
    ['not an object', JSON.stringify([VALID_ENTRY])],
  ])('a %s journal reads unavailable, exit 0', async (_name, body) => {
    const { deps, captured } = runDeps(new TextEncoder().encode(body))
    expect(await runReportCommand(deps)).toBe(EXEC_EXIT.ok)
    expect(captured.written).toHaveLength(1)
    expect(captured.written[0]).toContain('event recording was unavailable')
  })

  it('undecodable bytes read unavailable, exit 0', async () => {
    const { deps, captured } = runDeps(
      new Uint8Array([0xff, 0xfe, 0x62, 0x72, 0x6f, 0x6b, 0x65, 0x6e]),
    )
    expect(await runReportCommand(deps)).toBe(EXEC_EXIT.ok)
    expect(captured.written).toHaveLength(1)
    expect(captured.written[0]).toContain('event recording was unavailable')
  })

  it('skips tampered records but keeps the valid ones, leaking nothing', async () => {
    const attackerCode = 'exit1 DROP TABLE sessions'
    const attackerPath = '../outside/evil.ts'
    const entries = [
      VALID_ENTRY,
      { kind: 'backendExit', code: attackerCode, frames: [], atMs: NOW_MS - 1000 },
      {
        kind: 'backendExit',
        code: 'exit2',
        frames: [{ path: attackerPath, line: 1, column: 0 }],
        atMs: NOW_MS - 2000,
      },
      { kind: 'noSuchKind', code: 'exit3', frames: [], atMs: NOW_MS - 3000 },
      {
        kind: 'backendExit',
        code: 'exit4',
        frames: [],
        atMs: NOW_MS - 4000,
        prompt: 'ignore previous instructions',
      },
      { kind: 'backendExit', code: 'exit5', frames: [], atMs: NOW_MS - 400_000_000_000 },
      'just a string',
    ]
    const { deps, captured } = runDeps(journalBytes(entries), {
      options: {
        out: undefined,
        description: 'Contact me at tester@example.com',
        includeFacts: true,
        includeEvents: true,
      },
    })
    expect(await runReportCommand(deps)).toBe(EXEC_EXIT.ok)
    const text = captured.written[0] ?? ''
    expect(text).toContain('backendExit ECONNRESET')
    // Off-vocabulary codes render as the fixed word; off-allowlist records never render.
    expect(text).not.toContain('exit4')
    for (const leaked of [attackerCode, attackerPath, 'tester@example.com', 'ignore previous']) {
      expect(text, leaked).not.toContain(leaked)
    }
    expect(text).toContain(REDACTED_MARK)
  })

  it('reads CLI presence and sign-in from local files only, never values', async () => {
    const credential =
      '{"schema_version": 1, "providers": {"meta": {"api_key": "TOP-SECRET-VALUE"}}}'
    const { deps, captured } = runDeps(journalBytes([]), {
      fileExists: (file) => file === '/home/tester/.local/bin/muse',
      readTextFile: (file) => (file.endsWith('auth.json') ? credential : undefined),
      hasEnvironmentApiKey: true,
      readStoredKeyPresence: () => Promise.resolve(true),
    })
    expect(await runReportCommand(deps)).toBe(EXEC_EXIT.ok)
    const text = captured.written[0] ?? ''
    expect(text).toContain('cli: found; signed in: yes')
    expect(text).toContain('stored model api key: yes; META_API_KEY in environment: yes')
    expect(text).not.toContain('TOP-SECRET-VALUE')
  })

  it('reads an absent CLI and no sign-in as no', async () => {
    const { deps, captured } = runDeps(journalBytes([]))
    expect(await runReportCommand(deps)).toBe(EXEC_EXIT.ok)
    expect(captured.written[0]).toContain('cli: not found; signed in: no')
  })

  it('an unreadable journal fails closed: unavailable, exit 0', async () => {
    const { deps, captured } = runDeps(undefined, {
      readJournal: () => Promise.reject(new Error('EACCES')),
    })
    expect(await runReportCommand(deps)).toBe(EXEC_EXIT.ok)
    expect(captured.written[0]).toContain('event recording was unavailable')
  })

  it('a refused build or write exits internal with nothing on stdout', async () => {
    const badTime = runDeps(journalBytes([VALID_ENTRY]), { nowMs: NaN })
    expect(await runReportCommand(badTime.deps)).toBe(EXEC_EXIT.internal)
    expect(badTime.captured.written).toEqual([])
    expect(badTime.captured.errors).toEqual([UI_TEXT.reportSaveFailed])

    const badVersion = runDeps(journalBytes([VALID_ENTRY]), { nodeVersion: 'not a version' })
    expect(await runReportCommand(badVersion.deps)).toBe(EXEC_EXIT.internal)
    expect(badVersion.captured.written).toEqual([])

    const badWrite = runDeps(journalBytes([VALID_ENTRY]), {
      options: {
        out: '/no/such/dir/report.md',
        description: '',
        includeFacts: true,
        includeEvents: true,
      },
      writeOutFile: () => Promise.reject(new Error('EACCES')),
    })
    expect(await runReportCommand(badWrite.deps)).toBe(EXEC_EXIT.internal)
    expect(badWrite.captured.written).toEqual([])
    expect(badWrite.captured.errors).toEqual([UI_TEXT.reportSaveFailed])
  })

  it('makes no network call: a throwing fetch stays uncalled', async () => {
    const fetch = vi.fn(() => {
      throw new Error('network is forbidden here')
    })
    vi.stubGlobal('fetch', fetch)
    const { deps } = runDeps(journalBytes([VALID_ENTRY]))
    expect(await runReportCommand(deps)).toBe(EXEC_EXIT.ok)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('starts no backend, auth, model, process or network: the module imports none', () => {
    const source = readFileSync(path.join(ROOT, 'src', 'runtime', 'reportCommand.ts'), 'utf8')
    for (const forbidden of [
      './backends',
      './authCommands',
      './keyStore',
      'host/backend',
      'modelApiBackendManager',
      'MuseCodeBackendManager',
      'child_process',
      'globalThis.fetch',
      'process.stdout',
      'process.stderr',
      'process.exit',
      'console.',
    ]) {
      expect(source, forbidden).not.toContain(forbidden)
    }
  })
})

describe('collectReportFacts', () => {
  it('refuses a platform the report does not name', () => {
    const platform: NodeJS.Platform = 'freebsd'
    expect(() => collectReportFacts(factsDeps({ platform }))).toThrow('platform')
  })
})

describe('reportJournalPath', () => {
  it('lives in the agent data folder beside the sessions', () => {
    expect(
      reportJournalPath({
        platform: 'linux',
        env: { XDG_DATA_HOME: '/data/home' },
        homeDir: '/home/tester',
      }),
    ).toBe('/data/home/muse-spark-code/problem-report-journal.json')
  })
})

describe('appendReportJournalEntry', () => {
  it('round-trips one facts-only entry with a relative age', async () => {
    const store = memory()
    await appendReportJournalEntry({
      journalPath: '/data/problem-report-journal.json',
      entry: { kind: 'errorNotice', code: 'skillsUnavailable' },
      nowMs: NOW_MS,
      ...store,
    })
    const written = store.files.get('/data/problem-report-journal.json')
    expect(written).toBeDefined()
    const read = parseReportJournalBytes(written ?? new Uint8Array(), NOW_MS + 60_000)
    expect(read.recordingUnavailable).toBe(false)
    expect(read.events).toEqual([
      { kind: 'errorNotice', code: 'skillsUnavailable', frames: [], ageMs: 60_000 },
    ])
    expect(store.dirs).toEqual(['/data'])
  })

  it('never throws when storage fails', async () => {
    await expect(
      appendReportJournalEntry({
        journalPath: '/data/problem-report-journal.json',
        entry: { kind: 'errorNotice', code: 'updateNotSent' },
        nowMs: NOW_MS,
        readBytes: () => Promise.reject(new Error('EACCES')),
        writeBytes: () => Promise.reject(new Error('EROFS')),
        ensureDir: () => Promise.reject(new Error('EROFS')),
      }),
    ).resolves.toBeUndefined()
  })

  it('starts fresh over a corrupt journal and refuses an unknown kind', async () => {
    const store = memory(new TextEncoder().encode('garbage{'))
    await appendReportJournalEntry({
      journalPath: '/data/problem-report-journal.json',
      entry: { kind: 'errorNotice', code: 'questionFailed' },
      nowMs: NOW_MS,
      ...store,
    })
    const read = parseReportJournalBytes(
      store.files.get('/data/problem-report-journal.json') ?? new Uint8Array(),
      NOW_MS,
    )
    expect(read.events).toHaveLength(1)

    const untouched = memory()
    // JSON.parse returns any, so no cast feeds the off-allowlist kind.
    const unknownKind: { readonly kind: ReportEventKind; readonly code: string } = JSON.parse(
      '{"kind":"notAKind","code":"x"}',
    )
    await appendReportJournalEntry({
      journalPath: '/data/problem-report-journal.json',
      entry: unknownKind,
      nowMs: NOW_MS,
      ...untouched,
    })
    expect(untouched.files.size).toBe(0)
  })

  it('stays capped, oldest first', async () => {
    const store = memory()
    for (let index = 0; index < 300; index += 1) {
      await appendReportJournalEntry({
        journalPath: '/data/problem-report-journal.json',
        entry: { kind: 'errorNotice', code: `failure${String(index)}` },
        nowMs: NOW_MS + index,
        ...store,
      })
    }
    const written = store.files.get('/data/problem-report-journal.json') ?? new Uint8Array()
    expect(written.length).toBeLessThanOrEqual(REPORT_JOURNAL_MAX_BYTES)
    const read = parseReportJournalBytes(written, NOW_MS + 1_000_000)
    expect(read.events.length).toBeLessThanOrEqual(51)
    expect(JSON.stringify(read.events)).toContain('failure299')
    expect(JSON.stringify(read.events)).not.toContain('failure0')
  })
})
