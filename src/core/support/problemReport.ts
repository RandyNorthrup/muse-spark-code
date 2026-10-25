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
  REPORT_BACKEND_RESOLUTIONS,
  REPORT_DESCRIPTION_MAX_CHARS,
  REPORT_ERROR_CODE_MAX_CHARS,
  REPORT_ERROR_CODES,
  REPORT_EVENT_KINDS,
  REPORT_ISSUE_NEW_URL,
  REPORT_ISSUE_URL_MAX_CHARS,
  REPORT_JOURNAL_MAX_AGE_MS,
  REPORT_PACKAGE_FRAME_PATHS,
  REPORT_PANEL_STATES,
  REPORT_RECENT_EVENT_COUNT,
  REPORT_SIGN_IN_OUTCOMES,
  REPORT_UNKNOWN_ERROR_CODE,
  REPORT_VERSION_MAX_CHARS,
  SECONDS_PER_HOUR,
  SHELL_SANDBOX_MODES,
  type ReportBackendResolution,
  type ReportPanelState,
  type ReportSignInOutcome,
} from '../../shared/constants'
import { describeBackendResolution } from '../backendSelection'
import { BACKEND_KINDS, reportWebviewErrorSchema } from '../../shared/protocol'
import { redactSecrets } from '../redact'
import type { SecretScrubPort } from '../../shared/redact'
import { scrubRefusalLeak } from '../backends/modelapi/providerRefusal'

const YES = 'yes'
const NO = 'no'
const NONE = 'none'
/** The standalone agent has no VS Code version to name. */
const STANDALONE_AGENT = 'none (standalone agent)'
/** The home directory's stand-in in the draft, as D14's report writes it (D24). */
const HOME_ABBREVIATION = '~'
const INDENT = '  '
const TRUNCATED = '…'

/**
The platforms the report names; anything else is refused, not guessed.
`android` is code-server on Termux (lane REPORTFLOW R2): a supported
report platform, never refused.
*/
export const REPORT_PLATFORMS = ['win32', 'darwin', 'linux', 'android'] as const

/** Whether the report names this platform instead of refusing it. */
export function isReportPlatform(platform: string): platform is (typeof REPORT_PLATFORMS)[number] {
  return (REPORT_PLATFORMS as readonly string[]).includes(platform)
}

/** A dotted version with an optional short suffix (`1.4.2-R4684.1`); never a sentence. */
const VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]{1,32})?$/

/**
A setting name: the section, then one to four dotted segments of letters
and digits (`museSpark.backend`, `museSpark.vault.enabled`). A value never
rides along. Until 0.18.1 a second dot was refused, so anyone who had
changed a dotted setting could not open the report at all.
*/
const SETTING_NAME_PATTERN = /^museSpark(?:\.[A-Za-z][A-Za-z0-9]{0,63}){1,4}$/

/** How many setting names one report may carry; the manifest holds a hundred. */
const SETTING_NAMES_MAX = 128

/** A setting name's bound before its pattern is checked; the longest is 41. */
const SETTING_NAME_MAX_CHARS = 80

/** The title of a report whose facts are left out and did not validate. */
const TITLE_WITHOUT_FACTS = 'Problem report: Muse Spark'

/** The shortest user/machine name worth redacting; shorter would eat ordinary words. */
const EXTRA_LITERAL_MIN_CHARS = 3

