// Session export, import and share files (M84, PLAN.md D49): one portable
// JSON document for all three, validated with zod on both ends.
//
// - What it holds: the conversation's transcript items, as the history the
//   Markdown export reads (M30), with only the fields a reader needs. Live
//   state (stored outputs and patches, child sessions, background handles,
//   workflow handles) never enters it, nor does the Model API replay: an
//   import rebuilds what the model reads from the transcript.
// - Known credential shapes (the log redactor's list, `redactSecrets`) and
//   the key digest are scrubbed from every string, always; a secret in a
//   shape the list does not know stays, which is why the preview shows the
//   file before anything is written. Account ids (e-mail addresses) and
//   paths are redacted by default.
// - Every imported byte is parsed: the format and its version first, then
//   the schema with its caps, then any field the schema does not know,
//   anywhere in the file, fails the whole file.
// - An import mints fresh session, turn and item ids (schedules are keyed by
//   session id, so none can follow), keeps the forced asking mode the caller
//   gives, drops goals, todos, outputs and patches, takes the user's own
//   model, and hands the model each imported turn as untrusted data in a
//   user-role message, never as its own replies or tool calls.
//
// Pure: the host reads the session and writes the file. No hosted sharing:
// the file moves on the user's own disk.

import * as z from 'zod/mini'
import { type ItemSnapshot, itemSnapshotFields } from '../../shared/agentEvents'
import {
  DEFAULT_EFFORT,
  MODEL_API_IMPORT_MAX_REPLAY_BYTES,
  CONVERSATION_MODEL_TEXT,
  REDACTED_MARK,
  SESSION_EXPORT_FIELD_PATH_MAX,
  SESSION_EXPORT_FORMAT,
  SESSION_EXPORT_MAX_ITEMS,
  SESSION_EXPORT_SCRUB_SLICE_CHARS,
  SESSION_EXPORT_VERSION,
  STORED_SESSION_VERSION,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatBytes } from '../../shared/l10n/text'
import type { ApprovalMode } from '../../shared/permissionModes'
import { BACKEND_KINDS, type BackendKind } from '../../shared/protocol'
import { redactableSlices, redactSecrets } from '../redact'
import type { SecretScrubPort } from '../../shared/redact'
import type {
  StoredReplayItem,
  StoredSession,
  StoredTranscriptItem,
} from '../backends/modelapi/sessionStore'

/**
 * The transcript fields a portable file keeps: what the panel, the share
 * view and the model need to read the conversation. Ids of live state
 * (`outputRef`, `patchRef`, `subagentId`, `childSessionId`, the workflow
 * handles, `background`) and opaque lists (`children`,
 * `modelVisibleContent`) stay behind; a file that holds one is refused.
 */
const portableItemFields = {
  itemId: itemSnapshotFields.itemId,
  kind: itemSnapshotFields.kind,
  status: itemSnapshotFields.status,
  text: itemSnapshotFields.text,
  summary: itemSnapshotFields.summary,
  tool: itemSnapshotFields.tool,
  args: itemSnapshotFields.args,
  visibleOutput: itemSnapshotFields.visibleOutput,
  failureReason: itemSnapshotFields.failureReason,
  patchSummary: itemSnapshotFields.patchSummary,
  fallbackText: itemSnapshotFields.fallbackText,
  attachments: itemSnapshotFields.attachments,
  role: itemSnapshotFields.role,
  objective: itemSnapshotFields.objective,
  durationMs: itemSnapshotFields.durationMs,
  result: itemSnapshotFields.result,
  commandText: itemSnapshotFields.commandText,
  exitCode: itemSnapshotFields.exitCode,
  exitSignal: itemSnapshotFields.exitSignal,
  paid: itemSnapshotFields.paid,
  citations: itemSnapshotFields.citations,
  message: itemSnapshotFields.message,
} as const
const PORTABLE_ITEM_KEYS: ReadonlySet<string> = new Set(Object.keys(portableItemFields))

