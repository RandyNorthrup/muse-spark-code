// The "Muse Spark: Diagnostics" report (PLAN.md D14): the facts a bug
// report needs, as text for the log channel. Pure: the host gathers the
// facts. Nothing secret is ever in it: credentials appear as booleans or,
// for the CLI's credential file, as one word for its structure (D26),
// environment variables as a count, the home directory as `~` (PLAN.md
// D24: the report is meant to be pasted into a public issue), and the
// logger redacts on top. The network posture (M56, PLAN.md D43) is stated
// the same way: whether a proxy is set, never its address, which can hold
// a password; and `muse config status` contributes only known-safe fields.

import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import {
  BACKEND_MODES,
  HOURS_PER_DAY,
  MILLISECONDS_PER_DAY,
  MINUTES_PER_HOUR,
  MUSE_CONFIG_STATUS_MAX_CHARS,
  MUSE_KEYCHAIN_SERVICE,
  PRODUCT_NAME,
  REDACTED_MARK,
  REPORT_DESCRIPTION_MAX_CHARS,
  REPORT_ERROR_CODE_MAX_CHARS,
  REPORT_EVENT_KINDS,
  REPORT_FRAME_PATH_MAX_CHARS,
  REPORT_ISSUE_NEW_URL,
  REPORT_ISSUE_URL_MAX_CHARS,
  REPORT_JOURNAL_MAX_AGE_MS,
  REPORT_RECENT_EVENT_COUNT,
  REPORT_STACK_MAX_FRAMES,
  REPORT_UNKNOWN_ERROR_CODE,
  SECONDS_PER_HOUR,
  SHELL_SANDBOX_MODES,
  VSCODE_WEBSOCKET_ROUTED_SINCE,
} from '../../shared/constants'
import type {
  CliSignIn,
  CredentialFileVerdict,
  KeychainItemPresence,
} from '../backends/musecode/credentialFile'
import { redactSecrets } from '../redact'

/**
 * Whether the editor's extension host installed its proxy-aware version of a
 * global (M62): `absent` when the host has no such global at all, as Node 20
 * (VS Code 1.99 and 1.100) has no WebSocket.
 */
export type HostRouting = 'routed' | 'notRouted' | 'absent'

/**
 * The network the extension's own requests and Muse Code's run under (M56).
 * The extension's `fetch` and WebSocket go through VS Code's proxy support
 * and system certificates where the editor routes them and VS Code's
 * settings allow it.
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
  /** Whether this editor routes each global at all; the settings above matter only then (M62). */
  readonly fetchRouting: HostRouting
  readonly webSocketRouting: HostRouting
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

/**
 * A global's route: its setting where the editor routes it, and otherwise
 * why not, so the report never claims a proxy the request does not use (M62).
 */
function routeState(isSettingOn: boolean, routing: HostRouting, notRouted: string): string {
  switch (routing) {
    case 'routed': {
      return yesNo(isSettingOn)
    }
    case 'notRouted': {
      return notRouted
    }
    case 'absent': {
      return 'none in this extension host'
    }
  }
}

