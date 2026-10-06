// The report dialog's facts and scrub context in the extension (M93, PLAN.md
// D72), gathered locally: versions, the platform, the backend and sandbox
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
import { SETTINGS_SECTION, type BackendMode, type ShellSandboxMode } from '../../shared/constants'

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
  readonly extensionVersion: string
  readonly vscodeVersion: string
  readonly nodeVersion: string
  readonly platform: NodeJS.Platform
  readonly backend: BackendMode
  readonly sandbox: ShellSandboxMode
  /** Whether the CLI resolves, and the version its installer recorded (the CLI's own text). */
  readonly cli: { readonly isFound: boolean; readonly version: string | undefined }
  /** The credential file's structure, never a value in it. */
  readonly credentialFileVerdict: CredentialFileVerdict | 'absent'
  readonly hasStoredApiKey: boolean
  readonly hasEnvironmentApiKey: boolean
  readonly changedSettingNames: readonly string[]
}

/**
 * The facts as the builder takes them. The CLI's version is passed as the
 * CLI wrote it; the builder drops it when it is not a version.
 */
export function extensionReportFacts(deps: ExtensionReportFactsDeps): unknown {
  return {
    extensionVersion: deps.extensionVersion,
    vscodeVersion: deps.vscodeVersion,
    nodeVersion: deps.nodeVersion,
    platform: deps.platform,
    backend: deps.backend,
    sandbox: deps.sandbox,
    cliFound: deps.cli.isFound,
    ...(deps.cli.isFound && deps.cli.version !== undefined && { cliVersion: deps.cli.version }),
    cliSignIn: isSignedInByStructure(
      deps.credentialFileVerdict === 'absent' ? undefined : deps.credentialFileVerdict,
    ),
    hasStoredApiKey: deps.hasStoredApiKey,
    hasEnvironmentApiKey: deps.hasEnvironmentApiKey,
    settingNames: deps.changedSettingNames,
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