export const sessionExportSchema = z.object({
  format: z.literal(SESSION_EXPORT_FORMAT),
  version: z.literal(SESSION_EXPORT_VERSION),
  exportedAt: z.iso.datetime(),
  sourceBackend: z.enum(BACKEND_KINDS),
  /**
   * Whether paths and account ids were redacted when the file was written:
   * the writer's claim, which a reader cannot check.
   */
  redacted: z.boolean(),
  name: z.optional(z.string()),
  /** The model the conversation ran on; informational, an import never takes it. */
  modelId: z.string(),
  transcript: z.array(z.object(portableItemFields)).check(z.maxLength(SESSION_EXPORT_MAX_ITEMS)),
})

export type SessionExport = z.infer<typeof sessionExportSchema>

export type SessionExportParse =
  | { readonly ok: true; readonly doc: SessionExport }
  | { readonly ok: false; readonly reason: string }

// Read before the schema, so a file of another format or a newer version is
// named as such instead of as a list of schema errors.
const headerSchema = z.object({ format: z.string(), version: z.number() })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One step of a path into the file: a key, or an index. */
function pathStep(path: string, step: PropertyKey): string {
  if (typeof step === 'number') {
    return `${path}[${String(step)}]`
  }
  return path === '' ? String(step) : `${path}.${String(step)}`
}

// Control characters (a newline, an escape) in a key a file chose.
const CONTROL_CHARACTERS = /\p{Cc}/gu
const ELLIPSIS = '…'

/**
 * A path into a refused file as a notice and the log may carry it: its keys
 * are the file's own text, so control characters are replaced and the whole
 * is cut short.
 */
function safePath(path: string): string {
  const scrubbed = scrubText(path, { redact: true, localRoots: [] }, [], {
    secrets: 0,
    accounts: 0,
    paths: 0,
  })
  const printable = scrubbed.replaceAll(CONTROL_CHARACTERS, () => '?')
  return printable.length > SESSION_EXPORT_FIELD_PATH_MAX
    ? `${printable.slice(0, SESSION_EXPORT_FIELD_PATH_MAX)}${ELLIPSIS}`
    : printable
}

/**
 * The first field of `raw` the schema did not keep, as a path
 * (`transcript[2].outputRef`). zod drops unknown keys while parsing, so the
 * parse is compared against what was read.
 */
function firstUnknownField(raw: unknown, parsed: unknown, path: string): string | undefined {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    for (const [index, entry] of raw.entries()) {
      const found = firstUnknownField(entry, parsed[index], pathStep(path, index))
      if (found !== undefined) {
        return found
      }
    }
    return undefined
  }
  if (!isRecord(raw) || !isRecord(parsed)) {
    return undefined
  }
  for (const [key, value] of Object.entries(raw)) {
    const at = pathStep(path, key)
    if (!Object.hasOwn(parsed, key)) {
      return at
    }
    const found = firstUnknownField(value, parsed[key], at)
    if (found !== undefined) {
      return found
    }
  }
  return undefined
}

/**
 * Validates one parsed JSON document: format, version, schema and caps, then
 * unknown fields. A refusal names one problem in a bounded line: the file's
 * own text never reaches a notice or the log as it was written.
 */
export function parseSessionExport(raw: unknown): SessionExportParse {
  const header = headerSchema.safeParse(raw)
  if (!header.success || header.data.format !== SESSION_EXPORT_FORMAT) {
    return { ok: false, reason: UI_TEXT.transferNotAnExport }
  }
  if (header.data.version !== SESSION_EXPORT_VERSION) {
    return {
      ok: false,
      reason: fill(UI_TEXT.transferVersionUnsupported, { version: String(header.data.version) }),
    }
  }
  const result = sessionExportSchema.safeParse(raw)
  if (!result.success) {
    const [issue] = result.error.issues
    const steps = issue?.path ?? []
    let at = ''
    for (const step of steps) {
      at = pathStep(at, step)
    }
    return {
      ok: false,
      reason: fill(UI_TEXT.transferInvalidField, { field: safePath(at === '' ? '.' : at) }),
    }
  }
  const unknown = firstUnknownField(raw, result.data, '')
  return unknown === undefined
    ? { ok: true, doc: result.data }
    : { ok: false, reason: fill(UI_TEXT.transferUnknownField, { field: safePath(unknown) }) }
}

