// The report dialog's facts and scrub context in the extension (M93, PLAN.md
// D72), gathered from local state and an optional public status read: versions,
// the platform, the backend and sandbox
// settings, the CLI's presence and the version its installer recorded, the
// sign-in from the credential file's structure alone, whether a key is
// stored or set, and the names (never values) of the settings the user
// changed. Nothing here starts a session, signs in, asks `account/read`,
// runs a workspace command or reads a credential's value beyond its
// presence; the builder validates every fact again.

import * as z from 'zod/mini'
import {
  isSignedInByStructure,
  type CredentialFileVerdict,
} from '../../core/backends/musecode/credentialFile'
import type { ReportScrubContext } from '../../core/support/problemReport'
import { modelApiStatusSchema } from '../../shared/serviceStatus'
import {
  REPORT_FACT_TIMEOUT_MS,
  SETTINGS_SECTION,
  VSCODE_COMMANDS,
  type BackendMode,
  type ShellSandboxMode,
} from '../../shared/constants'
import type { BackendKind } from '../../shared/protocol'
import { recordError, withReportTimeout } from './reportTimeout'

const manifestSettingsSchema = z.object({
  contributes: z.object({
    configuration: z.object({ properties: z.record(z.string(), z.unknown()) }),
  }),
})

/** The setting names the manifest contributes (`museSpark.…`); none when it cannot say. */
export function manifestSettingNames(packageJson: unknown): readonly string[] {
  const parsed = manifestSettingsSchema.safeParse(packageJson)
  return parsed.success
    ? Object.keys(parsed.data.contributes.configuration.properties).filter((name) =>
        name.startsWith(`${SETTINGS_SECTION}.`),
      )
    : []
}

/** Where a setting's value came from, as `WorkspaceConfiguration.inspect` says it. */
export interface SettingOrigin {
  readonly globalValue?: unknown
  readonly workspaceValue?: unknown
  readonly workspaceFolderValue?: unknown
}

/** The settings the user (or a workspace) set: names only, never a value. */
export function changedSettingNames(
  names: readonly string[],
  inspect: (name: string) => SettingOrigin | undefined,
): readonly string[] {
  return names.filter((name) => {
    const origin = inspect(name)
    return (
      origin !== undefined &&
      (origin.globalValue !== undefined ||
        origin.workspaceValue !== undefined ||
        origin.workspaceFolderValue !== undefined)
    )
  })
}

export interface ExtensionReportFactsDeps {
  /** Public status response read by the host; no account data or model inference. */
  readonly serviceStatus?: unknown
  readonly extensionVersion: string
  readonly vscodeVersion: string
  readonly nodeVersion: string
  readonly platform: NodeJS.Platform
  readonly backend: BackendMode
  readonly sandbox: ShellSandboxMode
  /**
  The backend actually running conversations (lane REPORTFLOW R2): what
  `auto` chose. Absent outside a host that read the choice.
  */
  readonly activeBackend?: BackendKind | undefined
  /**
  Whether the CLI resolves, and the version its installer recorded (the
  CLI's own text). Undefined when the probe threw or hung (lane
  REPORTFLOW R2): the draft says `unknown` for the CLI instead of losing
  the report. Every undefined fact below reads the same way.
  */
  readonly cli: { readonly isFound: boolean; readonly version: string | undefined } | undefined
  /** The CLI's contributor mode (its price tier); absent prints as unknown, never guessed. */
  readonly contributorMode?: boolean | undefined
  /** The credential file's structure, never a value in it. */
  readonly credentialFileVerdict: CredentialFileVerdict | 'absent' | undefined
  readonly hasStoredApiKey: boolean | undefined
  readonly hasEnvironmentApiKey: boolean
  readonly changedSettingNames: readonly string[] | undefined
  /** Why an unknown fact is unknown: one fixed reason code per fact. */
  readonly factReasons?: Record<string, string> | undefined
}

