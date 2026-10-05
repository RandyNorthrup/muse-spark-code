// `muse-spark-code-acp report` (M93 lane A, PLAN.md D72): the standalone
// problem report. It starts no backend, signs in nowhere, opens no browser
// and makes no network or model call: it reads only the local, capped
// recorder journal, gathers allowlisted local facts, and prints lane P's
// scrubbed draft as text (or writes it to a file with --out). stdout carries
// only the report in this mode; usage errors and failures go to stderr.
//
// The journal file below is the write contract lane R's flight recorder
// shares: `{ version: 1, entries: [{ kind, code, frames, atMs }] }`, where
// `atMs` is the entry's epoch milliseconds. Entries already carrying an
// `ageMs` read the same way. Anything else fails validation at build time
// and is skipped, never exported — a tampered journal cannot become an
// arbitrary text attachment. This module never imports a backend, auth,
// keystore, model client, child process or fetch; the owning test guards
// those imports.

import path from 'node:path'
import { credentialFileVerdict } from '../core/backends/musecode/credentialFile'
import { credentialFilePath, resolveMuseLaunch } from '../core/backends/musecode/launch'
import {
  buildProblemReportDraft,
  type ProblemReportFacts,
  ReportBuildError,
} from '../core/support/report'
import {
  ACP_REPORT_JOURNAL_FILE,
  EXEC_EXIT,
  REPORT_EVENT_KINDS,
  REPORT_JOURNAL_MAX_BYTES,
  REPORT_JOURNAL_VERSION,
  REPORT_RECENT_EVENT_COUNT,
  type ReportEventKind,
  UI_TEXT,
} from '../shared/constants'
import { agentDataFolder, type DataFolderInput } from './dataFolder'
import type { ReportOptions } from './cliArgs'

/** What the journal read answers: the records for the builder, or that reading failed. */
export interface ReportJournalRead {
  /** Records for `buildProblemReportDraft` (validated again there); empty when unavailable. */
  readonly events: readonly unknown[]
  /** The journal was missing nothing — it could not be read, so the report says so. */
  readonly recordingUnavailable: boolean
}

/**
 * The journal bytes as records with relative ages. Oversize, undecodable,
 * unparseable or off-contract content reads unavailable rather than guessing:
 * the report then states that recording was unavailable instead of carrying
 * events. A missing file is not a failure — it only means nothing was recorded.
 */
export function parseReportJournalBytes(bytes: Uint8Array, nowMs: number): ReportJournalRead {
  const unavailable: ReportJournalRead = { events: [], recordingUnavailable: true }
  if (bytes.length > REPORT_JOURNAL_MAX_BYTES) {
    return unavailable
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return unavailable
  }
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch {
    return unavailable
  }
  if (
    typeof root !== 'object' ||
    root === null ||
    Array.isArray(root) ||
    !('version' in root) ||
    !('entries' in root)
  ) {
    return unavailable
  }
  if (root.version !== REPORT_JOURNAL_VERSION || !Array.isArray(root.entries)) {
    return unavailable
  }
  const stored: readonly unknown[] = root.entries
  const events: unknown[] = []
  for (const candidate of stored) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      events.push(candidate)
      continue
    }
    const kind: unknown = 'kind' in candidate ? candidate.kind : undefined
    const code: unknown = 'code' in candidate ? candidate.code : undefined
    const frames: unknown = 'frames' in candidate ? candidate.frames : undefined
    const atMs: unknown = 'atMs' in candidate ? candidate.atMs : undefined
    if (typeof atMs === 'number' && Number.isFinite(atMs)) {
      // The stored absolute time becomes the builder's relative age; the
      // absolute stamp itself never enters the draft. `atMs` is dropped
      // because the builder's strict shape refuses unknown fields.
      events.push({ kind, code, frames, ageMs: nowMs - atMs })
    } else {
      events.push(candidate)
    }
  }
  return { events, recordingUnavailable: false }
}

/** The local facts the standalone report may gather; nothing here starts anything. */
export interface ReportFactsDeps {
  /** The agent's own version (package.json). */
  readonly version: string
  /** `process.version`, with or without its leading `v`. */
  readonly nodeVersion: string
  readonly platform: NodeJS.Platform
  /** Split PATH entries for CLI discovery; empty means none known. */
  readonly pathEntries: readonly string[]
  readonly homeDir: string
  /** `%LOCALAPPDATA%` on Windows; absent elsewhere. */
  readonly localAppData?: string | undefined
  /** `$XDG_CONFIG_HOME`; undefined means the platform default. */
  readonly xdgConfigHome: string | undefined
  /** The CLI path setting; empty means discover. The report takes no flag, so this is empty. */
  readonly museBinaryPath: string
  readonly fileExists: (filePath: string) => boolean
  /** The file's text, or undefined when it cannot be read. */
  readonly readTextFile: (filePath: string) => string | undefined
  /** The directory's file names; empty when it cannot be read. */
  readonly listDirectory: (directory: string) => readonly string[]
  /** `META_API_KEY` is present in the environment (presence only; the value is never read). */
  readonly hasEnvironmentApiKey: boolean
  /** The OS credential store holds a Model API key (presence only; a store that cannot be read reads no). */
  readonly hasStoredApiKey: boolean
}

