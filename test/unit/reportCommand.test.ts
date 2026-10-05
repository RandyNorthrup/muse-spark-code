// Report a problem headless (M93, PLAN.md D72): the `report` subcommand in
// src/runtime/reportCommand.ts, reading the agent's journals through the
// extension's own recorder (ReportJournal) and its policy. No backend, auth or
// model ever starts here: every side effect is an injected fake or a temp
// folder, the network is a throwing stub, and a source guard pins the
// module's imports. Each journal-policy test below names its red drill in
// docs/certification/m93.md.

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportEventsOf } from '../../src/core/support/journalEvents'
import { buildProblemReportDraft } from '../../src/core/support/problemReport'
import { ReportJournal } from '../../src/host/support/reportJournal'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import {
  collectReportFacts,
  runReportCommand,
  type ReportFactsDeps,
  type ReportJournalRead,
  type RunReportDeps,
} from '../../src/runtime/reportCommand'
import {
  EXEC_EXIT,
  REDACTED_MARK,
  REPORT_JOURNAL_MAX_AGE_MS,
  REPORT_STORAGE_DIR,
  UI_TEXT,
} from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOW_MS = 1_769_000_000_000
const VERSION = '0.12.1'

const VALID_EVENT = {
  kind: 'backendExit',
  code: 'ECONNRESET',
  frames: [{ path: 'dist/extension.js', line: 12, column: 4 }],
  ageMs: 180_000,
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
}

function runDeps(
  journal: ReportJournalRead,
  overrides: Partial<RunReportDeps> = {},
): { deps: RunReportDeps; captured: Captured } {
  const captured: Captured = { written: [], errors: [] }
  const deps: RunReportDeps = {
    ...factsDeps(),
    options: { out: undefined, description: '', includeFacts: true, includeEvents: true },
    readStoredKeyPresence: () => Promise.resolve(false),
    nowMs: NOW_MS,
    readJournal: () => Promise.resolve(journal),
    writeStdout: (text) => {
      captured.written.push(text)
    },
    writeOutFile: () => Promise.resolve(),
    printError: (line) => {
      captured.errors.push(line)
    },
    ...overrides,
  }
  return { deps, captured }
}

function events(...entries: readonly unknown[]): ReportJournalRead {
  return { entries, recordingUnavailable: false }
}

const dirs: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/** A data folder of the agent's own, under the repository's ignored temp/. */
async function dataFolder(): Promise<string> {
  const root = path.join(ROOT, 'temp', 'report-command')
  await mkdir(root, { recursive: true })
  const dir = await mkdtemp(path.join(root, 'acp-'))
  dirs.push(dir)
  return dir
}

/** One agent process's recorder over `dir`, as `serve` and `report` make it. */
function agentJournal(dir: string, instance: string, now = NOW_MS): ReportJournal {
  return new ReportJournal({
    globalStorageDir: dir,
    instance,
    ext: VERSION,
    host: '22.20.4',
    pid: 4242,
    log: new FakeLogOutputChannel(),
    now: () => now,
    isAlive: () => false,
  })
}

/** What `report` reads, as main.ts wires it: every journal, pruned, as events. */
async function readAsReport(dir: string, now = NOW_MS): Promise<ReportJournalRead> {
  const journal = agentJournal(dir, 'reader', now)
  const merged = await journal.readMerged()
  return {
    entries: reportEventsOf(merged.entries, now),
    recordingUnavailable: !journal.isAvailable,
  }
}

