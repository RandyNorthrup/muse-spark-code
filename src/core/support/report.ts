// The "Muse Spark: Diagnostics" report (PLAN.md D14): the facts a bug
// report needs, as text for the log channel. Pure: the host gathers the
// facts. Nothing secret is ever in it: credentials appear as booleans or,
// for the CLI's credential file, as one word for its structure (D26),
// environment variables as a count, the home directory as `~` (PLAN.md
// D24: the report is meant to be pasted into a public issue), and the
// logger redacts on top. The network posture (M56, PLAN.md D43) is stated
// the same way: whether a proxy is set, never its address, which can hold
// a password; and `muse config status` contributes only known-safe fields.

import {
  MUSE_CONFIG_STATUS_MAX_CHARS,
  MUSE_KEYCHAIN_SERVICE,
  PRODUCT_NAME,
} from '../../shared/constants'
import type {
  CliSignIn,
  CredentialFileVerdict,
  KeychainItemPresence,
} from '../backends/musecode/credentialFile'

/**
 * The network the extension's own requests and Muse Code's run under (M56).
 * The extension's `fetch` and WebSocket go through VS Code's proxy support
 * and system certificates while VS Code's settings allow it.
 */
export interface NetworkFacts {
  /** `http.proxy` is set; its value is not shown. */
  readonly isProxySet: boolean
  /** `http.proxySupport`: `off`, `on`, `fallback` or `override`. */
  readonly proxySupport: string
  readonly isProxyStrictSsl: boolean
  readonly isProxyAuthorizationSet: boolean
  readonly noProxyCount: number
  readonly isSystemCertificatesOn: boolean
  /** `http.fetchAdditionalSupport` and `http.webSocketAdditionalSupport`. */
  readonly isFetchSupportOn: boolean
  readonly isWebSocketSupportOn: boolean
  /** HTTPS_PROXY / HTTP_PROXY in the extension host's environment, in either case. */
  readonly hasEnvironmentProxy: boolean
  /** NODE_EXTRA_CA_CERTS names extra roots for the extension host. */
  readonly hasExtraCaCertificates: boolean
  /** Where `muse serve` gets its proxy. */
  readonly museProxySource: 'environment' | 'vscode' | 'none'
  /** SSL_CERT_FILE or SSL_CERT_DIR replaces the system store for `muse serve`. */
  readonly hasMuseCertificateOverride: boolean
}

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
  /** `museSpark.sandboxNetwork`, and whether the next host gets it (M56). */
  readonly sandboxNetworkSetting: string
  readonly isSandboxNetworkApplied: boolean
  readonly isBinaryPathConfigured: boolean
  readonly environmentVariableCount: number
  /** The CLI's install directory and version, or why it was not found. */
  readonly cli:
    | { readonly ok: true; readonly installDir: string; readonly version: string | undefined }
    | { readonly ok: false; readonly reason: string }
  /**
   * What the CLI's credential file's structure says, never a value from it:
   * `absent`, `empty` (no sign-in), `inline` (holds one), `keychain` (a macOS
   * pointer), `unsupportedHere` (a macOS file where `muse serve` cannot
   * start with it) or `unrecognized`.
   */
  readonly cliCredentialFile: CredentialFileVerdict | 'absent'
  /** The CLI's sign-in as the gate counts it (`unknown` counts as signed in). */
  readonly cliSignIn: CliSignIn
  /** macOS only: whether the login Keychain holds the CLI's item, by attribute lookup. */
  readonly keychainItem: KeychainItemPresence | undefined
  /** Muse Code's `run.subagent_delegation_mode` as read from its settings file (M14). */
  readonly delegationMode: string
  /** Muse Code's `run.workflow_trigger_mode`, read the same way (M47). */
  readonly workflowTriggerMode: string
  readonly hasStoredApiKey: boolean
  readonly hasEnvironmentApiKey: boolean
  readonly dictation:
    { readonly isAvailable: true } | { readonly isAvailable: false; readonly reason: string }
  readonly network: NetworkFacts
  /** `muse config status` as printed, or why it could not run (M56). */
  readonly managedConfiguration:
    { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string }
  /** The user's home directory, shown as `~` wherever a path contains it. */
  readonly homeDir: string
}

const YES = 'yes'
const NO = 'no'
const NONE = 'none'
const UNKNOWN = 'unknown'
const HOME_ABBREVIATION = '~'
const INDENT = '  '
const TRUNCATED = '…'
const LINE_BREAK = /\r?\n/
// Diagnostics is pasted into public issues. Only captured status fields with
// fixed vocabularies are safe to copy from CLI output: a future CLI version
// may print a credential under a new key that a redaction pattern misses.
const CONFIG_GENERATION = /^Generation: sha256:[\da-f]{4,64}$/i
const CONFIG_SOURCE =
  /^plane=(defaults|policy) source_class=(system_file|windows_machine_policy) state=(absent|present|loaded|active|invalid|error)$/
const CONFIG_LINE_OMITTED = '[unrecognized status line omitted]'
const CONFIG_FAILURE = 'could not read status'
const CONFIG_EXIT_CODE = /^exit code -?\d+$/