/**
 * The allowlisted facts for the standalone report. Every value is local and
 * already public-safe: versions, platform, defaults for the backend and
 * sandbox the report never starts, CLI presence from file discovery, and
 * sign-in/key booleans. Outside VS Code there is no editor version to name,
 * so the `vscode` fact carries the agent's own version and keeps the draft's
 * allowlisted shape (flagged as an open question for lane I in
 * docs/certification/m93-a.md). Throws ReportBuildError for off-allowlist input.
 */
export function collectReportFacts(deps: ReportFactsDeps): ProblemReportFacts {
  if (deps.platform !== 'win32' && deps.platform !== 'darwin' && deps.platform !== 'linux') {
    throw new ReportBuildError('platform', 'not a named platform')
  }
  const nodeVersion = deps.nodeVersion.startsWith('v')
    ? deps.nodeVersion.slice(1)
    : deps.nodeVersion
  const launch = resolveMuseLaunch({
    platform: deps.platform,
    configuredPath: deps.museBinaryPath,
    pathEntries: deps.pathEntries,
    homeDir: deps.homeDir,
    localAppData: deps.localAppData,
    fileExists: deps.fileExists,
    readTextFile: deps.readTextFile,
    listDirectory: deps.listDirectory,
    serveArgs: [],
  })
  const isCliFound = launch.ok
  let isCliSignedIn = false
  const credentialText = deps.readTextFile(
    credentialFilePath({
      platform: deps.platform,
      homeDir: deps.homeDir,
      xdgConfigHome: deps.xdgConfigHome,
    }),
  )
  if (credentialText !== undefined) {
    const verdict = credentialFileVerdict(credentialText, deps.platform)
    // Only the file's structure speaks here: `inline` holds the credential,
    // `keychain` points at the macOS login Keychain. An unreadable shape is
    // the CLI's to place, so it reads no — documented in docs/acp.md.
    isCliSignedIn = verdict === 'inline' || (verdict === 'keychain' && deps.platform === 'darwin')
  }
  return {
    extensionVersion: deps.version,
    vscodeVersion: deps.version,
    nodeVersion,
    platform: deps.platform,
    backend: 'auto',
    sandbox: 'auto',
    cliFound: isCliFound,
    cliVersion: undefined,
    cliSignIn: isCliSignedIn,
    hasStoredApiKey: deps.hasStoredApiKey,
    hasEnvironmentApiKey: deps.hasEnvironmentApiKey,
    settingNames: [],
  }
}

/** Everything `runReportCommand` touches; every side effect is a parameter (the owning tests spy). */
export interface RunReportDeps extends Omit<ReportFactsDeps, 'hasStoredApiKey'> {
  readonly options: ReportOptions
  /**
   * Whether the OS credential store holds a Model API key. Presence only;
   * the value never leaves the caller's closure. A store that cannot be
   * read reads no (documented in docs/acp.md).
   */
  readonly readStoredKeyPresence: () => Promise<boolean>
  /** Renders the relative ages; a non-finite value refuses the report. */
  readonly nowMs: number
  readonly journalPath: string
  /** The journal's bytes, or undefined when no journal was ever written. Rejects on read failure. */
  readonly readJournal: (filePath: string) => Promise<Uint8Array | undefined>
  /** Called exactly once with the draft text in stdout mode, never in `--out` mode. */
  readonly writeStdout: (text: string) => void
  /** Writes the draft's exact bytes in `--out` mode. */
  readonly writeOutFile: (filePath: string, text: string) => Promise<void>
  readonly printError: (line: string) => void
}

/**
 * Prints (or saves) the scrubbed report. Exit `ok` when the report went out;
 * `internal` when it could not be built or written. stdout carries only the
 * draft text in stdout mode, and nothing at all in `--out` mode.
 */