// --- Redaction ---

// A SHA-256 digest such as the stored session's `accountId`, and any longer
// hex run around one: cutting a run into 64-character pieces would leave
// part of a digest behind. It starts only where no hex digit precedes, so a
// run is tried once, not once per digit in it (common in ordinary text). The
// credential shapes are the log redactor's (`redactSecrets`), the one list
// the extension keeps.
const KEY_DIGEST = /(?<![A-Fa-f0-9])[A-Fa-f0-9]{64,}/g
// Bounded as RFC 5321 bounds an address's parts, so a long run of word
// characters (a base64 blob in a tool output) is scanned in linear time.
const EMAIL_ADDRESS = /[\w.%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}/g
// `file://` URIs, whose path the POSIX rule's guard would skip. One whose
// path a local root has already replaced is left as it reads.
const FILE_URI = /\bfile:\/\/(?!\/*\[)[^\s"'<>()[\]]+/gi
// Absolute POSIX paths of two or more segments. The lookbehind keeps
// relative paths (`a/b`, `./a/b`), URLs (`https://…`) and bare commands
// (`/export`) intact; over-redaction stays the safe direction. A segment
// holds the ASCII characters a name commonly does, or any character outside
// ASCII that is not white space, so `/srv/私密`, `/Users/José` and an emoji
// folder go whole (RV84c C2); CJK punctuation glued after a path goes with
// it. Each segment ends at a `/`, so the scan stays linear.
const POSIX_PATH =
  /(?<![\w.:/\\])\/(?:(?:[\w.~+%-]|[^\p{ASCII}\s])+\/)+(?:[\w.~+%-]|[^\p{ASCII}\s])+/gu
// Drive-letter paths with either separator, and UNC paths.
const WINDOWS_PATH = /(?<!\w)[A-Za-z]:[\\/][^\s"'<>|?*]+|\\\\[^\s"'<>|?*]+/g
const PATH_PATTERNS: readonly RegExp[] = [FILE_URI, POSIX_PATH, WINDOWS_PATH]
const PATH_SEPARATORS = /[\\/]+/
const TRAILING_SEPARATORS = /[\\/]+$/
const LINE_BREAK = '\n'
// Where a path that starts at a local root ends.
const PATH_END = /[\s"'<>|]/
// A local root shorter than this many segments (`/`, `C:\`, `/root`) is left
// to the patterns above: replacing it verbatim would eat ordinary text.
const LOCAL_ROOT_MIN_SEGMENTS = 2

export interface ScrubCounts {
  /** Credentials and key digests scrubbed, always. */
  secrets: number
  /** Account ids (e-mail addresses) redacted, by default. */
  accounts: number
  /** Paths redacted, by default. */
  paths: number
}

export interface ExportRedaction {
  /** Exact vault values are always removed, including a user-selected full export. */
  readonly vaultScrub?: SecretScrubPort
  /** Redact account ids and paths; false only after the preview asked for the full file. */
  readonly redact: boolean
  /**
   * This machine's own folders (the workspace folders, the home folder),
   * replaced wherever they appear, spaces and all: the patterns stop at a
   * space, and a user name in a home path is what matters most.
   */
  readonly localRoots: readonly string[]
}

/** The text with every known credential shape and key digest replaced by the mark. */
function withoutCredentials(text: string): string {
  return redactSecrets(text).replaceAll(KEY_DIGEST, () => REDACTED_MARK)
}

/** M118 reuses M84's credential, digest and account scrub before path normalisation. */
export function scrubTransferIdentifiers(text: string): string {
  return withoutCredentials(text).replaceAll(
    EMAIL_ADDRESS,
    () => CONVERSATION_MODEL_TEXT.exportRedactedAccount,
  )
}