function networkLines(network: NetworkFacts): readonly string[] {
  const fetchRoute = routeState(
    network.isFetchSupportOn,
    network.fetchRouting,
    'no (this editor does not route it)',
  )
  const webSocketRoute = routeState(
    network.isWebSocketSupportOn,
    network.webSocketRouting,
    `no (this editor does not route it; VS Code does from ${VSCODE_WEBSOCKET_ROUTED_SINCE})`,
  )
  return [
    `network: http.proxy set: ${yesNo(network.isProxySet)}; proxySupport: ${network.proxySupport}; proxyStrictSSL: ${yesNo(network.isProxyStrictSsl)}; proxyAuthorization set: ${yesNo(network.isProxyAuthorizationSet)}; noProxy entries: ${String(network.noProxyCount)}; proxy in environment: ${yesNo(network.hasEnvironmentProxy)}`,
    `certificates: system certificates: ${yesNo(network.isSystemCertificatesOn)}; NODE_EXTRA_CA_CERTS: ${yesNo(network.hasExtraCaCertificates)}`,
    `extension requests through VS Code's network support: fetch ${fetchRoute}, WebSocket ${webSocketRoute}`,
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

// --- Report a problem (M93, PLAN.md D72): the scrubbed report builder. ---
//
// The builder takes only allowlisted values (D14, tightened by D72):
// versions, platform, backend, booleans for sign-in/key presence, the sandbox
// posture, setting names (never values), and the flight recorder's fact
// records. Anything else — prompts, code, model output, file paths, URLs,
// account names, free text — fails validation and the build throws instead of
// exporting it. The finished draft gets a second scrub with the shared
// redaction table, is sealed with its SHA-256, and every export path checks
// the seal: any change after the preview invalidates the export.
//
// The draft's headings stay English, as D14's diagnostics report does: the
// draft is filed on the English-language tracker, and the preview the user
// sees must be byte-identical to what Copy, Save and the issue page carry.

/** The platforms the report names; anything else is refused, not guessed. */
const REPORT_PLATFORMS = ['win32', 'darwin', 'linux'] as const

/** A dotted version with an optional short suffix (`1.4.2-R4684.1`); never a sentence. */
const VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]{1,32})?$/

/** A setting name (`museSpark.backend`); a value never rides along. */
const SETTING_NAME_PATTERN = /^museSpark\.[A-Za-z][A-Za-z0-9]{0,63}$/

/** An error code is a short token; anything else becomes REPORT_UNKNOWN_ERROR_CODE. */
const ERROR_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/

/** How many setting names one report may carry; the manifest holds about forty. */
const SETTING_NAMES_MAX = 64

/** The shortest user/machine name worth redacting; shorter would eat ordinary words. */
const EXTRA_LITERAL_MIN_CHARS = 3

const problemReportFactsSchema = z.strictObject({
  extensionVersion: z.string().check(z.minLength(1), z.maxLength(32)),
  vscodeVersion: z.string().check(z.minLength(1), z.maxLength(32)),
  nodeVersion: z.string().check(z.minLength(1), z.maxLength(32)),
  platform: z.enum(REPORT_PLATFORMS),
  backend: z.enum(BACKEND_MODES),
  sandbox: z.enum(SHELL_SANDBOX_MODES),
  cliFound: z.boolean(),
  cliVersion: z.optional(z.string().check(z.minLength(1), z.maxLength(32))),
  cliSignIn: z.boolean(),
  hasStoredApiKey: z.boolean(),
  hasEnvironmentApiKey: z.boolean(),
  settingNames: z
    .array(z.string().check(z.minLength(1), z.maxLength(80)))
    .check(z.maxLength(SETTING_NAMES_MAX)),
})

/** The allowlisted support facts a problem report may carry. */
export type ProblemReportFacts = z.infer<typeof problemReportFactsSchema>

const problemReportFrameSchema = z.strictObject({
  path: z.string().check(z.minLength(1), z.maxLength(REPORT_FRAME_PATH_MAX_CHARS)),
  line: z.int().check(z.gte(1)),
  column: z.int().check(z.gte(0)),
})

const problemReportEventSchema = z.strictObject({
  kind: z.enum(REPORT_EVENT_KINDS),
  code: z.string().check(z.minLength(1), z.maxLength(REPORT_ERROR_CODE_MAX_CHARS)),
  frames: z.array(problemReportFrameSchema).check(z.maxLength(REPORT_STACK_MAX_FRAMES)),
  ageMs: z.int().check(z.gte(0)),
})

/**
 * One flight-recorder fact as the report consumes it (the explicit interface
 * lane R records through): a fixed kind, a short code, verified frames and a
 * relative age. No message, stack text, prompt, session id or free text.
 */
export type ProblemReportEvent = z.infer<typeof problemReportEventSchema>

/**
 * The builder refused an input. The message names the field and the reason,
 * never the refused value itself, so a secret cannot reach the log this way.
 */