export async function runReportCommand(
  deps: RunReportDeps,
): Promise<typeof EXEC_EXIT.ok | typeof EXEC_EXIT.internal> {
  let journal: ReportJournalRead = { events: [], recordingUnavailable: false }
  try {
    const bytes = await deps.readJournal(deps.journalPath)
    journal = bytes === undefined ? journal : parseReportJournalBytes(bytes, deps.nowMs)
  } catch {
    journal = { events: [], recordingUnavailable: true }
  }
  let facts: ProblemReportFacts
  try {
    facts = collectReportFacts({ ...deps, hasStoredApiKey: await deps.readStoredKeyPresence() })
  } catch {
    deps.printError(UI_TEXT.reportSaveFailed)
    return EXEC_EXIT.internal
  }
  let text: string
  try {
    const draft = buildProblemReportDraft({
      description: deps.options.description,
      includeFacts: deps.options.includeFacts,
      includeEvents: deps.options.includeEvents,
      facts,
      events: journal.events,
      recordingUnavailable: journal.recordingUnavailable,
      nowMs: deps.nowMs,
      scrub: { workspaceRoots: [], homeDir: deps.homeDir, extraLiterals: [] },
    })
    text = draft.text
  } catch {
    deps.printError(UI_TEXT.reportSaveFailed)
    return EXEC_EXIT.internal
  }
  if (deps.options.out !== undefined) {
    try {
      await deps.writeOutFile(deps.options.out, text)
    } catch {
      deps.printError(UI_TEXT.reportSaveFailed)
      return EXEC_EXIT.internal
    }
    return EXEC_EXIT.ok
  }
  try {
    deps.writeStdout(text)
  } catch {
    deps.printError(UI_TEXT.reportSaveFailed)
    return EXEC_EXIT.internal
  }
  return EXEC_EXIT.ok
}

/** Where the standalone report reads the journal: the agent's data folder, no workspace needed. */
export function reportJournalPath(input: DataFolderInput): string {
  return path.join(agentDataFolder(input), ACP_REPORT_JOURNAL_FILE)
}

/** Everything `appendReportJournalEntry` touches; all storage is a parameter. */
export interface AppendReportJournalDeps {
  readonly journalPath: string
  readonly entry: { readonly kind: ReportEventKind; readonly code: string }
  readonly nowMs: number
  /** The journal's bytes, or undefined when none was ever written. */
  readonly readBytes: (filePath: string) => Promise<Uint8Array | undefined>
  /** A whole-file write; the caller makes it atomic (temporary file plus rename). */
  readonly writeBytes: (filePath: string, bytes: Uint8Array) => Promise<void>
  readonly ensureDir: (directory: string) => Promise<void>
}

/**
 * Records one facts-only entry for the standalone report to read later. The
 * observer attaches no frames: a stack could carry absolute paths the scrub
 * would have to remove, and fixed kind-plus-code diagnoses the failure. The
 * journal stays capped at REPORT_JOURNAL_MAX_BYTES, oldest first; an entry
 * that alone exceeds the cap is dropped rather than evicting everything.
 * Never throws: observing must not break the session it watches.
 */
export async function appendReportJournalEntry(deps: AppendReportJournalDeps): Promise<void> {
  try {
    await appendReportJournalEntryInner(deps)
  } catch {
    // Observing never breaks the session it watches.
  }
}

async function appendReportJournalEntryInner(deps: AppendReportJournalDeps): Promise<void> {
  if (!REPORT_EVENT_KINDS.includes(deps.entry.kind)) {
    return
  }
  let entries: unknown[] = []
  try {
    const existing = await deps.readBytes(deps.journalPath)
    if (existing !== undefined && existing.length <= REPORT_JOURNAL_MAX_BYTES) {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(existing)
      const root: unknown = JSON.parse(text)
      if (
        typeof root === 'object' &&
        root !== null &&
        !Array.isArray(root) &&
        'version' in root &&
        'entries' in root &&
        root.version === REPORT_JOURNAL_VERSION &&
        Array.isArray(root.entries)
      ) {
        entries = root.entries
      }
    }
  } catch {
    entries = []
  }
  entries = [
    ...entries.slice(-REPORT_RECENT_EVENT_COUNT),
    {
      kind: deps.entry.kind,
      code: deps.entry.code,
      frames: [],
      atMs: deps.nowMs,
    },
  ]
  let encoded = new TextEncoder().encode(
    JSON.stringify({ version: REPORT_JOURNAL_VERSION, entries }),
  )
  while (entries.length > 0 && encoded.length > REPORT_JOURNAL_MAX_BYTES) {
    entries = entries.slice(1)
    encoded = new TextEncoder().encode(JSON.stringify({ version: REPORT_JOURNAL_VERSION, entries }))
  }
  if (encoded.length > REPORT_JOURNAL_MAX_BYTES) {
    return
  }
  await deps.ensureDir(path.dirname(deps.journalPath))
  await deps.writeBytes(deps.journalPath, encoded)
}
