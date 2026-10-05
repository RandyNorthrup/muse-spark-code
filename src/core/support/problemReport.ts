// Report a problem (M93, PLAN.md D72): the scrubbed report builder, beside
// D14's diagnostics report (report.ts), which it does not change. It is its
// own module so the activation bundle, which carries D14's renderer for the
// Diagnostics command, never carries this one: the report dialog loads it
// with dist/report.js on first use, and the ACP agent's `report` command
// bundles it.
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

import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import {
  BACKEND_MODES,
  HOURS_PER_DAY,
  MILLISECONDS_PER_DAY,
  MINUTES_PER_HOUR,
  REDACTED_MARK,
  REPORT_DESCRIPTION_MAX_CHARS,
  REPORT_ERROR_CODE_MAX_CHARS,
  REPORT_ERROR_CODES,
  REPORT_EVENT_KINDS,
  REPORT_ISSUE_NEW_URL,
  REPORT_ISSUE_URL_MAX_CHARS,
  REPORT_JOURNAL_MAX_AGE_MS,
  REPORT_PACKAGE_FRAME_PATHS,
  REPORT_RECENT_EVENT_COUNT,
  REPORT_UNKNOWN_ERROR_CODE,
  REPORT_VERSION_MAX_CHARS,
  SECONDS_PER_HOUR,
  SHELL_SANDBOX_MODES,
} from '../../shared/constants'
import { reportWebviewErrorSchema } from '../../shared/protocol'
import { redactSecrets } from '../redact'

const YES = 'yes'
const NO = 'no'
const NONE = 'none'
/** The standalone agent has no VS Code version to name. */
const STANDALONE_AGENT = 'none (standalone agent)'
/** The home directory's stand-in in the draft, as D14's report writes it (D24). */
const HOME_ABBREVIATION = '~'
const INDENT = '  '
const TRUNCATED = '…'

/** The platforms the report names; anything else is refused, not guessed. */
const REPORT_PLATFORMS = ['win32', 'darwin', 'linux'] as const

/** A dotted version with an optional short suffix (`1.4.2-R4684.1`); never a sentence. */
const VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]{1,32})?$/

/** A setting name (`museSpark.backend`); a value never rides along. */
const SETTING_NAME_PATTERN = /^museSpark\.[A-Za-z][A-Za-z0-9]{0,63}$/

/** How many setting names one report may carry; the manifest holds about forty. */
const SETTING_NAMES_MAX = 64

/** A setting name's bound before its pattern is checked: the prefix plus 64. */
const SETTING_NAME_MAX_CHARS = 80

/** The shortest user/machine name worth redacting; shorter would eat ordinary words. */
const EXTRA_LITERAL_MIN_CHARS = 3

const problemReportFactsSchema = z.strictObject({
  extensionVersion: z.string().check(z.minLength(1), z.maxLength(REPORT_VERSION_MAX_CHARS)),
  /**
   * The editor's VS Code version; absent for the standalone agent, which
   * has no VS Code to name (the report says so instead of guessing).
   */
  vscodeVersion: z.optional(
    z.string().check(z.minLength(1), z.maxLength(REPORT_VERSION_MAX_CHARS)),
  ),
  nodeVersion: z.string().check(z.minLength(1), z.maxLength(REPORT_VERSION_MAX_CHARS)),
  platform: z.enum(REPORT_PLATFORMS),
  backend: z.enum(BACKEND_MODES),
  sandbox: z.enum(SHELL_SANDBOX_MODES),
  cliFound: z.boolean(),
  /** The CLI's own version text: dropped, not trusted, when it is not a version. */
  cliVersion: z.optional(z.string().check(z.minLength(1), z.maxLength(REPORT_VERSION_MAX_CHARS))),
  cliSignIn: z.boolean(),
  hasStoredApiKey: z.boolean(),
  hasEnvironmentApiKey: z.boolean(),
  settingNames: z
    .array(z.string().check(z.minLength(1), z.maxLength(SETTING_NAME_MAX_CHARS)))
    .check(z.maxLength(SETTING_NAMES_MAX)),
})

/** The allowlisted support facts a problem report may carry. */
export type ProblemReportFacts = z.infer<typeof problemReportFactsSchema>