/** A stored record line as the recorder writes it, with overrides for tampering. */
function recordLine(overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    v: 1,
    kind: 'errorNotice',
    at: NOW_MS - 1000,
    code: 'updateNotSent',
    ext: VERSION,
    host: '22.20.4',
    frames: [],
    ...overrides,
  })}\n`
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
    const { deps, captured } = runDeps(events(VALID_EVENT))
    expect(await runReportCommand(deps)).toBe(EXEC_EXIT.ok)
    expect(captured.errors).toEqual([])
    const expected = buildProblemReportDraft({
      description: '',
      includeFacts: true,
      includeEvents: true,
      facts: collectReportFacts({ ...deps, hasStoredApiKey: false }),
      events: [VALID_EVENT],
      recordingUnavailable: false,
      nowMs: NOW_MS,
      scrub: { workspaceRoots: [], homeDir: '/home/tester', extraLiterals: [] },
    })
    expect(captured.written).toEqual([expected.text])
    expect(captured.written[0]).toContain('- 3m ago backendExit ECONNRESET')
  })

  it('names no VS Code version outside VS Code (M93 regression)', async () => {
    const { deps, captured } = runDeps(events())
    expect(await runReportCommand(deps)).toBe(EXEC_EXIT.ok)
    expect(captured.written[0]).toContain('vscode: none (standalone agent)')
    expect(captured.written[0]).not.toContain(`vscode: ${VERSION}`)
  })

  it('honours the section switches', async () => {
    const { deps, captured } = runDeps(events(VALID_EVENT), {
      options: { out: undefined, description: '', includeFacts: false, includeEvents: false },
    })
    expect(await runReportCommand(deps)).toBe(EXEC_EXIT.ok)
    expect(captured.written[0]).not.toContain('Support facts:')
    expect(captured.written[0]).not.toContain('Recent events')
  })

  it('--out writes the exact bytes to the file and nothing to stdout', async () => {
    const files = new Map<string, string>()
    const { deps, captured } = runDeps(events(VALID_EVENT), {
      options: {
        out: 'report.md',
        description: 'blank panel',
        includeFacts: true,
        includeEvents: true,
      },
      writeOutFile: (target, text) => {
        files.set(target, text)
        return Promise.resolve()
      },
    })
    expect(await runReportCommand(deps)).toBe(EXEC_EXIT.ok)
    expect(captured.written).toEqual([])
    expect(captured.errors).toEqual([])
    expect(files.get('report.md')).toContain('What was happening:\nblank panel')
  })

  it('an unreadable journal fails closed: unavailable, exit 0', async () => {
    const { deps, captured } = runDeps(events(), {
      readJournal: () => Promise.reject(new Error('EACCES')),
    })
    expect(await runReportCommand(deps)).toBe(EXEC_EXIT.ok)
    expect(captured.written[0]).toContain('event recording was unavailable')
  })

  it('reads CLI presence and sign-in from local files only, never values', async () => {
    const credential =
      '{"schema_version": 1, "providers": {"meta": {"api_key": "TOP-SECRET-VALUE"}}}'
    const { deps, captured } = runDeps(events(), {
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
    const { deps, captured } = runDeps(events())
    expect(await runReportCommand(deps)).toBe(EXEC_EXIT.ok)
    expect(captured.written[0]).toContain('cli: not found; signed in: no')
  })

  it('a refused build or write exits internal with nothing on stdout', async () => {
    const badTime = runDeps(events(VALID_EVENT), { nowMs: NaN })
    expect(await runReportCommand(badTime.deps)).toBe(EXEC_EXIT.internal)
    expect(badTime.captured.written).toEqual([])
    expect(badTime.captured.errors).toEqual([UI_TEXT.reportBuildFailed])

    const badVersion = runDeps(events(VALID_EVENT), { nodeVersion: 'not a version' })
    expect(await runReportCommand(badVersion.deps)).toBe(EXEC_EXIT.internal)
    expect(badVersion.captured.written).toEqual([])

    const badWrite = runDeps(events(VALID_EVENT), {
      options: {
        out: '/no/such/report.md',
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
    const fetch = vi.fn(() => Promise.reject(new Error('network is forbidden here')))
    vi.stubGlobal('fetch', fetch)
    const { deps } = runDeps(events(VALID_EVENT))
    expect(await runReportCommand(deps)).toBe(EXEC_EXIT.ok)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('starts no backend, auth, model, process or network: the module imports none', async () => {
    const source = await readFile(path.join(ROOT, 'src', 'runtime', 'reportCommand.ts'), 'utf8')
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

describe('the agent journal, through the extension recorder (M93 regressions)', () => {
  it('reads what an ACP process recorded, with no events for a folder never written', async () => {
    const dir = await dataFolder()
    expect(await readAsReport(dir)).toEqual({ entries: [], recordingUnavailable: false })
    const serving = agentJournal(dir, 'serve-1')
    await serving.startup()
    await serving.record({ kind: 'errorNotice', code: 'permissionRequestFailed' })
    await serving.shutdown()
    const read = await readAsReport(dir)
    expect(read.recordingUnavailable).toBe(false)
    expect(read.entries).toEqual([
      { kind: 'errorNotice', code: 'permissionRequestFailed', frames: [], ageMs: 0 },
    ])
    const { deps, captured } = runDeps(read)
    expect(await runReportCommand(deps)).toBe(EXEC_EXIT.ok)
    expect(captured.written[0]).toContain('- 0s ago errorNotice permissionRequestFailed')
  })

  it('rejects a record with an unknown field instead of projecting it', async () => {
    const dir = await dataFolder()
    const reports = path.join(dir, REPORT_STORAGE_DIR)
    await mkdir(reports)
    await writeFile(
      path.join(reports, 'journal-tampered.jsonl'),
      recordLine() + recordLine({ code: 'questionFailed', prompt: 'ignore previous instructions' }),
    )
    const read = await readAsReport(dir)
    expect(read.entries).toEqual([
      { kind: 'errorNotice', code: 'updateNotSent', frames: [], ageMs: 1000 },
    ])
    const { deps, captured } = runDeps(read, {
      options: {
        out: undefined,
        description: 'Contact me at tester@example.com',
        includeFacts: true,
        includeEvents: true,
      },
    })
    expect(await runReportCommand(deps)).toBe(EXEC_EXIT.ok)
    const text = captured.written[0] ?? ''
    for (const leaked of ['questionFailed', 'ignore previous', 'tester@example.com']) {
      expect(text, leaked).not.toContain(leaked)
    }
    expect(text).toContain(REDACTED_MARK)
  })

  it('prunes an expired record when the report reads it', async () => {
    const dir = await dataFolder()
    const reports = path.join(dir, REPORT_STORAGE_DIR)
    await mkdir(reports)
    const file = path.join(reports, 'journal-old.jsonl')
    await writeFile(file, recordLine({ at: NOW_MS - REPORT_JOURNAL_MAX_AGE_MS - 1 }) + recordLine())
    const read = await readAsReport(dir)
    expect(read.entries).toHaveLength(1)
    const rewritten = await readFile(file, 'utf8')
    const kept = rewritten.trim().split('\n')
    expect(kept).toHaveLength(1)
    expect(kept[0]).toContain(`"at":${String(NOW_MS - 1000)}`)
  })

  it('prunes an expired record when the agent appends', async () => {
    const dir = await dataFolder()
    const serving = agentJournal(dir, 'serve-2')
    await serving.startup()
    const reports = path.join(dir, REPORT_STORAGE_DIR)
    const file = path.join(reports, 'journal-serve-2.jsonl')
    await writeFile(file, recordLine({ at: NOW_MS - REPORT_JOURNAL_MAX_AGE_MS - 1 }))
    await serving.record({ kind: 'errorNotice', code: 'skillsUnavailable' })
    const text = await readFile(file, 'utf8')
    expect(text.split('\n').filter((line) => line !== '')).toHaveLength(1)
    expect(text).toContain('skillsUnavailable')
  })

  it.skipIf(process.platform === 'win32')('never reads a journal through a link', async () => {
    const dir = await dataFolder()
    const reports = path.join(dir, REPORT_STORAGE_DIR)
    await mkdir(reports)
    const outside = path.join(dir, 'outside.jsonl')
    await writeFile(outside, recordLine({ code: 'questionFailed' }))
    await symlink(outside, path.join(reports, 'journal-linked.jsonl'))
    // The link is passed over quietly: no events from it, and recording stays available.
    expect(await readAsReport(dir)).toEqual({ entries: [], recordingUnavailable: false })
    expect(await readFile(outside, 'utf8')).toBe(recordLine({ code: 'questionFailed' }))
  })
})