/**
The facts as the builder takes them. The CLI's version is passed as the
CLI wrote it; the builder drops it when it is not a version.
*/
export function extensionReportFacts(deps: ExtensionReportFactsDeps): unknown {
  const status =
    deps.serviceStatus === undefined ? undefined : modelApiStatusSchema.parse(deps.serviceStatus)
  return {
    ...(status !== undefined && {
      modelApiStatus: {
        isAlive: status.is_alive,
        // M93 forbids service prose in support facts. Only the captured
        // operational word is allowlisted; future statuses remain unknown here.
        status: status.service_status === 'operational' ? 'operational' : 'unknown',
      },
    }),
    extensionVersion: deps.extensionVersion,
    vscodeVersion: deps.vscodeVersion,
    nodeVersion: deps.nodeVersion,
    platform: deps.platform,
    backend: deps.backend,
    sandbox: deps.sandbox,
    ...(deps.activeBackend !== undefined && { activeBackend: deps.activeBackend }),
    ...(deps.cli !== undefined && {
      cliFound: deps.cli.isFound,
      ...(deps.cli.isFound && deps.cli.version !== undefined && { cliVersion: deps.cli.version }),
    }),
    ...(deps.contributorMode !== undefined && { contributorMode: deps.contributorMode }),
    ...(deps.credentialFileVerdict !== undefined && {
      cliSignIn: isSignedInByStructure(
        deps.credentialFileVerdict === 'absent' ? undefined : deps.credentialFileVerdict,
      ),
    }),
    ...(deps.hasStoredApiKey !== undefined && { hasStoredApiKey: deps.hasStoredApiKey }),
    hasEnvironmentApiKey: deps.hasEnvironmentApiKey,
    ...(deps.changedSettingNames !== undefined && { settingNames: deps.changedSettingNames }),
    ...(deps.factReasons !== undefined && { factReasons: { ...deps.factReasons } }),
  }
}

/** One fact source behind the dialog: a throw or a hang reads `unknown`, never fatal. */
/**
A fact read answers at once or later (lane REPORTFLOW R2): the gather
bounds every one, so a read that never answers — a store that prompts, a
probe that hangs — reads `unknown` instead of losing the report. Sync
readers keep working unchanged.
*/
export type FactRead<T> = () => T | Promise<T>

export interface ExtensionReportFactReads {
  readonly extensionVersion: string
  readonly vscodeVersion: string
  readonly nodeVersion: string
  readonly platform: NodeJS.Platform
  readonly backend: BackendMode
  readonly sandbox: ShellSandboxMode
  readonly activeBackend?: BackendKind | undefined
  /** The CLI's contributor mode (its price tier); absent, the gather leaves it unknown. */
  readonly readContributorMode?: FactRead<boolean | undefined> | undefined
  readonly hasEnvironmentApiKey: boolean
  readonly settingNames: readonly string[]
  readonly inspectSetting: (name: string) => SettingOrigin | undefined
  /** The CLI launch probe; throws when the CLI cannot be asked. */
  readonly probeLaunch: FactRead<{ readonly isFound: boolean; readonly installDir?: string }>
  /** The version the installer recorded; the builder drops it when it is not a version. */
  readonly readCliVersion: (installDir: string) => string | undefined | Promise<string | undefined>
  /** The credential file's structure, never a value in it. */
  readonly readCredentialVerdict: FactRead<CredentialFileVerdict | 'absent'>
  /** The secret store holds a Model API key; a store that prompts may hang. */
  readonly readStoredKey: () => Promise<boolean>
  /** The optional public status read; the report never waits on it. */
  readonly readServiceStatus: () => Promise<unknown>
  /** The editor's command list, for the optional reporter button. */
  readonly readCommands: () => Promise<readonly string[]>
}

/** What one bounded gather answers: the facts, and whether the reporter exists. */
export interface GatheredExtensionReport {
  readonly facts: unknown
  readonly canUseVscodeReporter: boolean
}

