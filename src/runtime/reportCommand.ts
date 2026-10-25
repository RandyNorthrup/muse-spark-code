// `muse-spark-code-acp report` (M93, PLAN.md D72): the standalone problem
// report. It starts no backend, signs in nowhere, opens no browser and makes
// no network or model call: it reads only the agent's own flight-recorder
// journals (the extension's recorder, ReportJournal, under the agent's data
// folder, with the same policy: strict records, links refused, pruned at
// append and read), gathers allowlisted local facts, and prints the scrubbed
// draft as text (or writes it to a file with --out). stdout carries only the
// report in this mode; usage errors and failures go to stderr. Reading
// creates no activation marker and consumes none. This module never imports
// a backend, auth, keystore, model client, child process or fetch; the
// owning test guards those imports.

import {
  credentialFileVerdict,
  isSignedInByStructure,
} from '../core/backends/musecode/credentialFile'
import { realpathSync } from 'node:fs'
import { credentialFilePath, resolveMuseLaunch } from '../core/backends/musecode/launch'
import { MUSE_VERSION_FILE } from '../shared/constants'
import { readContributorMode } from '../core/backends/musecode/museSettings'
import { pathModule } from '../core/workspaceRoot'
import {
  buildVaultProblemReportDraft,
  enrichProblemReportFacts,
  isReportPlatform,
  type ProblemReportFacts,
  ReportBuildError,
  type SealedReportDraft,
} from '../core/support/problemReport'
import { EXEC_EXIT, UI_TEXT } from '../shared/constants'
import type { SecretScrubPort } from '../shared/redact'
import { reportReasonOf } from '../host/support/reportTimeout'
import type { ReportOptions } from './cliArgs'

/** What the journal read answers: the records for the builder, or that recording was unavailable. */
export interface ReportJournalRead {
  /** Records for `buildProblemReportDraft` (validated again there); empty when unavailable. */
  readonly entries: readonly unknown[]
  /** The journal could not be read, so the report says so instead of carrying events. */
  readonly recordingUnavailable: boolean
  /**
  Why recording is unavailable, in the recorder's vocabulary (lane
  REPORTFLOW R2): `unknown` until the capture side provides its reason.
  */
  readonly unavailableReason?: string
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
  /**
  `META_API_KEY` was in the agent's environment when it started (presence
  only). The agent takes credential variables out of its own environment
  at start, so the caller answers from what it took, never from
  `process.env` afterwards.
  */
  readonly hasEnvironmentApiKey: boolean
  /** The OS credential store holds a Model API key (presence only; a store that cannot be read reads no). */
  readonly hasStoredApiKey: boolean
}

/**
The allowlisted facts for the standalone report. Every value is local and
already public-safe: versions, platform, defaults for the backend and
sandbox the report never starts, CLI presence from file discovery, and
sign-in/key booleans. Outside VS Code there is no VS Code version, so the
fact is left out and the draft says "none (standalone agent)". Throws
ReportBuildError (from the builder) for off-allowlist input.
*/
export function collectReportFacts(deps: ReportFactsDeps): ProblemReportFacts {
  const { platform } = deps
  // `android` is code-server on Termux (lane REPORTFLOW R2): a supported
  // report platform, never refused.
  if (!isReportPlatform(platform)) {
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
    // The standalone report discovers but never starts the CLI: entries
    // inside its own working directory are never probed, so a planted
    // `muse` there is never reported as present.
    scope: { workspaceRoot: process.cwd(), realpath: realpathSync },
  })
  const credentialText = deps.readTextFile(
    credentialFilePath({
      platform: deps.platform,
      homeDir: deps.homeDir,
      xdgConfigHome: deps.xdgConfigHome,
    }),
  )
  // Only the file's structure speaks here; a shape the CLI must place reads no.
  const isCliSignedIn = isSignedInByStructure(
    credentialText === undefined ? undefined : credentialFileVerdict(credentialText, deps.platform),
  )
  // The version the installer recorded beside the CLI, as the extension reads
  // it; the builder drops text that is not a version. Contributor mode is the
  // CLI's own price tier flag; only its boolean speaks here, never the file.
  const settingsInput = {
    platform: deps.platform,
    homeDir: deps.homeDir,
    xdgConfigHome: deps.xdgConfigHome,
    readTextFile: deps.readTextFile,
  }
  const contributorMode = readContributorMode(settingsInput)
  const versionText = launch.ok
    ? deps
        .readTextFile(pathModule(deps.platform).join(launch.launch.installDir, MUSE_VERSION_FILE))
        ?.trim()
    : undefined
  const cliVersion = versionText === '' || versionText === undefined ? undefined : versionText
  return {
    extensionVersion: deps.version,
    nodeVersion,
    platform,
    backend: 'auto',
    sandbox: 'auto',
    cliFound: launch.ok,
    ...(cliVersion !== undefined && { cliVersion }),
    ...(contributorMode !== undefined && { contributorMode }),
    cliSignIn: isCliSignedIn,
    hasStoredApiKey: deps.hasStoredApiKey,
    hasEnvironmentApiKey: deps.hasEnvironmentApiKey,
    settingNames: [],
  }
}