const problemReportFactsSchema = z.strictObject({
  modelApiStatus: z.optional(
    z.strictObject({
      isAlive: z.boolean(),
      status: z.enum(['operational', 'unknown']),
    }),
  ),
  extensionVersion: z.string().check(z.minLength(1), z.maxLength(REPORT_VERSION_MAX_CHARS)),
  /**
  The editor's VS Code version; absent for the standalone agent, which
  has no VS Code to name (the report says so instead of guessing).
  */
  vscodeVersion: z.optional(
    z.string().check(z.minLength(1), z.maxLength(REPORT_VERSION_MAX_CHARS)),
  ),
  nodeVersion: z.string().check(z.minLength(1), z.maxLength(REPORT_VERSION_MAX_CHARS)),
  /**
  Absent when the read that owns the fact threw or timed out (lane
  REPORTFLOW R2): the draft says `unknown` for that fact instead of
  losing the whole report. Every absent fact below reads the same way.
  */
  platform: z.optional(z.enum(REPORT_PLATFORMS)),
  backend: z.optional(z.enum(BACKEND_MODES)),
  sandbox: z.optional(z.enum(SHELL_SANDBOX_MODES)),
  cliFound: z.optional(z.boolean()),
  /** The CLI's own version text: dropped, not trusted, when it is not a version. */
  cliVersion: z.optional(z.string().check(z.minLength(1), z.maxLength(REPORT_VERSION_MAX_CHARS))),
  /**
  The CLI's contributor mode (its price tier): true or false when observed,
  absent when the reporter's setup could not say. Unknown prints as unknown,
  never guessed.
  */
  contributorMode: z.optional(z.boolean()),
  cliSignIn: z.optional(z.boolean()),
  hasStoredApiKey: z.optional(z.boolean()),
  hasEnvironmentApiKey: z.optional(z.boolean()),
  settingNames: z.optional(
    z
      .array(z.string().check(z.minLength(1), z.maxLength(SETTING_NAME_MAX_CHARS)))
      .check(z.maxLength(SETTING_NAMES_MAX)),
  ),
  /**
  Why an unknown fact is unknown (lane REPORTFLOW R2): one fixed reason
  code per fact, from the recorder's vocabulary (`timedOut` for a read
  past its bound, the error's class for a throw, `unknown` otherwise).
  A code outside the vocabulary, or a fact this draft never renders as
  unknown, is dropped, never rendered.
  */
  factReasons: z.optional(
    z.record(
      z.string(),
      z.string().check(z.minLength(1), z.maxLength(REPORT_ERROR_CODE_MAX_CHARS)),
    ),
  ),
  /**
  The backend actually running conversations when the dialog opened
  (lane REPORTFLOW R2): what `auto` chose, not what the setting names.
  Absent outside a host that read the choice.
  */
  activeBackend: z.optional(z.enum(BACKEND_KINDS)),
  /**
  Where the person was when the dialog opened (lane REPORTFLOW): one of
  the panel's own states, in fixed words. Absent outside the panel (the
  terminal names that instead of guessing).
  */
  panelState: z.optional(z.enum(REPORT_PANEL_STATES)),
  /**
  The last error or warning notice shown: its catalogue code (never the
  sentence) with its age. Absent when none was recorded.
  */
  lastNotice: z.optional(
    z.strictObject({
      code: z.string().check(z.minLength(1), z.maxLength(REPORT_ERROR_CODE_MAX_CHARS)),
      ageMs: z.int().check(z.gte(0)),
    }),
  ),
  /**
  The last sign-in attempt: none, started, succeeded, or failed with its
  fixed reason code. Absent reads as none.
  */
  lastSignIn: z.optional(
    z.strictObject({
      outcome: z.enum(REPORT_SIGN_IN_OUTCOMES),
      code: z.optional(z.string().check(z.minLength(1), z.maxLength(REPORT_ERROR_CODE_MAX_CHARS))),
      ageMs: z.optional(z.int().check(z.gte(0))),
    }),
  ),
  /**
  How the backend choice resolved and why (lane REPORTFLOW): what `auto`
  chose, or what nothing usable meant. Absent outside a host that read
  the choice.
  */
  backendResolution: z.optional(z.enum(REPORT_BACKEND_RESOLUTIONS)),
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
One flight-recorder fact as the report consumes it (the explicit interface
lane R records through): a fixed kind, a short code, verified frames and a
relative age. No message, stack text, prompt, session id or free text.
*/
export type ProblemReportEvent = z.infer<typeof problemReportEventSchema>

/**
The builder refused an input. The message names the field and the reason,
never the refused value itself, so a secret cannot reach the log this way.
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
A frame path is one of the package's own shipped files, exactly as the
recorder keeps them (REPORT_PACKAGE_FRAME_PATHS): package-relative, on one
line, with no absolute root, traversal segment or URL by construction.
Anything else fails the record that holds it.
*/
function isReportFramePath(path: string): boolean {
  return REPORT_PACKAGE_FRAME_PATHS.has(path)
}

/**
The allowlisted facts, or the refusal that names the offending field. The
CLI's version is the CLI's own text (D72: not inherently safe): a value
that is not a version is left out rather than trusted or fatal.
*/
/**
The facts the draft can render as `unknown (reason)`: every other reason
key is dropped, never rendered (lane REPORTFLOW R2).
*/
const UNKNOWNABLE_FACTS: ReadonlySet<string> = new Set([
  'extensionVersion',
  'vscodeVersion',
  'nodeVersion',
  'platform',
  'backend',
  'sandbox',
  'cli',
  'cliSignIn',
  'hasStoredApiKey',
  'hasEnvironmentApiKey',
  'settingNames',
])

/** The allowlisted reason codes for unknown facts, each with its fixed code. */
function normalizedFactReasons(
  reasons: Record<string, string> | undefined,
): Record<string, string> {
  const normalized: Record<string, string> = {}
  const entries = Object.entries(reasons ?? {})
  for (const [fact, code] of entries) {
    if (!UNKNOWNABLE_FACTS.has(fact)) {
      continue
    }
    normalized[fact] = REPORT_ERROR_CODES.has(code) ? code : REPORT_UNKNOWN_ERROR_CODE
  }
  return normalized
}

function validatedFacts(input: unknown): ProblemReportFacts {
  const parsed = problemReportFactsSchema.safeParse(input)
  if (!parsed.success) {
    throw new ReportBuildError('facts', 'not allowlisted support facts')
  }
  const { cliVersion, factReasons, ...facts } = parsed.data
  const versions: Readonly<Record<string, string | undefined>> = {
    extensionVersion: facts.extensionVersion,
    vscodeVersion: facts.vscodeVersion,
    nodeVersion: facts.nodeVersion,
  }
  for (const [field, value] of Object.entries(versions)) {
    // `unknown` is the bounded read's word for a version it could not read
    // (lane REPORTFLOW R2): rendered as is, never mistaken for a version.
    if (value !== undefined && value !== REPORT_UNKNOWN_ERROR_CODE && !isReportVersion(value)) {
      throw new ReportBuildError(field, 'not a version')
    }
  }
  if ((facts.settingNames ?? []).some((name) => !SETTING_NAME_PATTERN.test(name))) {
    throw new ReportBuildError('settingNames', 'not a setting name')
  }
  // The new facts name catalogue words only (lane REPORTFLOW): a code
  // outside the recorder's vocabulary is refused, not filed.
  if (facts.lastNotice !== undefined && !REPORT_ERROR_CODES.has(facts.lastNotice.code)) {
    throw new ReportBuildError('lastNotice', 'not a known notice code')
  }
  if (facts.lastSignIn !== undefined) {
    const signIn = facts.lastSignIn
    if (signIn.code !== undefined && !REPORT_ERROR_CODES.has(signIn.code)) {
      throw new ReportBuildError('lastSignIn', 'not a known sign-in reason')
    }
    if (signIn.outcome === 'failed' && signIn.code === undefined) {
      throw new ReportBuildError('lastSignIn', 'a failed sign-in names its reason')
    }
    if (signIn.outcome !== 'none' && signIn.ageMs === undefined) {
      throw new ReportBuildError('lastSignIn', 'a sign-in attempt names its age')
    }
  }
  const reasons = normalizedFactReasons(factReasons)
  const cleaned = {
    ...facts,
    ...(Object.keys(reasons).length > 0 && { factReasons: reasons }),
  }
  return cliVersion !== undefined && isReportVersion(cliVersion)
    ? { ...cleaned, cliVersion }
    : cleaned
}

/**
The facts a draft may use. A report with its facts switched off carries
none, so facts that fail validation must not stop it: it is built without
them, title included. With facts on, the refusal stands and names its field.
*/
function draftFacts(input: ProblemReportInput): ProblemReportFacts | undefined {
  try {
    return validatedFacts(input.facts)
  } catch (error: unknown) {
    if (input.includeFacts || !(error instanceof ReportBuildError)) throw error
    return undefined
  }
}

/** One record the report will carry, with its place in the input it came from. */
export interface SelectedReportEvent {
  /** The record's index in the input list: the preview's removal handle. */
  readonly index: number
  readonly event: ProblemReportEvent
}

/** How many records the selection left out, and why (lane REPORTFLOW R2). */
export interface ReportEventDropCounts {
  /** Failed validation or named a frame outside the shipped package. */
  readonly invalid: number
  /** Older than the journal keeps. */
  readonly tooOld: number
  /** Valid but past the recent-events cap (the oldest go first). */
  readonly overCap: number
}

/**
The stored records, validated again: a tampered journal cannot become an
arbitrary text attachment. Codes outside the recorder's vocabulary
(REPORT_ERROR_CODES) become the fixed word (D72); a record with any other
off-allowlist field is counted invalid and skipped; records older than the
journal keeps are counted too old. Keeps the last REPORT_RECENT_EVENT_COUNT
valid records, each with its input index, so a preview lists exactly the
records the draft carries; the rest are counted over the cap, oldest first.
*/
export function selectProblemReportEvents(
  input: readonly unknown[],
): readonly SelectedReportEvent[] {
  return problemReportEventSelection(input).events
}

/**
The selection above, with the records it left out counted by cause. Only
expired or invalid records count as unusable: a valid record older than the
recent-events cap is left out by the cap, counted but never reported as
unusable. A caller that pre-selects (the dialog) passes these counts to the
builder, so removing a listed record cannot pull an unlisted older one into
the draft.
*/
export function problemReportEventSelection(input: readonly unknown[]): {
  readonly events: readonly SelectedReportEvent[]
  readonly dropped: ReportEventDropCounts
} {
  const valid: SelectedReportEvent[] = []
  let invalid = 0
  let tooOld = 0
  for (const [index, candidate] of input.entries()) {
    const parsed = problemReportEventSchema.safeParse(candidate)
    if (!parsed.success) {
      invalid += 1
      continue
    }
    const event = parsed.data
    if (event.ageMs > REPORT_JOURNAL_MAX_AGE_MS) {
      tooOld += 1
      continue
    }
    if (event.frames.some((frame) => !isReportFramePath(frame.path))) {
      invalid += 1
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
  const overCap = Math.max(0, valid.length - REPORT_RECENT_EVENT_COUNT)
  return {
    events: valid.slice(-REPORT_RECENT_EVENT_COUNT),
    dropped: { invalid, tooOld, overCap },
  }
}

/** The pre-conversation sign-in events, oldest first among themselves. */
const SIGN_IN_EVENT_OUTCOMES: Readonly<Record<string, ReportSignInOutcome>> = {
  signInStarted: 'started',
  signInSucceeded: 'succeeded',
  signInFailed: 'failed',
}

/** The last error or warning notice shown: its catalogue code with its age. */
export function lastNoticeOf(
  events: readonly ProblemReportEvent[],
): { readonly code: string; readonly ageMs: number } | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.kind === 'errorNotice') {
      return { code: event.code, ageMs: event.ageMs }
    }
  }
  return undefined
}

/** The last sign-in attempt, in the fact's shape; undefined when none was recorded. */
export function lastSignInOf(
  events: readonly ProblemReportEvent[],
): NonNullable<ProblemReportFacts['lastSignIn']> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) {
      continue
    }
    const outcome = SIGN_IN_EVENT_OUTCOMES[event.kind]
    if (outcome !== undefined) {
      return { outcome, code: event.code, ageMs: event.ageMs }
    }
  }
  return undefined
}