function safeConfigLine(line: string): string {
  const trimmed = line.trim()
  if (trimmed === 'Enterprise configuration status' || trimmed === 'Sources:') {
    return `${INDENT}${trimmed}`
  }
  if (CONFIG_GENERATION.test(trimmed)) {
    return `${INDENT}${trimmed}`
  }
  return CONFIG_SOURCE.test(trimmed)
    ? `${INDENT}${INDENT}${trimmed}`
    : `${INDENT}${CONFIG_LINE_OMITTED}`
}
const MUSE_PROXY_SOURCES: Readonly<Record<NetworkFacts['museProxySource'], string>> = {
  environment: 'its environment',
  vscode: 'VS Code’s http.proxy',
  none: NONE,
}

function yesNo(isTrue: boolean): string {
  return isTrue ? YES : NO
}

function networkLines(network: NetworkFacts): readonly string[] {
  return [
    `network: http.proxy set: ${yesNo(network.isProxySet)}; proxySupport: ${network.proxySupport}; proxyStrictSSL: ${yesNo(network.isProxyStrictSsl)}; proxyAuthorization set: ${yesNo(network.isProxyAuthorizationSet)}; noProxy entries: ${String(network.noProxyCount)}; proxy in environment: ${yesNo(network.hasEnvironmentProxy)}`,
    `certificates: system certificates: ${yesNo(network.isSystemCertificatesOn)}; NODE_EXTRA_CA_CERTS: ${yesNo(network.hasExtraCaCertificates)}`,
    `extension requests through VS Code's network support: fetch ${yesNo(network.isFetchSupportOn)}, WebSocket ${yesNo(network.isWebSocketSupportOn)}`,
    `muse serve: proxy from ${MUSE_PROXY_SOURCES[network.museProxySource]}; SSL_CERT_FILE or SSL_CERT_DIR: ${yesNo(network.hasMuseCertificateOverride)}`,
  ]
}

/** `muse config status` under its heading, only known-safe fields, capped. */
function managedConfigurationLines(facts: SupportFacts['managedConfiguration']): readonly string[] {
  if (!facts.ok) {
    const reason =
      facts.reason === 'not run: the Muse Code CLI was not found' ||
      CONFIG_EXIT_CODE.test(facts.reason)
        ? facts.reason
        : CONFIG_FAILURE
    return [`muse config status: ${reason}`]
  }
  const text = facts.text
    .trim()
    .split(LINE_BREAK)
    .map((line) => safeConfigLine(line))
    .join('\n')
  const capped =
    text.length > MUSE_CONFIG_STATUS_MAX_CHARS
      ? `${text.slice(0, MUSE_CONFIG_STATUS_MAX_CHARS)}${TRUNCATED}`
      : text
  return ['muse config status:', capped]
}

export function renderSupportReport(facts: SupportFacts): string {
  const cli = facts.cli.ok
    ? `found in ${facts.cli.installDir} (version ${facts.cli.version ?? UNKNOWN})`
    : `not found: ${facts.cli.reason}`
  const dictation = facts.dictation.isAvailable
    ? 'available'
    : `unavailable: ${facts.dictation.reason}`
  const sandboxNetwork = facts.isSandboxNetworkApplied
    ? 'passed to muse serve'
    : 'not passed (Muse Code’s own default, or the shell sandbox is off)'
  const text = [
    `${PRODUCT_NAME} diagnostics`,
    `extension: ${facts.extensionVersion}`,
    `vscode: ${facts.vscodeVersion} (remote: ${facts.remoteName ?? NONE})`,
    `node: ${facts.nodeVersion} on ${facts.platform} ${facts.arch}`,
    `workspace: ${facts.hasWorkspace ? 'open' : NONE}, trusted: ${yesNo(facts.isWorkspaceTrusted)}`,
    `backend setting: ${facts.backendSetting}`,
    `shell sandbox: setting ${facts.shellSandboxSetting}, posture ${facts.shellSandboxPosture}`,
    `sandbox network: setting ${facts.sandboxNetworkSetting}, ${sandboxNetwork}`,
    `muse binary path configured: ${yesNo(facts.isBinaryPathConfigured)}; environment variables: ${String(facts.environmentVariableCount)}`,
    `muse cli: ${cli}`,
    `muse subagent delegation: ${facts.delegationMode}; workflow trigger mode: ${facts.workflowTriggerMode}`,
    `cli credential file: ${facts.cliCredentialFile}; cli sign-in: ${facts.cliSignIn}; stored model api key: ${yesNo(facts.hasStoredApiKey)}; META_API_KEY in environment: ${yesNo(facts.hasEnvironmentApiKey)}`,
    ...(facts.keychainItem === undefined
      ? []
      : [`macOS Keychain item ${MUSE_KEYCHAIN_SERVICE}: ${facts.keychainItem}`]),
    `voice dictation: ${dictation}`,
    ...networkLines(facts.network),
    ...managedConfigurationLines(facts.managedConfiguration),
  ].join('\n')
  return facts.homeDir === '' ? text : text.split(facts.homeDir).join(HOME_ABBREVIATION)
}