/** Everything `runReportCommand` touches; every side effect is a parameter (the owning tests spy). */
export interface RunReportDeps extends Omit<ReportFactsDeps, 'hasStoredApiKey'> {
  /** The vault's scrub, when a vault is set up: it runs after the pattern scrub. */
  readonly vaultScrub?: SecretScrubPort
  readonly options: ReportOptions
  /**
  Hands the sealed draft to the caller beside writing it (lane REPORTFLOW
  R2): the ACP reply links the issue page for it. Absent in the CLI,
  which writes only.
  */
  readonly onSealedDraft?: (draft: SealedReportDraft) => void
  /**
  Whether the OS credential store holds a Model API key. Presence only;
  the value never leaves the caller's closure. A store that cannot be
  read reads no (documented in docs/acp.md).
  */
  readonly readStoredKeyPresence: () => Promise<boolean>
  /** Renders the relative ages; a non-finite value refuses the report. */
  readonly nowMs: number
  /** The agent's retained journal records as report events (ReportJournal.readMerged). */
  readonly readJournal: () => Promise<ReportJournalRead>
  /** Called exactly once with the draft text in stdout mode, never in `--out` mode. */
  readonly writeStdout: (text: string) => void
  /** Writes the draft's exact bytes in `--out` mode. */
  readonly writeOutFile: (filePath: string, text: string) => Promise<void>
  readonly printError: (line: string) => void
  /**
  Records failures beside stderr (lane REPORTFLOW R2): the terminal says
  why a report could not be built, and the log keeps it. Absent in tests
  that assert on stderr alone.
  */
  readonly logError?: (line: string) => void
}

/** Records one failed step in the log under its fixed reason code, never the message (it can quote a path). */
function reportError(deps: Pick<RunReportDeps, 'logError'>, what: string, error: unknown): void {
  deps.logError?.(`${what} (${reportReasonOf(error)})`)
}

/**
Prints (or saves) the scrubbed report. Exit `ok` when the report went out;
`internal` when it could not be built or written. stdout carries only the
draft text in stdout mode, and nothing at all in `--out` mode.
*/
export async function runReportCommand(
  deps: RunReportDeps,
): Promise<typeof EXEC_EXIT.ok | typeof EXEC_EXIT.internal> {
  let journal: ReportJournalRead
  try {
    journal = await deps.readJournal()
  } catch (error: unknown) {
    reportError(deps, 'the journal could not be read', error)
    journal = { entries: [], recordingUnavailable: true, unavailableReason: 'unknown' }
  }
  let text: string
  try {
    const facts = collectReportFacts({
      ...deps,
      hasStoredApiKey: await deps.readStoredKeyPresence(),
    })
    const draft = await buildVaultProblemReportDraft(
      {
        description: deps.options.description,
        includeFacts: deps.options.includeFacts,
        includeEvents: deps.options.includeEvents,
        // The same facts for the same state on every host (lane REPORTFLOW):
        // the last notice and sign-in from the journal, and how the backend
        // choice resolved. The panel state stays unrecorded outside a panel.
        facts: enrichProblemReportFacts(facts, journal.entries),
        events: journal.entries,
        recordingUnavailable: journal.recordingUnavailable,
        ...(journal.unavailableReason !== undefined && {
          recordingReason: journal.unavailableReason,
        }),
        nowMs: deps.nowMs,
        scrub: { workspaceRoots: [], homeDir: deps.homeDir, extraLiterals: [] },
      },
      deps.vaultScrub,
    )
    text = draft.text
    deps.onSealedDraft?.(draft)
  } catch (error: unknown) {
    // The terminal says why the report could not be built, and the log
    // keeps it (lane REPORTFLOW R2): a refusal names its field and fixed
    // reason, never the refused value; anything else reads as its fixed
    // reason code.
    if (!(error instanceof ReportBuildError)) {
      reportError(deps, UI_TEXT.reportBuildFailed, error)
      deps.printError(`${UI_TEXT.reportBuildFailed} (${reportReasonOf(error)})`)
      return EXEC_EXIT.internal
    }
    const line = `${UI_TEXT.reportBuildFailed} (${error.message})`
    deps.printError(line)
    deps.logError?.(line)
    return EXEC_EXIT.internal
  }
  try {
    if (deps.options.out === undefined) {
      deps.writeStdout(text)
    } else {
      await deps.writeOutFile(deps.options.out, text)
    }
  } catch (error: unknown) {
    reportError(deps, 'the report could not be written', error)
    deps.printError(UI_TEXT.reportSaveFailed)
    return EXEC_EXIT.internal
  }
  return EXEC_EXIT.ok
}