/**
 * Text as local roots are looked up in it: lower case, and every run of
 * separators one `/`, so `C:\Users`, `c:/users` and the JSON-escaped
 * `C:\\Users` all read `c:/users`. `offsets[i]` is where the folded
 * character `i` starts in the original, and `offsets[folded.length]` is the
 * original's length.
 */
interface FoldedText {
  readonly text: string
  readonly offsets: readonly number[]
}

// One pass with no allocation per character: a spread of a fresh array per
// character made this half of a whole export's time (RV84 #9).
function foldText(text: string): FoldedText {
  const parts: string[] = []
  const offsets: number[] = []
  let at = 0
  let isAfterSeparator = false
  for (const char of text) {
    if (char === '/' || char === '\\') {
      if (!isAfterSeparator) {
        parts.push('/')
        offsets.push(at)
        isAfterSeparator = true
      }
    } else {
      const lower = char.toLowerCase()
      parts.push(lower)
      // One offset per UTF-16 unit, not per code point (`İ` lower-cases to two).
      offsets.push(at)
      for (let extra = 1; extra < lower.length; extra += 1) {
        offsets.push(at)
      }
      isAfterSeparator = false
    }
    at += char.length
  }
  offsets.push(text.length)
  return { text: parts.join(''), offsets }
}

/**
 * The local roots worth looking for, folded, longest first. A root of fewer
 * than two segments is left out.
 */
function foldedRoots(localRoots: readonly string[]): readonly string[] {
  return localRoots
    .map((root) => foldText(root.replace(TRAILING_SEPARATORS, '')).text)
    .filter(
      (root) =>
        root.split(PATH_SEPARATORS).filter((segment) => segment !== '').length >=
        LOCAL_ROOT_MIN_SEGMENTS,
    )
    .toSorted((a, b) => b.length - a.length)
}

/**
 * Every path that starts at a local root, in either separator, doubled or
 * not, and any letter case, replaced to its end. A text that does not name
 * the root's last folder is not folded at all.
 */
function redactLocalRoots(text: string, roots: readonly string[], counts: ScrubCounts): string {
  let result = text
  for (const root of roots) {
    const lastFolder = root.slice(root.lastIndexOf('/') + 1)
    if (!result.toLowerCase().includes(lastFolder)) {
      continue
    }
    const haystack = foldText(result)
    let rebuilt = ''
    let from = 0
    let search = 0
    for (
      let at = haystack.text.indexOf(root, search);
      at !== -1;
      at = haystack.text.indexOf(root, search)
    ) {
      const start = haystack.offsets[at] ?? result.length
      let end = haystack.offsets[at + root.length] ?? result.length
      while (end < result.length && !PATH_END.test(result.charAt(end))) {
        end += 1
      }
      rebuilt += `${result.slice(from, start)}${CONVERSATION_MODEL_TEXT.exportRedactedPath}`
      from = end
      search = at + root.length
      while (search < haystack.text.length && (haystack.offsets[search] ?? end) < end) {
        search += 1
      }
      counts.paths += 1
    }
    result = `${rebuilt}${result.slice(from)}`
  }
  return result
}

function scrubText(
  text: string,
  redaction: ExportRedaction,
  roots: readonly string[],
  counts: ScrubCounts,
): string {
  const clean = withoutCredentials(text)
  if (clean !== text) {
    counts.secrets += Math.max(
      0,
      clean.split(REDACTED_MARK).length - text.split(REDACTED_MARK).length,
    )
  }
  if (!redaction.redact) {
    return clean
  }
  // Each pattern runs once, counting as it replaces; an address needs an `@`.
  const withoutAccounts = clean.includes('@')
    ? clean.replaceAll(EMAIL_ADDRESS, () => {
        counts.accounts += 1
        return CONVERSATION_MODEL_TEXT.exportRedactedAccount
      })
    : clean
  let redacted = redactLocalRoots(withoutAccounts, roots, counts)
  for (const pattern of PATH_PATTERNS) {
    redacted = redacted.replaceAll(pattern, () => {
      counts.paths += 1
      return CONVERSATION_MODEL_TEXT.exportRedactedPath
    })
  }
  return redacted
}