const problemReportEventSchema = z.strictObject({
  kind: z.enum(REPORT_EVENT_KINDS),
  code: z.string().check(z.minLength(1), z.maxLength(REPORT_ERROR_CODE_MAX_CHARS)),
  // The recorder's own bounded, strict frame shape (lane 0's transport
  // bounds); membership in the package's files is checked again below.
  frames: reportWebviewErrorSchema.shape.frames,
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
 * A frame path is one of the package's own shipped files, exactly as the
 * recorder keeps them (REPORT_PACKAGE_FRAME_PATHS): package-relative, on one
 * line, with no absolute root, traversal segment or URL by construction.
 * Anything else fails the record that holds it.
 */
function isReportFramePath(path: string): boolean {
  return REPORT_PACKAGE_FRAME_PATHS.has(path)
}

/**
 * The allowlisted facts, or the refusal that names the offending field. The
 * CLI's version is the CLI's own text (D72: not inherently safe): a value
 * that is not a version is left out rather than trusted or fatal.
 */
function validatedFacts(input: unknown): ProblemReportFacts {
  const parsed = problemReportFactsSchema.safeParse(input)
  if (!parsed.success) {
    throw new ReportBuildError('facts', 'not allowlisted support facts')
  }
  const { cliVersion, ...facts } = parsed.data
  const versions: Readonly<Record<string, string | undefined>> = {
    extensionVersion: facts.extensionVersion,
    vscodeVersion: facts.vscodeVersion,
    nodeVersion: facts.nodeVersion,
  }
  for (const [field, value] of Object.entries(versions)) {
    if (value !== undefined && !isReportVersion(value)) {
      throw new ReportBuildError(field, 'not a version')
    }
  }
  if (facts.settingNames.some((name) => !SETTING_NAME_PATTERN.test(name))) {
    throw new ReportBuildError('settingNames', 'not a setting name')
  }
  return cliVersion !== undefined && isReportVersion(cliVersion) ? { ...facts, cliVersion } : facts
}

/** One record the report will carry, with its place in the input it came from. */
export interface SelectedReportEvent {
  /** The record's index in the input list: the preview's removal handle. */
  readonly index: number
  readonly event: ProblemReportEvent
}

/**
 * The stored records, validated again: a tampered journal cannot become an
 * arbitrary text attachment. Codes outside the recorder's vocabulary
 * (REPORT_ERROR_CODES) become the fixed word (D72); a record with any other
 * off-allowlist field is skipped. Keeps the last REPORT_RECENT_EVENT_COUNT
 * valid records, each with its input index, so a preview lists exactly the
 * records the draft carries.
 */
export function selectProblemReportEvents(
  input: readonly unknown[],
): readonly SelectedReportEvent[] {
  const valid: SelectedReportEvent[] = []
  for (const [index, candidate] of input.entries()) {
    const parsed = problemReportEventSchema.safeParse(candidate)
    if (!parsed.success) {
      continue
    }
    const event = parsed.data
    if (
      event.ageMs > REPORT_JOURNAL_MAX_AGE_MS ||
      event.frames.some((frame) => !isReportFramePath(frame.path))
    ) {
      continue
    }
    valid.push({
      index,
      event: {
        ...event,
        code: REPORT_ERROR_CODES.has(event.code) ? event.code : REPORT_UNKNOWN_ERROR_CODE,
      },
    })
  }
  return valid.slice(-REPORT_RECENT_EVENT_COUNT)
}

function validatedEvents(input: readonly unknown[]): readonly ProblemReportEvent[] {
  return selectProblemReportEvents(input).map((selected) => selected.event)
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
// Unknown Windows paths can contain spaces; stop at a line or enclosing quote.
const WINDOWS_USER_PATH = /(?:\\\\\?\\)?[a-z]:[\\/]users[\\/][^\r\n"'<>`]+|\\\\[^\r\n"'<>`]+/gi
const WINDOWS_ROOT = /^(?:[a-z]:[\\/]|\\\\)/i
const UNC_PREFIX = '\\\\'
const EXTENDED_DRIVE_PREFIX = '\\\\?\\'
const EXTENDED_UNC_PREFIX = '\\\\?\\UNC\\'
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
const IPV6_PATTERN =
  /(?<![\w:])(?:[0-9a-fA-F]{1,4}:){2,}[0-9a-fA-F:.]*(?![\w:])|(?<![\w:])(?:[0-9a-fA-F:.]*::[0-9a-fA-F:.]+)(?![\w:])/g
const URL_QUERY_PATTERN = /\b(https?:\/\/[^\s?#]*)(?:[?#][^\s]*)?/g

function isIpv6Like(match: string): boolean {
  return match.includes('::') || /[a-fA-F]/.test(match)
}

/**
 * A Windows path compared as Windows compares it: letters in lower case
 * (where that keeps the length, so every index still points into the
 * original) and `/` for `\`.
 */
function foldWindowsPath(text: string): string {
  return Array.from(text, (character) => {
    const lower = character.toLowerCase()
    return lower.length === character.length ? lower : character
  })
    .join('')
    .replaceAll('\\', '/')
}

/** Whether `text` holds `prefix` (in any letter case) just before `at`. */
function hasPrefixAt(text: string, at: number, prefix: string): boolean {
  return (
    at >= prefix.length && text.slice(at - prefix.length, at).toLowerCase() === prefix.toLowerCase()
  )
}

/** Where a root found at `at` starts, with its prefix; undefined when it has none it needs. */
function rootMatchStart(text: string, at: number, isUnc: boolean): number | undefined {
  if (!isUnc) {
    return hasPrefixAt(text, at, EXTENDED_DRIVE_PREFIX) ? at - EXTENDED_DRIVE_PREFIX.length : at
  }
  if (hasPrefixAt(text, at, EXTENDED_UNC_PREFIX)) return at - EXTENDED_UNC_PREFIX.length
  return hasPrefixAt(text, at, UNC_PREFIX) ? at - UNC_PREFIX.length : undefined
}

/**
 * Windows roots have equivalent case, separators and extended spellings
 * (`\\?\C:\…`, `\\?\UNC\server\…`). Matched as literals, never as a pattern
 * built from the root.
 */
function replaceReportRoot(text: string, root: string, mark: string): string {
  if (!WINDOWS_ROOT.test(root)) return text.replaceAll(root, () => mark)
  let plain = root
  if (hasPrefixAt(root, EXTENDED_UNC_PREFIX.length, EXTENDED_UNC_PREFIX)) {
    plain = UNC_PREFIX + root.slice(EXTENDED_UNC_PREFIX.length)
  } else if (root.startsWith(EXTENDED_DRIVE_PREFIX)) {
    plain = root.slice(EXTENDED_DRIVE_PREFIX.length)
  }
  const isUnc = plain.startsWith(UNC_PREFIX)
  const key = foldWindowsPath(isUnc ? plain.slice(UNC_PREFIX.length) : plain)
  if (key === '') return text
  const folded = foldWindowsPath(text)
  let result = ''
  let copied = 0
  let at = folded.indexOf(key)
  while (at !== -1) {
    const start = rootMatchStart(text, at, isUnc)
    if (start !== undefined && start >= copied) {
      result += text.slice(copied, start) + mark
      copied = at + key.length
      at = folded.indexOf(key, copied)
    } else {
      at = folded.indexOf(key, at + 1)
    }
  }
  return result + text.slice(copied)
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
    text = replaceReportRoot(text, root, WORKSPACE_MARK)
  }
  if (context.homeDir !== '') {
    text = replaceReportRoot(text, context.homeDir, HOME_ABBREVIATION)
  }
  text = text.replaceAll(WINDOWS_USER_PATH, () => REDACTED_MARK)
  text = text.replaceAll(POSIX_USER_PATH, () => REDACTED_MARK)
  text = text.replaceAll(URL_QUERY_PATTERN, (_match, base: string) => base)
  text = text.replaceAll(EMAIL_PATTERN, () => REDACTED_MARK)
  text = text.replaceAll(IPV6_PATTERN, (match) => (isIpv6Like(match) ? REDACTED_MARK : match))
  text = text.replaceAll(IPV4_PATTERN, () => REDACTED_MARK)
  const literals = context.extraLiterals.filter((name) => name.length >= EXTRA_LITERAL_MIN_CHARS)
  return redactSecrets(text, literals)
}

const MS_PER_HOUR = MILLISECONDS_PER_DAY / HOURS_PER_DAY
const MS_PER_MINUTE = MS_PER_HOUR / MINUTES_PER_HOUR
const MS_PER_SECOND = MS_PER_HOUR / SECONDS_PER_HOUR

/** A relative age in its largest whole unit: the draft's English and the preview's own language share it. */
export interface ReportAge {
  readonly value: number
  readonly unit: 'second' | 'minute' | 'hour' | 'day'
}

/** The largest whole unit of an age; deterministic for a fixed now. */
export function reportAge(ageMs: number): ReportAge {
  const minutes = Math.floor(ageMs / MS_PER_MINUTE)
  if (minutes < 1) {
    return { value: Math.floor(ageMs / MS_PER_SECOND), unit: 'second' }
  }
  if (minutes < MINUTES_PER_HOUR) {
    return { value: minutes, unit: 'minute' }
  }
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  return hours < HOURS_PER_DAY
    ? { value: hours, unit: 'hour' }
    : { value: Math.floor(hours / HOURS_PER_DAY), unit: 'day' }
}

const AGE_SUFFIX: Readonly<Record<ReportAge['unit'], string>> = {
  second: 's',
  minute: 'm',
  hour: 'h',
  day: 'd',
}

/** A relative age in the draft (`45s ago`, `3m ago`, `2h ago`, `6d ago`): English, like its headings. */
export function formatReportAge(ageMs: number): string {
  const age = reportAge(ageMs)
  return `${String(age.value)}${AGE_SUFFIX[age.unit]} ago`
}

/** The issue title: the product, its version and the platform, all allowlisted. */
export function problemReportTitle(facts: ProblemReportFacts): string {
  return `Problem report: Muse Spark ${facts.extensionVersion} on ${facts.platform}`
}

function factLines(facts: ProblemReportFacts): readonly string[] {
  const found = facts.cliFound ? 'found' : 'not found'
  const cli = facts.cliVersion === undefined ? found : `found (version ${facts.cliVersion})`
  return [
    `extension: ${facts.extensionVersion}`,
    `vscode: ${facts.vscodeVersion ?? STANDALONE_AGENT}`,
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

/** A UTF-16 half with no partner: it cannot be URL-encoded, so it becomes U+FFFD. */
const LONE_SURROGATE = /\p{Surrogate}/gu
/** U+FFFD, the replacement character. */
const REPLACEMENT_CODE_POINT = 0xff_fd
const REPLACEMENT_CHARACTER = String.fromCodePoint(REPLACEMENT_CODE_POINT)

/**
 * The description as the draft carries it: trimmed, well-formed (a field cut
 * mid-pair would otherwise make the issue link throw), and cut to
 * REPORT_DESCRIPTION_MAX_CHARS user-perceived characters with an ellipsis.
 */
function cappedDescription(description: string): string {
  const trimmed = description.trim().replaceAll(LONE_SURROGATE, () => REPLACEMENT_CHARACTER)
  const graphemes = Array.from(new Intl.Segmenter().segment(trimmed), (part) => part.segment)
  return graphemes.length <= REPORT_DESCRIPTION_MAX_CHARS
    ? trimmed
    : `${graphemes.slice(0, REPORT_DESCRIPTION_MAX_CHARS).join('')}${TRUNCATED}`
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
export type IssueLink =
  { readonly kind: 'open'; readonly url: string } | { readonly kind: 'fallback' }

/**
 * The prefilled new-issue URL for a sealed draft. Past
 * REPORT_ISSUE_URL_MAX_CHARS the caller copies the same draft and opens the
 * unfilled form instead; the extension never posts anything itself.
 */
export function issueLinkForDraft(title: string, body: string): IssueLink {
  const url = `${REPORT_ISSUE_NEW_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
  return url.length <= REPORT_ISSUE_URL_MAX_CHARS ? { kind: 'open', url } : { kind: 'fallback' }
}
