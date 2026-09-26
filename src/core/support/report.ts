// The "Muse Spark: Diagnostics" report (PLAN.md D14): the facts a bug
// report needs, as text for the log channel. Pure: the host gathers the
// facts. Nothing secret is ever in it: credentials appear as booleans,
// environment variables as a count, the home directory as `~` (PLAN.md
// D24: the report is meant to be pasted into a public issue), and the
// logger redacts on top.

import { PRODUCT_NAME } from '../../shared/constants'

export interface SupportFacts {
  readonly extensionVersion: string
  readonly vscodeVersion: string
  readonly nodeVersion: string
  readonly platform: string
  readonly arch: string
  /** `vscode.env.remoteName`; undefined on a local window. */
  readonly remoteName: string | undefined
  readonly hasWorkspace: boolean
  readonly isWorkspaceTrusted: boolean
  readonly backendSetting: string
  readonly shellSandboxSetting: string
  readonly shellSandboxPosture: string
  readonly isBinaryPathConfigured: boolean
  readonly environmentVariableCount: number
  /** The CLI's install directory and version, or why it was not found. */
  readonly cli:
    | { readonly ok: true; readonly installDir: string; readonly version: string | undefined }
    | { readonly ok: false; readonly reason: string }
  readonly hasCliCredentialFile: boolean
  /** Muse Code's `run.subagent_delegation_mode` as read from its settings file (M14). */
  readonly delegationMode: string
  /** Muse Code's `run.workflow_trigger_mode`, read the same way (M47). */
  readonly workflowTriggerMode: string
  readonly hasStoredApiKey: boolean
  readonly hasEnvironmentApiKey: boolean
  readonly dictation:
    { readonly isAvailable: true } | { readonly isAvailable: false; readonly reason: string }
  /** The user's home directory, shown as `~` wherever a path contains it. */
  readonly homeDir: string
}

const YES = 'yes'
const NO = 'no'
const NONE = 'none'
const UNKNOWN = 'unknown'
const HOME_ABBREVIATION = '~'

function yesNo(isTrue: boolean): string {
  return isTrue ? YES : NO
}

export function renderSupportReport(facts: SupportFacts): string {
  const cli = facts.cli.ok
    ? `found in ${facts.cli.installDir} (version ${facts.cli.version ?? UNKNOWN})`
    : `not found: ${facts.cli.reason}`
  const dictation = facts.dictation.isAvailable
    ? 'available'
    : `unavailable: ${facts.dictation.reason}`
  const text = [
    `${PRODUCT_NAME} diagnostics`,
    `extension: ${facts.extensionVersion}`,
    `vscode: ${facts.vscodeVersion} (remote: ${facts.remoteName ?? NONE})`,
    `node: ${facts.nodeVersion} on ${facts.platform} ${facts.arch}`,
    `workspace: ${facts.hasWorkspace ? 'open' : NONE}, trusted: ${yesNo(facts.isWorkspaceTrusted)}`,
    `backend setting: ${facts.backendSetting}`,
    `shell sandbox: setting ${facts.shellSandboxSetting}, posture ${facts.shellSandboxPosture}`,
    `muse binary path configured: ${yesNo(facts.isBinaryPathConfigured)}; environment variables: ${String(facts.environmentVariableCount)}`,
    `muse cli: ${cli}`,
    `muse subagent delegation: ${facts.delegationMode}; workflow trigger mode: ${facts.workflowTriggerMode}`,
    `cli credential file: ${yesNo(facts.hasCliCredentialFile)}; stored model api key: ${yesNo(facts.hasStoredApiKey)}; META_API_KEY in environment: ${yesNo(facts.hasEnvironmentApiKey)}`,
    `voice dictation: ${dictation}`,
  ].join('\n')
  return facts.homeDir === '' ? text : text.split(facts.homeDir).join(HOME_ABBREVIATION)
}