/** M113 uses the export's exact scrub for snapshots and each output format. */
export function createExportTextScrubber(redaction: ExportRedaction): (text: string) => string {
  const roots = foldedRoots(redaction.localRoots)
  const counts: ScrubCounts = { secrets: 0, accounts: 0, paths: 0 }
  return (text) => scrubText(text, redaction, roots, counts)
}

/** How much text has been scrubbed since the event loop last ran. */
interface ScrubPace {
  sinceYield: number
  /** How long a piece of one string may be (`redactableSlices`). */
  readonly sliceChars: number
}

/**
 * Lets the event loop run once a slice of text has been scrubbed: the scrub
 * runs on the extension host, and a long conversation scrubbed in one go held
 * every extension in the window for seconds (RV84 #9). A long string is cut
 * only just after a line break that nothing redacted goes on past, so each
 * pattern sees whole what it would see in the whole string; a single line
 * longer than a slice is still scrubbed in one go. `setImmediate`, not a
 * timer: on Windows a zero timer waits for the next ~15 ms clock tick, which
 * made a 4 MiB export spend a second waiting.
 */
async function pace(scrubbed: ScrubPace, length: number): Promise<void> {
  scrubbed.sinceYield += length
  if (scrubbed.sinceYield < SESSION_EXPORT_SCRUB_SLICE_CHARS) {
    return
  }
  scrubbed.sinceYield = 0
  await new Promise((resolve) => {
    setImmediate(resolve)
  })
}

/** Every string scrubbed; ordinary protocol words and UUIDs do not match secret shapes. */
async function scrubValue(
  value: unknown,
  scrub: (text: string) => string,
  scrubbed: ScrubPace,
): Promise<unknown> {
  if (typeof value === 'string') {
    let clean = ''
    for (const slice of redactableSlices(value, scrubbed.sliceChars)) {
      clean += scrub(slice)
      await pace(scrubbed, slice.length)
    }
    return clean
  }
  if (Array.isArray(value)) {
    const entries: unknown[] = []
    for (const entry of value) {
      entries.push(await scrubValue(entry, scrub, scrubbed))
    }
    return entries
  }
  if (!isRecord(value)) {
    return value
  }
  const fields: [string, unknown][] = []
  for (const [name, entry] of Object.entries(value)) {
    fields.push([name, await scrubValue(entry, scrub, scrubbed)])
  }
  return Object.fromEntries(fields)
}

// --- Export ---

const USER_MESSAGE = 'userMessage'
const AGENT_MESSAGE = 'agentMessage'

/** The messages in a transcript, the user's and the agent's, as the previews count them. */
export function messageCount(items: readonly Pick<ItemSnapshot, 'kind'>[]): number {
  return items.filter((item) => item.kind === USER_MESSAGE || item.kind === AGENT_MESSAGE).length
}

export interface SessionExportSource {
  readonly backend: BackendKind
  readonly name?: string | undefined
  readonly modelId: string
  /** ISO 8601. */
  readonly exportedAt: string
  /** The session's history, as the Markdown export reads it. */
  readonly items: readonly ItemSnapshot[]
}

export interface BuiltSessionExport extends ScrubCounts {
  readonly doc: SessionExport
}

function portableItem(item: ItemSnapshot): Record<string, unknown> {
  return Object.fromEntries(Object.entries(item).filter(([key]) => PORTABLE_ITEM_KEYS.has(key)))
}

/**
 * The portable document for a conversation: credentials and the key digest
 * scrubbed from every string, account ids and paths too unless `redact` is
 * false. The result is parsed with the import's own schema, so a file this
 * writes is one an import reads. The event loop runs between slices of the
 * scrub (`pace`).
 */