export class ReportBuildError extends Error {
  public constructor(
    public readonly field: string,
    reason: string,
  ) {
    super(`problem report refused ${field}: ${reason}`)
    this.name = 'ReportBuildError'
  }
}

function isReportVersion(value: string): boolean {
  return VERSION_PATTERN.test(value)
}

/**
 * A frame path is package-relative text on one line: no absolute root, no
 * traversal segment, no URL. Anything else fails the record that holds it.
 */
function isReportFramePath(path: string): boolean {
  if (path === '' || path.length > REPORT_FRAME_PATH_MAX_CHARS) {
    return false
  }
  if (/[\r\n\0]/.test(path) || path.includes('://')) {
    return false
  }
  if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) {
    return false
  }
  return path.split(/[\\/]/).every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/** The allowlisted facts, or the refusal that names the offending field. */
function validatedFacts(input: unknown): ProblemReportFacts {
  const parsed = problemReportFactsSchema.safeParse(input)
  if (!parsed.success) {
    throw new ReportBuildError('facts', 'not allowlisted support facts')
  }
  const facts = parsed.data
  const versions: Readonly<Record<string, string | undefined>> = {
    extensionVersion: facts.extensionVersion,
    vscodeVersion: facts.vscodeVersion,
    nodeVersion: facts.nodeVersion,
    cliVersion: facts.cliVersion,
  }
  for (const [field, value] of Object.entries(versions)) {
    if (value !== undefined && !isReportVersion(value)) {
      throw new ReportBuildError(field, 'not a version')
    }
  }
  for (const name of facts.settingNames) {
    if (!SETTING_NAME_PATTERN.test(name)) {
      throw new ReportBuildError('settingNames', 'not a setting name')
    }
  }
  return facts
}

/**
 * The stored records, validated again: a tampered journal cannot become an
 * arbitrary text attachment. Unknown codes become the fixed word (D72); a
 * record with any other off-allowlist field is skipped. Keeps the last
 * REPORT_RECENT_EVENT_COUNT valid records.
 */
function validatedEvents(input: readonly unknown[]): readonly ProblemReportEvent[] {
  const valid: ProblemReportEvent[] = []
  for (const candidate of input) {
    const parsed = problemReportEventSchema.safeParse(candidate)
    if (!parsed.success) {
      continue
    }
    const event = parsed.data
    if (event.ageMs > REPORT_JOURNAL_MAX_AGE_MS) {
      continue
    }
    if (!event.frames.every((frame) => isReportFramePath(frame.path))) {
      continue
    }
    valid.push({
      ...event,
      code: ERROR_CODE_PATTERN.test(event.code) ? event.code : REPORT_UNKNOWN_ERROR_CODE,
    })
  }
  return valid.slice(-REPORT_RECENT_EVENT_COUNT)
}

/** What the second scrub needs: the roots to stand in for, and names to forget. */
export interface ReportScrubContext {
  /** Workspace roots, longest first is fine; each becomes `<workspace>`. */
  readonly workspaceRoots: readonly string[]
  /** The user's home directory; becomes `~` (D24). Empty means none known. */
  readonly homeDir: string
  /**
   * Exact user/machine names the host read (login name, host name). Applied
   * through the shared redactor; anything under EXTRA_LITERAL_MIN_CHARS is ignored.
   */
  readonly extraLiterals: readonly string[]
}

/** The draft's stand-in for a workspace root (D72: before the home replacement). */
const WORKSPACE_MARK = '<workspace>'

const POSIX_USER_PATH = /\/(?:home|Users)\/[^\s]+/g
const WINDOWS_USER_PATH = /[a-z]:[\\/]users[\\/][^\s]+/gi
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
const IPV6_PATTERN =
  /(?<![\w:])(?:[0-9a-fA-F]{1,4}:){2,}[0-9a-fA-F:.]*(?![\w:])|(?<![\w:])(?:[0-9a-fA-F:.]*::[0-9a-fA-F:.]+)(?![\w:])/g