/** The base facts the resolution is read from, as the builder takes them. */
interface ResolutionBaseFacts {
  readonly backend: string
  readonly cliFound: boolean
  readonly cliSignIn: boolean
  readonly hasStoredApiKey: boolean
}

function isResolutionBaseFacts(value: unknown): value is ResolutionBaseFacts {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const facts = value as Record<string, unknown>
  return (
    typeof facts['backend'] === 'string' &&
    (BACKEND_MODES as readonly string[]).includes(facts['backend']) &&
    typeof facts['cliFound'] === 'boolean' &&
    typeof facts['cliSignIn'] === 'boolean' &&
    typeof facts['hasStoredApiKey'] === 'boolean'
  )
}

/**
The base facts plus what the journal says (lane REPORTFLOW): the last
notice and sign-in from the selected records, the backend resolution from
the base booleans, and the panel state the dialog named. Every host builds
the same facts for the same state through this one function; the builder
validates the result again.
*/
export function enrichProblemReportFacts(
  facts: unknown,
  events: readonly unknown[],
  panelState?: ReportPanelState,
): unknown {
  if (typeof facts !== 'object' || facts === null) {
    return facts
  }
  const selected = selectProblemReportEvents(events).map((item) => item.event)
  const notice = lastNoticeOf(selected)
  const signIn = lastSignInOf(selected)
  const base: Record<string, unknown> = { ...(facts as Record<string, unknown>) }
  if (panelState !== undefined) {
    base['panelState'] = panelState
  }
  if (notice !== undefined) {
    base['lastNotice'] = notice
  }
  if (signIn !== undefined) {
    base['lastSignIn'] = signIn
  }
  if (isResolutionBaseFacts(facts)) {
    const resolution: ReportBackendResolution = describeBackendResolution({
      setting: facts.backend as (typeof BACKEND_MODES)[number],
      hasCli: facts.cliFound,
      hasCliSession: facts.cliSignIn,
      hasStoredKey: facts.hasStoredApiKey,
    })
    base['backendResolution'] = resolution
  }
  return base
}