export async function buildSessionExport(
  source: SessionExportSource,
  redaction: ExportRedaction,
): Promise<BuiltSessionExport> {
  const counts: ScrubCounts = { secrets: 0, accounts: 0, paths: 0 }
  const roots = foldedRoots(redaction.localRoots)
  const document = {
    format: SESSION_EXPORT_FORMAT,
    version: SESSION_EXPORT_VERSION,
    exportedAt: source.exportedAt,
    sourceBackend: source.backend,
    redacted: redaction.redact,
    ...(source.name !== undefined && { name: source.name }),
    modelId: source.modelId,
    transcript: source.items.map((item) => portableItem(item)),
  }
  // Whole document before slicing or path/pattern edits: encoded secrets may
  // span lines, and privacy edits must not leave a recognizable value's tail.
  let safeDocument: unknown = document
  if (redaction.vaultScrub !== undefined) {
    const original = JSON.stringify(document)
    const clean = await redaction.vaultScrub.scrub(original)
    counts.secrets += Math.max(
      0,
      clean.split(REDACTED_MARK).length - original.split(REDACTED_MARK).length,
    )
    safeDocument = JSON.parse(clean)
  }
  const scrubbed = await scrubValue(
    safeDocument,
    (text) => scrubText(text, redaction, roots, counts),
    {
      sinceYield: 0,
      // Cut at a line break, a folder whose name holds one could be split:
      // such a string is scrubbed whole.
      sliceChars: roots.some((root) => root.includes(LINE_BREAK))
        ? Infinity
        : SESSION_EXPORT_SCRUB_SLICE_CHARS,
    },
  )
  return { ...counts, doc: sessionExportSchema.parse(scrubbed) }
}

// --- Import ---

const JSON_INDENT = 2
// Kinds the model is not handed: its old thinking, and host-internal children.
const NOT_FOR_THE_MODEL: ReadonlySet<string> = new Set(['reasoning', 'reminderChild'])
// Fields that mean nothing to the model reading an old turn.
const NOT_FOR_THE_MODEL_FIELDS: ReadonlySet<string> = new Set([
  'itemId',
  'turnId',
  'durationMs',
  'paid',
])
const IMPORTED_TURN_PREFIX = 'imported-turn-'
const IMPORTED_ITEM_PREFIX = 'imported-item-'

export interface SanitizeImportOptions {
  /** A fresh session id: schedules are keyed by session id, so none can follow. */
  readonly sessionId: string
  readonly workspaceRoot: string
  /** Forced by the caller (Manual, or Plan): nothing in the file sets it. */
  readonly approvalMode: ApprovalMode
  /** The user's own model: nothing in the file picks one. */
  readonly modelId: string
  /** ISO 8601. */
  readonly now: string
}

interface ImportedTurn {
  readonly turnId: string
  readonly items: ItemSnapshot[]
}

function hasUserMessage(turn: ImportedTurn): boolean {
  return turn.items.some((item) => item.kind === USER_MESSAGE)
}

/** The file's items in turns: each user message starts one, and everything before the first joins it. */
function importedTurns(transcript: readonly ItemSnapshot[]): readonly ImportedTurn[] {
  const turns: ImportedTurn[] = []
  let itemCount = 0
  for (const item of transcript) {
    let turn = turns.at(-1)
    if (turn === undefined || (item.kind === USER_MESSAGE && hasUserMessage(turn))) {
      turn = { turnId: `${IMPORTED_TURN_PREFIX}${String(turns.length)}`, items: [] }
      turns.push(turn)
    }
    turn.items.push({
      ...item,
      itemId: `${IMPORTED_ITEM_PREFIX}${String(itemCount)}`,
      turnId: turn.turnId,
    })
    itemCount += 1
  }
  return turns
}

/** One imported turn as the model reads it: a lead that marks it untrusted, then its items as JSON. */
type ImportModelText = Pick<
  typeof CONVERSATION_MODEL_TEXT,
  'importedHistoryNote' | 'importedTurnLead'
>