const URL_QUERY_PATTERN = /\b(https?:\/\/[^\s?#]*)(?:[?#][^\s]*)?/g

function looksLikeIpv6(match: string): boolean {
  return match.includes('::') || /[a-fA-F]/.test(match)
}

/**
 * The second scrub, over the entire final draft (D72): workspace roots, then
 * home, then other absolute user paths, URL queries and fragments, emails and
 * IP addresses, then every shared secret pattern (URL credentials among
 * them) with the host's user/machine names as exact literals.
 */
export function scrubFinalDraft(draft: string, context: ReportScrubContext): string {
  let text = draft
  const roots = [...context.workspaceRoots]
    .filter((root) => root !== '')
    .toSorted((a, b) => b.length - a.length)
  for (const root of roots) {
    text = text.replaceAll(root, () => WORKSPACE_MARK)
  }
  if (context.homeDir !== '') {
    text = text.replaceAll(context.homeDir, () => HOME_ABBREVIATION)
  }
  text = text.replaceAll(POSIX_USER_PATH, () => REDACTED_MARK)
  text = text.replaceAll(WINDOWS_USER_PATH, () => REDACTED_MARK)
  text = text.replaceAll(URL_QUERY_PATTERN, (_match, base: string) => base)
  text = text.replaceAll(EMAIL_PATTERN, () => REDACTED_MARK)
  text = text.replaceAll(IPV6_PATTERN, (match) => (looksLikeIpv6(match) ? REDACTED_MARK : match))
  text = text.replaceAll(IPV4_PATTERN, () => REDACTED_MARK)
  const literals = context.extraLiterals.filter((name) => name.length >= EXTRA_LITERAL_MIN_CHARS)
  return redactSecrets(text, literals)
}

const MS_PER_HOUR = MILLISECONDS_PER_DAY / HOURS_PER_DAY
const MS_PER_MINUTE = MS_PER_HOUR / MINUTES_PER_HOUR
const MS_PER_SECOND = MS_PER_HOUR / SECONDS_PER_HOUR

/** A relative age (`45s ago`, `3m ago`, `2h ago`, `6d ago`); deterministic for a fixed now. */
export function formatReportAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / MS_PER_MINUTE)
  if (minutes < 1) {
    return `${String(Math.floor(ageMs / MS_PER_SECOND))}s ago`
  }
  if (minutes < MINUTES_PER_HOUR) {
    return `${String(minutes)}m ago`
  }
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  if (hours < HOURS_PER_DAY) {
    return `${String(hours)}h ago`
  }
  return `${String(Math.floor(hours / HOURS_PER_DAY))}d ago`
}

/** The issue title: the product, its version and the platform, all allowlisted. */
export function problemReportTitle(facts: ProblemReportFacts): string {
  return `Problem report: Muse Spark ${facts.extensionVersion} on ${facts.platform}`
}

function factLines(facts: ProblemReportFacts): readonly string[] {
  const cli =
    facts.cliVersion === undefined
      ? facts.cliFound
        ? 'found'
        : 'not found'
      : `found (version ${facts.cliVersion})`
  return [
    `extension: ${facts.extensionVersion}`,
    `vscode: ${facts.vscodeVersion}`,
    `node: ${facts.nodeVersion}`,
    `platform: ${facts.platform}`,
    `backend: ${facts.backend}`,
    `cli: ${cli}; signed in: ${facts.cliSignIn ? YES : NO}`,
    `stored model api key: ${facts.hasStoredApiKey ? YES : NO}; META_API_KEY in environment: ${facts.hasEnvironmentApiKey ? YES : NO}`,
    `shell sandbox: ${facts.sandbox}`,
    `settings (names only): ${facts.settingNames.length === 0 ? NONE : facts.settingNames.join(', ')}`,
  ]
}

function eventLines(events: readonly ProblemReportEvent[]): readonly string[] {
  const lines: string[] = []
  for (const event of events) {
    lines.push(`- ${formatReportAge(event.ageMs)} ${event.kind} ${event.code}`)
    for (const frame of event.frames) {
      lines.push(`${INDENT}${frame.path}:${String(frame.line)}:${String(frame.column)}`)
    }
  }
  return lines
}