/**
Every fact behind the dialog with its own bounded read (lane REPORTFLOW
R2): the CLI probe, the installed version, the credential file, the key
store (which may prompt), the settings read, the status read and the
command list each answer in REPORT_FACT_TIMEOUT_MS or become the word
`unknown` for their fact with a fixed reason code. A malformed status is
left out like an unanswered one; the builder's refusal of one is unchanged.
The report still opens: this never throws for a failed source.
*/
export async function readExtensionReportFacts(
  reads: ExtensionReportFactReads,
  timeoutMs: number = REPORT_FACT_TIMEOUT_MS,
): Promise<GatheredExtensionReport> {
  const reasons: Record<string, string> = {}
  const settled = async <T>(
    fact: string | undefined,
    task: () => Promise<T> | T,
  ): Promise<{ readonly ok: true; readonly value: Awaited<T> } | { readonly ok: false }> => {
    try {
      const started = (async (): Promise<Awaited<T>> => await task())()
      const value = await withReportTimeout(started, timeoutMs)
      return { ok: true, value }
    } catch (error: unknown) {
      recordError(reasons, fact, error)
      return { ok: false }
    }
  }
  const [launch, verdict, stored, names, statusRaw, commands] = await Promise.all([
    settled('cli', reads.probeLaunch),
    settled('cliSignIn', reads.readCredentialVerdict),
    settled('hasStoredApiKey', reads.readStoredKey),
    settled('settingNames', () => changedSettingNames(reads.settingNames, reads.inspectSetting)),
    // The status read is best-effort by design (M93): malformed or missing
    // reads as no status, never as a failed report.
    settled(undefined, reads.readServiceStatus),
    settled(undefined, reads.readCommands),
  ])
  // The contributor mode the CLI's settings state (M93): absent outside a
  // host that reads the file, unknown when the read throws or hangs.
  const contributor =
    reads.readContributorMode === undefined
      ? { ok: true as const, value: undefined }
      : await settled('contributorMode', reads.readContributorMode)
  // A version probe that throws or hangs unknowns the whole CLI fact (lane
  // REPORTFLOW R2): a half-read CLI is not reported as found. A probe that
  // answers without a version is still a found CLI, as before.
  let cli: ExtensionReportFactsDeps['cli'] | undefined
  if (launch.ok) {
    cli = { isFound: launch.value.isFound, version: undefined }
    const installDir = launch.value.installDir
    if (installDir !== undefined && launch.value.isFound) {
      const version = await settled('cli', () => reads.readCliVersion(installDir))
      cli = version.ok ? { isFound: true, version: version.value } : undefined
    }
  }
  const statusValue = statusRaw.ok ? statusRaw.value : undefined
  const statusParsed =
    statusValue === undefined ? undefined : modelApiStatusSchema.safeParse(statusValue)
  return {
    facts: extensionReportFacts({
      ...(statusParsed?.success === true && { serviceStatus: statusValue }),
      extensionVersion: reads.extensionVersion,
      vscodeVersion: reads.vscodeVersion,
      nodeVersion: reads.nodeVersion,
      platform: reads.platform,
      backend: reads.backend,
      sandbox: reads.sandbox,
      ...(reads.activeBackend !== undefined && { activeBackend: reads.activeBackend }),
      cli,
      ...(contributor.ok &&
        contributor.value !== undefined && { contributorMode: contributor.value }),
      credentialFileVerdict: verdict.ok ? verdict.value : undefined,
      hasStoredApiKey: stored.ok ? stored.value : undefined,
      hasEnvironmentApiKey: reads.hasEnvironmentApiKey,
      changedSettingNames: names.ok ? names.value : undefined,
      factReasons: reasons,
    }),
    canUseVscodeReporter: commands.ok && commands.value.includes(VSCODE_COMMANDS.openIssueReporter),
  }
}

/** The OS names a draft must not carry, read where they can be. */
export interface ReportScrubDeps {
  readonly workspaceRoots: readonly string[]
  readonly homeDir: string
  /** The login name and host name; each read can fail without failing the report. */
  readonly userName: () => string
  readonly hostName: () => string
}

/** The second scrub's context: the roots, home and the user's and machine's names. */
export function reportScrubContext(deps: ReportScrubDeps): ReportScrubContext {
  const literals: string[] = []
  for (const read of [deps.userName, deps.hostName]) {
    try {
      const value = read()
      if (value !== '') {
        literals.push(value)
      }
    } catch {
      // A name the OS will not give cannot be in the draft from here either.
    }
  }
  return { workspaceRoots: deps.workspaceRoots, homeDir: deps.homeDir, extraLiterals: literals }
}