function turnForTheModel(
  turn: ImportedTurn,
  isFirst: boolean,
  text: ImportModelText,
): StoredReplayItem {
  const items = turn.items
    .filter((item) => !NOT_FOR_THE_MODEL.has(item.kind))
    .map((item) =>
      Object.fromEntries(
        Object.entries(item).filter(([key]) => !NOT_FOR_THE_MODEL_FIELDS.has(key)),
      ),
    )
  const lead = isFirst
    ? `${text.importedHistoryNote}\n\n${text.importedTurnLead}`
    : text.importedTurnLead
  return {
    turnId: turn.turnId,
    item: {
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: `${lead}\n${JSON.stringify(items, undefined, JSON_INDENT)}` },
      ],
    },
  }
}

function importedReplay(turns: readonly ImportedTurn[], text: ImportModelText): StoredReplayItem[] {
  return turns.map((turn, index) => turnForTheModel(turn, index === 0, text))
}

/** The UTF-8 bytes of the text `replay` hands the model. */
function replayBytes(replay: readonly StoredReplayItem[]): number {
  let bytes = 0
  for (const { item } of replay) {
    if (item.type !== 'message') {
      continue
    }
    for (const part of item.content) {
      if (part.type === 'input_text') {
        bytes += Buffer.byteLength(part.text)
      }
    }
  }
  return bytes
}

/** The refusal for a replay of `bytes`, naming both sizes; undefined when it fits. */
function oversizeReason(bytes: number): string | undefined {
  return bytes > MODEL_API_IMPORT_MAX_REPLAY_BYTES
    ? fill(UI_TEXT.importReplayTooLarge, {
        size: formatBytes(bytes),
        limit: formatBytes(MODEL_API_IMPORT_MAX_REPLAY_BYTES),
      })
    : undefined
}

/**
 * Why `doc` cannot be resumed on the Model API, or undefined (RV84 #10): the
 * text it hands the model, counted high as one token per UTF-8 byte, must
 * fit `MODEL_API_IMPORT_MAX_REPLAY_BYTES`. Accepted, a larger one would
 * fail every later message past the model's window; it can still be read as
 * a share file.
 */
export function importRefusal(doc: SessionExport): string | undefined {
  return oversizeReason(
    replayBytes(importedReplay(importedTurns(doc.transcript), CONVERSATION_MODEL_TEXT)),
  )
}

/**
 * A parsed export as a stored session that resumes safely. The transcript
 * keeps what the panel shows, under fresh ids. The model is handed each turn
 * as untrusted data in a user-role message, so nothing in the file speaks as
 * the model, a tool or the developer. The permission mode and model are the
 * caller's; goals, todos, outputs, patches, children and usage start empty;
 * session rules live in a fresh session's own engine, so none carry over.
 * `imported` stays with the session, its forks and its restarts, so it
 * starts asking every time it is opened (PLAN.md D49). Throws, naming the
 * sizes, when its turns do not fit the model (`importRefusal`).
 */
export function sanitizeImportedSession(
  doc: SessionExport,
  options: SanitizeImportOptions,
  text: ImportModelText,
): StoredSession {
  const turns = importedTurns(doc.transcript)
  const replay = importedReplay(turns, text)
  const refusal = oversizeReason(replayBytes(replay))
  if (refusal !== undefined) {
    throw new Error(refusal)
  }
  const transcript: StoredTranscriptItem[] = turns.flatMap((turn) =>
    turn.items.map((item) => ({ turnId: turn.turnId, item })),
  )
  const firstPrompt = doc.transcript.find((item) => item.kind === USER_MESSAGE)?.text
  return {
    version: STORED_SESSION_VERSION,
    sessionId: options.sessionId,
    imported: true,
    workspaceRoot: options.workspaceRoot,
    modelId: options.modelId,
    approvalMode: options.approvalMode,
    effort: DEFAULT_EFFORT,
    ...(doc.name !== undefined && { name: doc.name }),
    createdAt: options.now,
    lastActivityAt: options.now,
    turnIds: turns.map((turn) => turn.turnId),
    ...(firstPrompt !== undefined && { firstPrompt }),
    todos: [],
    replay,
    transcript,
    outputs: {},
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
  }
}