/** Everything the report build takes; facts and events are revalidated against the allowlist. */
export interface ProblemReportInput {
  /** What the user wrote; capped, scrubbed, and exported exactly as previewed. */
  readonly description: string
  /** Section switches: the user previews and can remove items before export. */
  readonly includeFacts: boolean
  readonly includeEvents: boolean
  /** Allowlisted support facts (unknown shape throws ReportBuildError). */
  readonly facts: unknown
  /** Stored fact records; invalid ones are skipped, never exported. */
  readonly events: readonly unknown[]
  /** The recorder never ran: the report says so instead of carrying events. */
  readonly recordingUnavailable: boolean
  /** Renders the relative ages; must be a finite epoch. */
  readonly nowMs: number
  readonly scrub: ReportScrubContext
}

/** The previewed draft and its seal: title, text and the SHA-256 over both. */
export interface SealedReportDraft {
  readonly title: string
  readonly text: string
  readonly hash: string
}

const REPORT_HASH = 'sha256'

/** The seal over a title and text pair. */
export function hashReportText(title: string, text: string): string {
  return createHash(REPORT_HASH).update(`${title}\n${text}`).digest('hex')
}

/** Seals a previewed title and text for export. */
export function sealReportDraft(title: string, text: string): SealedReportDraft {
  return { title, text, hash: hashReportText(title, text) }
}

/**
 * Whether the title and text still match the seal: the draft shown equals the
 * draft exported. Any change after the preview fails this and invalidates the export.
 */
export function isSealedDraftCurrent(draft: SealedReportDraft): boolean {
  return hashReportText(draft.title, draft.text) === draft.hash
}

function cappedDescription(description: string): string {
  const trimmed = description.trim()
  const chars = [...trimmed]
  if (chars.length <= REPORT_DESCRIPTION_MAX_CHARS) {
    return trimmed
  }
  return `${chars.slice(0, REPORT_DESCRIPTION_MAX_CHARS).join('')}${TRUNCATED}`
}

/**
 * Builds, scrubs and seals the report draft. Throws ReportBuildError for
 * off-allowlist facts; skips off-allowlist records. The returned text is the
 * final draft: the preview shows it byte-identical, and exports carry it unchanged.
 */
export function buildProblemReportDraft(input: ProblemReportInput): SealedReportDraft {
  if (!Number.isFinite(input.nowMs)) {
    throw new ReportBuildError('nowMs', 'not a finite time')
  }
  const facts = validatedFacts(input.facts)
  const events = validatedEvents(input.events)
  const sections: string[] = ['Muse Spark problem report']
  const description = cappedDescription(input.description)
  if (description !== '') {
    sections.push(`What was happening:\n${description}`)
  }
  if (input.includeFacts) {
    sections.push(`Support facts:\n${factLines(facts).join('\n')}`)
  }
  if (input.includeEvents) {
    sections.push(
      input.recordingUnavailable
        ? 'Recent events:\nevent recording was unavailable, so this report has no recent events.'
        : `Recent events (${String(events.length)}):\n${events.length === 0 ? NONE : eventLines(events).join('\n')}`,
    )
  }
  const title = scrubFinalDraft(problemReportTitle(facts), input.scrub)
  const text = scrubFinalDraft(sections.join('\n\n'), input.scrub)
  return sealReportDraft(title, text)
}

/** Where a draft goes on GitHub: opened prefilled, or the fallback when too long. */
export type IssueLink = { readonly kind: 'open'; readonly url: string } | { readonly kind: 'fallback' }

/**
 * The prefilled new-issue URL for a sealed draft. Past
 * REPORT_ISSUE_URL_MAX_CHARS the caller copies the same draft and opens the
 * unfilled form instead; the extension never posts anything itself.
 */
export function issueLinkForDraft(title: string, body: string): IssueLink {
  const url = `${REPORT_ISSUE_NEW_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
  return url.length <= REPORT_ISSUE_URL_MAX_CHARS ? { kind: 'open', url } : { kind: 'fallback' }
}