/** What the second scrub needs: the roots to stand in for, and names to forget. */
export interface ReportScrubContext {
  /** Workspace roots, longest first is fine; each becomes `<workspace>`. */
  readonly workspaceRoots: readonly string[]
  /** The user's home directory; becomes `~` (D24). Empty means none known. */
  readonly homeDir: string
  /**
  Exact user/machine names the host read (login name, host name). Applied
  through the shared redactor; anything under EXTRA_LITERAL_MIN_CHARS is ignored.
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
A Windows path compared as Windows compares it: letters in lower case
(where that keeps the length, so every index still points into the
original) and `/` for `\`.
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
Windows roots have equivalent case, separators and extended spellings
(`\\?\C:\…`, `\\?\UNC\server\…`). Matched as literals, never as a pattern
built from the root.
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
The second scrub, over the entire final draft (D72): workspace roots, then
home, then other absolute user paths, URL queries and fragments, emails and
IP addresses, then every shared secret pattern (URL credentials among
them) with the host's user/machine names as exact literals, and finally
the refusal-leak scrub (round 2, finding 5): a pasted provider sentence
can carry a masked-key remnant or an account id that whole-secret patterns
never match.
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
  return scrubRefusalLeak(redactSecrets(text, literals))
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
  return `Problem report: Muse Spark ${facts.extensionVersion} on ${facts.platform ?? REPORT_UNKNOWN_ERROR_CODE}`
}

/** A yes/no fact the bounded read could not answer (lane REPORTFLOW R2). */
function triState(value: boolean | undefined): string {
  if (value === undefined) {
    return REPORT_UNKNOWN_ERROR_CODE
  }
  return value ? YES : NO
}

/**
A fact value the bounded read could not answer (lane REPORTFLOW R2): the
word `unknown` with its fixed reason code (`unknown (TimeoutError)`), or
the rendered value when the read answered.
*/
function unknownValue(facts: ProblemReportFacts, fact: string, rendered: string): string {
  const reason = facts.factReasons?.[fact]
  return reason === undefined ? rendered : `${REPORT_UNKNOWN_ERROR_CODE} (${reason})`
}

/** One `label: value` fact line, unknown with its reason when the read never answered. */
function unknownLine(
  facts: ProblemReportFacts,
  fact: string,
  label: string,
  value: string,
): string {
  return `${label}: ${unknownValue(facts, fact, value)}`
}

function factLines(facts: ProblemReportFacts): readonly string[] {
  let cli: string
  if (facts.cliFound === undefined) {
    cli = unknownValue(facts, 'cli', REPORT_UNKNOWN_ERROR_CODE)
  } else if (!facts.cliFound) {
    cli = 'not found'
  } else if (facts.cliVersion === undefined) {
    cli = 'found'
  } else {
    cli = `found (version ${facts.cliVersion})`
  }
  let contributor = 'unknown'
  if (facts.contributorMode === true) contributor = 'on'
  else if (facts.contributorMode === false) contributor = 'off'
  const settingNames = facts.settingNames ?? []
  return [
    unknownLine(facts, 'extensionVersion', 'extension', facts.extensionVersion),
    unknownLine(facts, 'vscodeVersion', 'vscode', facts.vscodeVersion ?? STANDALONE_AGENT),
    unknownLine(facts, 'nodeVersion', 'node', facts.nodeVersion),
    unknownLine(facts, 'platform', 'platform', facts.platform ?? REPORT_UNKNOWN_ERROR_CODE),
    unknownLine(facts, 'backend', 'backend', facts.backend ?? REPORT_UNKNOWN_ERROR_CODE),
    `contributor mode: ${contributor}`,
    `active backend: ${facts.activeBackend ?? 'not recorded'}`,
    ...(facts.modelApiStatus === undefined
      ? []
      : [
          `model api service: ${facts.modelApiStatus.status}; alive: ${facts.modelApiStatus.isAlive ? YES : NO}`,
        ]),
    `cli: ${cli}; signed in: ${unknownValue(facts, 'cliSignIn', triState(facts.cliSignIn))}`,
    `stored model api key: ${unknownValue(facts, 'hasStoredApiKey', triState(facts.hasStoredApiKey))}; META_API_KEY in environment: ${unknownValue(facts, 'hasEnvironmentApiKey', triState(facts.hasEnvironmentApiKey))}`,
    modelApiSignInLine(facts),
    unknownLine(facts, 'sandbox', 'shell sandbox', facts.sandbox ?? REPORT_UNKNOWN_ERROR_CODE),
    unknownLine(
      facts,
      'settingNames',
      'settings (names only)',
      settingNames.length === 0 ? NONE : settingNames.join(', '),
    ),
    `panel: ${facts.panelState ?? 'not recorded'}`,
    lastNoticeLine(facts),
    lastSignInLine(facts),
    `backend resolution: ${facts.backendResolution ?? 'not recorded'}`,
  ]
}

/**
The Model API backend's sign-in state in fixed words (lane REPORTFLOW
R2): a key anywhere signs it in; one unreadable read leaves it unknown
rather than signed out.
*/
function modelApiSignInLine(facts: ProblemReportFacts): string {
  const stored = facts.hasStoredApiKey
  const environment = facts.hasEnvironmentApiKey
  if (stored === true || environment === true) {
    const sources = [
      ...(stored === true ? ['stored key'] : []),
      ...(environment === true ? ['environment'] : []),
    ]
    return `model api sign-in: signed in (${sources.join(' and ')})`
  }
  return stored === undefined || environment === undefined
    ? `model api sign-in: ${REPORT_UNKNOWN_ERROR_CODE}`
    : 'model api sign-in: signed out'
}

/** The last notice the person was shown, as a catalogue code with its age (lane REPORTFLOW). */
function lastNoticeLine(facts: ProblemReportFacts): string {
  const notice = facts.lastNotice
  return notice === undefined
    ? 'last notice: none'
    : `last notice: ${notice.code} (${formatReportAge(notice.ageMs)})`
}

/** The last sign-in attempt, in fixed words (lane REPORTFLOW): absent reads as none. */
function lastSignInLine(facts: ProblemReportFacts): string {
  const signIn = facts.lastSignIn
  if (signIn === undefined || signIn.outcome === 'none') {
    return 'last sign-in: none'
  }
  if (signIn.outcome === 'failed') {
    const age = signIn.ageMs === undefined ? '' : ` (${formatReportAge(signIn.ageMs)})`
    return `last sign-in: failed ${signIn.code ?? REPORT_UNKNOWN_ERROR_CODE}${age}`
  }
  const age = signIn.ageMs === undefined ? '' : ` (${formatReportAge(signIn.ageMs)})`
  return `last sign-in: ${signIn.outcome}${age}`
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
  /**
  Why recording is unavailable, in the recorder's vocabulary (lane
  REPORTFLOW R2): a code outside it reads as `unknown`, which is also the
  word until the capture side provides its reason.
  */
  readonly recordingReason?: string
  /**
  Which recorded event the person meant (lane REPORTFLOW R2): the
  "Report This" handoff's kind. The draft marks that event's kind, code
  and age; a kind outside the vocabulary is ignored, never rendered.
  */
  readonly reportedKind?: unknown
  /**
  Records the minute's budget dropped before the journal (lane REPORTFLOW
  R2): counted in the draft beside what the builder left out. A
  non-count reads as none dropped.
  */
  readonly rateLimitedDrops?: number
  /**
  What a snapshot already counted as left out (lane REPORTFLOW R2): the
  dialog passes its selection's counts beside the carried events, so the
  draft counts the records the preview never lists. Added to what the
  builder itself leaves out of `events`.
  */
  readonly droppedEvents?: ReportEventDropCounts
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
Whether the title and text still match the seal: the draft shown equals the
draft exported. Any change after the preview fails this and invalidates the export.
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
The description as the draft carries it: trimmed, well-formed (a field cut
mid-pair would otherwise make the issue link throw), and cut to
REPORT_DESCRIPTION_MAX_CHARS user-perceived characters with an ellipsis.
*/
function cappedDescription(description: string): string {
  const trimmed = description.trim().replaceAll(LONE_SURROGATE, () => REPLACEMENT_CHARACTER)
  const graphemes = Array.from(new Intl.Segmenter().segment(trimmed), (part) => part.segment)
  return graphemes.length <= REPORT_DESCRIPTION_MAX_CHARS
    ? trimmed
    : `${graphemes.slice(0, REPORT_DESCRIPTION_MAX_CHARS).join('')}${TRUNCATED}`
}

/**
The "Report This" handoff's mark in the draft (lane REPORTFLOW R2): the
newest carried event of that kind, with its code and age. A kind outside
the vocabulary is ignored; a kind with no carried event says so instead
of marking another event.
*/
function reportedEventLine(
  selected: readonly SelectedReportEvent[],
  reportedKind: unknown,
): string | undefined {
  if (typeof reportedKind !== 'string') {
    return undefined
  }
  if (!(REPORT_EVENT_KINDS as readonly string[]).includes(reportedKind)) {
    return undefined
  }
  for (let index = selected.length - 1; index >= 0; index -= 1) {
    const event = selected[index]?.event
    if (event?.kind === reportedKind) {
      return `Reported event: ${reportedKind} ${event.code} (${formatReportAge(event.ageMs)})`
    }
  }
  return `Reported event: ${reportedKind} (not in recent events)`
}

/** A non-count reads as none dropped; a negative one reads as none dropped. */
function countedDrops(value: number | undefined): number {
  return typeof value !== 'number' || !Number.isFinite(value) ? 0 : Math.max(0, Math.floor(value))
}

/**
What the builder left out, in fixed words (lane REPORTFLOW R2): invalid
records, records too old to keep, records past the recent-events cap, and
records the minute's budget dropped. Undefined when nothing was dropped:
the heading's count already says that.
*/
function droppedEventsLine(
  dropped: ReportEventDropCounts,
  rateLimitedDrops: number | undefined,
): string | undefined {
  const parts: string[] = []
  if (dropped.invalid > 0) {
    parts.push(`${String(dropped.invalid)} invalid`)
  }
  if (dropped.tooOld > 0) {
    parts.push(`${String(dropped.tooOld)} too old`)
  }
  if (dropped.overCap > 0) {
    parts.push(`${String(dropped.overCap)} over the cap`)
  }
  const rateLimited = countedDrops(rateLimitedDrops)
  if (rateLimited > 0) {
    parts.push(`${String(rateLimited)} rate-limited`)
  }
  return parts.length === 0 ? undefined : `Dropped events: ${parts.join(', ')}`
}

/**
Builds, scrubs and seals the report draft. Throws ReportBuildError for
off-allowlist facts; skips off-allowlist records. The returned text is the
final draft: the preview shows it byte-identical, and exports carry it unchanged.
*/
function reportParts(input: ProblemReportInput): { title: string; text: string } {
  if (!Number.isFinite(input.nowMs)) {
    throw new ReportBuildError('nowMs', 'not a finite time')
  }
  const facts = draftFacts(input)
  const selection = problemReportEventSelection(input.events)
  const events = selection.events.map((selected) => selected.event)
  // The snapshot's counts join what this build left out (lane REPORTFLOW
  // R2): the dialog carries its selection while the journal's drops still
  // count. A caller passing raw events with no counts gets the recount
  // alone; counts never go negative.
  const leftOut = input.droppedEvents
  const dropped: ReportEventDropCounts = {
    invalid: selection.dropped.invalid + countedDrops(leftOut?.invalid),
    tooOld: selection.dropped.tooOld + countedDrops(leftOut?.tooOld),
    overCap: selection.dropped.overCap + countedDrops(leftOut?.overCap),
  }
  // Every age's anchor (lane REPORTFLOW R2): the epoch the relative ages
  // render against, so the ages still mean something when the issue is read
  // later. An ISO instant carries no secret and needs no scrub.
  const sections: string[] = [
    `Muse Spark problem report\nBuilt: ${new Date(input.nowMs).toISOString()}`,
  ]
  const description = cappedDescription(input.description)
  if (description !== '') {
    sections.push(`What was happening:\n${description}`)
  }
  if (facts !== undefined && input.includeFacts) {
    sections.push(`Support facts:\n${factLines(facts).join('\n')}`)
  }
  if (input.includeEvents) {
    if (input.recordingUnavailable) {
      // Why recording was unavailable (lane REPORTFLOW R2): the capture
      // side's reason code, or `unknown` until it provides one.
      const reason =
        typeof input.recordingReason === 'string' && REPORT_ERROR_CODES.has(input.recordingReason)
          ? input.recordingReason
          : REPORT_UNKNOWN_ERROR_CODE
      sections.push(
        `Recent events:\nevent recording was unavailable (${reason}), so this report has no recent events.`,
      )
    } else {
      const body: string[] = []
      const reported = reportedEventLine(selection.events, input.reportedKind)
      if (reported !== undefined) {
        body.push(reported)
      }
      body.push(events.length === 0 ? NONE : eventLines(events).join('\n'))
      const leftOut = droppedEventsLine(dropped, input.rateLimitedDrops)
      if (leftOut !== undefined) {
        body.push(leftOut)
      }
      sections.push(`Recent events (${String(events.length)}):\n${body.join('\n')}`)
    }
  }
  return {
    title: facts === undefined ? TITLE_WITHOUT_FACTS : problemReportTitle(facts),
    text: sections.join('\n\n'),
  }
}

/** The report builder: builds, scrubs and seals the draft. */
export function buildProblemReportDraft(input: ProblemReportInput): SealedReportDraft {
  const parts = reportParts(input)
  return sealReportDraft(
    scrubFinalDraft(parts.title, input.scrub),
    scrubFinalDraft(parts.text, input.scrub),
  )
}

/**
M109's vault-aware builder (lane REPORTFLOW R2): the vault lane's seam,
exercised by its own suite (`test/unit/vault/boundaryScrub.test.ts`).
The report flow calls the sync builder above while the vault is switched
off for users (no producer exists); M109 wires this one when its service
lands. Not dead: the vault suite fails without it.
*/
export async function buildVaultProblemReportDraft(
  input: ProblemReportInput,
  vaultScrub?: SecretScrubPort,
): Promise<SealedReportDraft> {
  const parts = reportParts(input)
  const title = vaultScrub === undefined ? parts.title : await vaultScrub.scrub(parts.title)
  const text = vaultScrub === undefined ? parts.text : await vaultScrub.scrub(parts.text)
  return sealReportDraft(scrubFinalDraft(title, input.scrub), scrubFinalDraft(text, input.scrub))
}

/** Where a draft goes on GitHub: opened prefilled, or the fallback when too long. */
export type IssueLink =
  { readonly kind: 'open'; readonly url: string } | { readonly kind: 'fallback' }

/**
The prefilled new-issue URL for a sealed draft. Past
REPORT_ISSUE_URL_MAX_CHARS the caller copies the same draft and opens the
unfilled form instead; the extension never posts anything itself.
*/
export function issueLinkForDraft(title: string, body: string): IssueLink {
  const url = `${REPORT_ISSUE_NEW_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
  return url.length <= REPORT_ISSUE_URL_MAX_CHARS ? { kind: 'open', url } : { kind: 'fallback' }
}
