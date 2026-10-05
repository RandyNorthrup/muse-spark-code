// The flight recorder (M93 lane R, PLAN.md D72): facts about failures, never
// the conversation. Portable: no `vscode` import and no file access. The host
// adapter in src/host/support/reportJournal.ts owns the journal and marker
// files; this module owns the policy: what a record may hold, how it is
// scrubbed and validated before writing, how journal text parses back (a
// truncated or tampered record is skipped and counted, never trusted), how
// entries prune to the age and size caps, and which activation marker reads
// as a crash.
//
// A record holds a fixed event kind, a known error code (anything else becomes
// the fixed unknown word), extension and host versions, an optional backend
// and count, and bounded frames with verified package-relative paths. No
// prompts, code, file contents, model output, tool arguments or results,
// command text, conversation or session ids, credentials, or raw
// messages, stacks or absolute paths cross here: the shapes below have no
// field for them, every object is strict, and semantic checks reject what the
// transport bounds alone cannot see (absolute paths, traversal, URLs).

import * as z from 'zod/mini'
import {
  BACKEND_KINDS,
  reportWebviewErrorSchema,
  type BackendKind,
} from '../../shared/protocol'
import {
  REPORT_ERROR_CODE_MAX_CHARS,
  REPORT_EVENT_KINDS,
  REPORT_FRAME_PATH_MAX_CHARS,
  REPORT_JOURNAL_ENTRY_MAX_BYTES,
  REPORT_JOURNAL_MAX_AGE_MS,
  REPORT_JOURNAL_MAX_BYTES,
  REPORT_JOURNAL_VERSION,
  REPORT_STACK_MAX_FRAMES,
  REPORT_UNKNOWN_ERROR_CODE,
  REPORT_VERSION_MAX_CHARS,
  type ReportEventKind,
} from '../../shared/constants'
import { redactSecrets } from '../redact'

/** An error class as a short token (an errno, an exit word), never a sentence. */
const CODE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/
/** A version as a short token (a dotted triple), never a sentence. */
const VERSION_TOKEN = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,31}$/
/** A URI scheme prefix (`https:`, `file:`, `vscode-remote:`): never a journal path. */
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/
/** A Windows drive root (`C:/`): never a journal path. */
const DRIVE_ROOT = /^[A-Za-z]:\//
/** A window instance id as a file stem: what the recorder itself generates. */
const INSTANCE_STEM = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
/** A journal file name, capturing the owning instance. */
const JOURNAL_NAME = /^journal-([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.jsonl$/
/** A marker file name, capturing the owning instance. */
const MARKER_NAME = /^marker-([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.json$/
/** Crash-left atomic-write stages, swept at startup. */
const TEMP_NAME = /^[A-Za-z0-9_.-]+\.tmp-\d+$/

const flightFrameSchema = z.strictObject({
  /** A package-relative path the recorder already verified. */
  path: z.string().check(z.minLength(1), z.maxLength(REPORT_FRAME_PATH_MAX_CHARS)),
  line: z.int().check(z.gte(1)),
  column: z.int().check(z.gte(0)),
})
export type FlightFrame = z.infer<typeof flightFrameSchema>

export const flightRecordSchema = z.strictObject({
  v: z.literal(REPORT_JOURNAL_VERSION),
  kind: z.enum(REPORT_EVENT_KINDS),
  /** Milliseconds since the epoch: when the failure was recorded. */
  at: z.int().check(z.gte(0)),
  /** A known error class, or the fixed unknown word. */
  code: z.string().check(z.minLength(1), z.maxLength(REPORT_ERROR_CODE_MAX_CHARS)),
  /** The extension's own version. */
  ext: z.string().check(z.minLength(1), z.maxLength(REPORT_VERSION_MAX_CHARS)),
  /** The host's version. */
  host: z.string().check(z.minLength(1), z.maxLength(REPORT_VERSION_MAX_CHARS)),
  /** Which backend the failure belongs to, when it belongs to one. */
  backend: z.optional(z.enum(BACKEND_KINDS)),
  /** A small count, such as the attempt number. */
  count: z.optional(z.int().check(z.gte(0))),
  /** The scrubbed stack's verified frames, most recent call first. */
  frames: z.array(flightFrameSchema).check(z.maxLength(REPORT_STACK_MAX_FRAMES)),
})
export type FlightRecord = z.infer<typeof flightRecordSchema>

export const flightMarkerSchema = z.strictObject({
  v: z.literal(REPORT_JOURNAL_VERSION),
  /** The window instance that owns this marker. */
  instance: z.string().check(z.minLength(1), z.maxLength(64)),
  /** The extension host process that wrote it. */
  pid: z.int().check(z.gte(0)),
  /** Milliseconds since the epoch: when the activation started. */
  at: z.int().check(z.gte(0)),
})
export type FlightMarker = z.infer<typeof flightMarkerSchema>

/** Raw caller data for one stack frame: verified package-relative before writing. */
export interface FlightFrameInput {
  readonly path: string
  readonly line: number
  readonly column: number
}

/** Raw caller data for one failure: scrubbed and validated before writing. */
export interface FlightEventInput {
  readonly kind: ReportEventKind
  /** The raw error class; an unknown shape becomes the fixed unknown word. */
  readonly code: string
  readonly ext: string
  readonly host: string
  readonly backend?: BackendKind
  readonly count?: number
  readonly frames?: readonly FlightFrameInput[]
}

/** Why a record was refused: fixed words, never the offending text. */
export type FlightRefusal = 'unknownKind' | 'badVersion' | 'badBackend' | 'badCount' | 'invalid' | 'oversize'

export type BuiltFlightRecord =
  | { readonly ok: true; readonly record: FlightRecord }
  | { readonly ok: false; readonly reason: FlightRefusal }

/** What journal text parses back to: valid entries, and what was not trusted. */
export interface ParsedJournal {
  readonly entries: readonly FlightRecord[]
  /** Lines that failed to parse, failed the schema, or broke the entry cap. */
  readonly skipped: number
  /** The file ended mid-record: the torn tail was discarded. */
  readonly torn: boolean
}

function isEventKind(kind: string): kind is ReportEventKind {
  return REPORT_EVENT_KINDS.some((known) => known === kind)
}

function isBackendKind(backend: string): backend is BackendKind {
  return BACKEND_KINDS.some((known) => known === backend)
}

function scrubCode(code: string): string {
  const scrubbed = redactSecrets(code)
  return CODE_TOKEN.test(scrubbed) ? scrubbed : REPORT_UNKNOWN_ERROR_CODE
}

function scrubVersion(version: string): string | undefined {
  const scrubbed = redactSecrets(version)
  return VERSION_TOKEN.test(scrubbed) ? scrubbed : undefined
}

/**
 * A frame path the journal may hold: relative, with no empty, dot or
 * dot-dot segments, no backslashes, no drive root and no URI scheme. A path
 * the redactor changes (a secret-shaped value) never lands: the frame is
 * dropped, not repaired.
 */
function scrubFramePath(path: string): string | undefined {
  const scrubbed = redactSecrets(path)
  if (scrubbed !== path) return undefined
  if (scrubbed.length < 1 || scrubbed.length > REPORT_FRAME_PATH_MAX_CHARS) return undefined
  if (scrubbed.includes('\\')) return undefined
  if (scrubbed.startsWith('/')) return undefined
  if (DRIVE_ROOT.test(scrubbed) || URI_SCHEME.test(scrubbed)) return undefined
  const segments = scrubbed.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return undefined
  }
  return scrubbed
}

function scrubFrames(frames: readonly FlightFrameInput[] | undefined): FlightFrame[] {
  if (frames === undefined) return []
  const kept: FlightFrame[] = []
  for (const frame of frames) {
    if (kept.length >= REPORT_STACK_MAX_FRAMES) break
    const path = scrubFramePath(frame.path)
    if (path === undefined) continue
    if (!Number.isInteger(frame.line) || frame.line < 1) continue
    if (!Number.isInteger(frame.column) || frame.column < 0) continue
    kept.push({ path, line: frame.line, column: frame.column })
  }
  return kept
}

function assemble(input: {
  kind: string
  code: string
  ext: string
  host: string
  backend: string | undefined
  count: number | undefined
  frames: readonly FlightFrameInput[] | undefined
  at: number
}): BuiltFlightRecord {
  if (!isEventKind(input.kind)) return { ok: false, reason: 'unknownKind' }
  const ext = scrubVersion(input.ext)
  if (ext === undefined) return { ok: false, reason: 'badVersion' }
  const host = scrubVersion(input.host)
  if (host === undefined) return { ok: false, reason: 'badVersion' }
  if (input.backend !== undefined && !isBackendKind(input.backend)) {
    return { ok: false, reason: 'badBackend' }
  }
  if (input.count !== undefined && (!Number.isInteger(input.count) || input.count < 0)) {
    return { ok: false, reason: 'badCount' }
  }
  if (!Number.isInteger(input.at) || input.at < 0) return { ok: false, reason: 'invalid' }
  const candidate = {
    v: REPORT_JOURNAL_VERSION,
    kind: input.kind,
    at: input.at,
    code: scrubCode(input.code),
    ext,
    host,
    ...(input.backend === undefined ? {} : { backend: input.backend }),
    ...(input.count === undefined ? {} : { count: input.count }),
    frames: scrubFrames(input.frames),
  }
  const parsed = flightRecordSchema.safeParse(candidate)
  if (!parsed.success) return { ok: false, reason: 'invalid' }
  if (Buffer.byteLength(serializeFlightRecord(parsed.data), 'utf8') > REPORT_JOURNAL_ENTRY_MAX_BYTES) {
    return { ok: false, reason: 'oversize' }
  }
  return { ok: true, record: parsed.data }
}

/** Scrub and validate a host-observed failure; refused records never reach the file. */
export function buildFlightRecord(input: FlightEventInput, at: number): BuiltFlightRecord {
  return assemble({
    kind: input.kind,
    code: input.code,
    ext: input.ext,
    host: input.host,
    backend: input.backend,
    count: input.count,
    frames: input.frames,
    at,
  })
}

/**
 * Scrub and validate a webview post: it must first pass lane 0's
 * `reportWebviewErrorSchema` (the webview's own failure kinds only, strict,
 * no free-text fields), and its frames are re-verified as package-relative
 * here, since transport bounds alone cannot see an absolute path.
 */
export function buildWebviewFlightRecord(
  input: unknown,
  versions: { readonly ext: string; readonly host: string },
  at: number,
): BuiltFlightRecord {
  const parsed = reportWebviewErrorSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: 'invalid' }
  return assemble({
    kind: parsed.data.kind,
    code: parsed.data.code,
    ext: versions.ext,
    host: versions.host,
    backend: undefined,
    count: undefined,
    frames: parsed.data.frames,
    at,
  })
}

/** One record as its journal line, newline-terminated for crash-safe appends. */
export function serializeFlightRecord(record: FlightRecord): string {
  return `${JSON.stringify(record)}\n`
}

/**
 * A stored record must still look like one the recorder wrote: the fixed
 * code and version vocabularies and verified frame paths. Anything else was
 * tampered with after writing and is skipped, never trusted or exported.
 */
function isStoredRecord(record: FlightRecord): boolean {
  if (!CODE_TOKEN.test(record.code)) return false
  if (!VERSION_TOKEN.test(record.ext) || !VERSION_TOKEN.test(record.host)) return false
  return record.frames.every((frame) => scrubFramePath(frame.path) === frame.path)
}

/**
 * Parse journal text back: every line must parse, match the strict schema and
 * fit the entry cap. Anything else is skipped and counted, never trusted. A
 * file that ends mid-line lost its tail to a crash or reload mid-write: the
 * torn tail is discarded and flagged, while valid earlier records survive.
 */
export function parseJournalText(text: string): ParsedJournal {
  const entries: FlightRecord[] = []
  let skipped = 0
  let body = text
  let torn = false
  if (body !== '' && !body.endsWith('\n')) {
    torn = true
    const cut = body.lastIndexOf('\n')
    body = cut === -1 ? '' : body.slice(0, cut + 1)
  }
  for (const line of body.split('\n')) {
    if (line === '') continue
    let candidate: unknown
    try {
      candidate = JSON.parse(line) as unknown
    } catch {
      skipped += 1
      continue
    }
    const parsed = flightRecordSchema.safeParse(candidate)
    if (
      !parsed.success ||
      Buffer.byteLength(line, 'utf8') > REPORT_JOURNAL_ENTRY_MAX_BYTES ||
      !isStoredRecord(parsed.data)
    ) {
      skipped += 1
      continue
    }
    entries.push(parsed.data)
  }
  return { entries, skipped, torn }
}

/**
 * Prune to the caps, oldest first: drop entries older than the retention age
 * (an entry exactly at the boundary is kept), then the oldest entries while
 * the journal stays past the byte cap. The input is never mutated.
 */
export function pruneFlightEntries(entries: readonly FlightRecord[], now: number): readonly FlightRecord[] {
  const cutoff = now - REPORT_JOURNAL_MAX_AGE_MS
  const fresh = entries.filter((entry) => entry.at >= cutoff)
  const lines = fresh.map((entry) => ({ entry, bytes: Buffer.byteLength(serializeFlightRecord(entry), 'utf8') }))
  let total = 0
  for (const line of lines) total += line.bytes
  let first = 0
  while (first < lines.length && total > REPORT_JOURNAL_MAX_BYTES) {
    const dropped = lines[first]
    if (dropped === undefined) break
    total -= dropped.bytes
    first += 1
  }
  return lines.slice(first).map((line) => line.entry)
}

/** The journal file this instance owns; undefined when the instance is not file-safe. */
export function journalNameFor(instance: string): string | undefined {
  if (!INSTANCE_STEM.test(instance)) return undefined
  return `journal-${instance}.jsonl`
}

/** The instance owning a journal file name; undefined for anything unexpected. */
export function parseJournalName(name: string): string | undefined {
  return JOURNAL_NAME.exec(name)?.[1]
}

/** The marker file this instance owns; undefined when the instance is not file-safe. */
export function markerNameFor(instance: string): string | undefined {
  if (!INSTANCE_STEM.test(instance)) return undefined
  return `marker-${instance}.json`
}

/** The instance owning a marker file name; undefined for anything unexpected. */
export function parseMarkerName(name: string): string | undefined {
  return MARKER_NAME.exec(name)?.[1]
}

/** A crash-left atomic-write stage, safe to sweep at startup. */
export function isTempName(name: string): boolean {
  return TEMP_NAME.test(name)
}

/** The marker this activation sets before normal startup. */
export function buildMarkerText(instance: string, pid: number, at: number): string | undefined {
  if (!INSTANCE_STEM.test(instance)) return undefined
  if (!Number.isInteger(pid) || pid < 0) return undefined
  if (!Number.isInteger(at) || at < 0) return undefined
  return `${JSON.stringify({ v: REPORT_JOURNAL_VERSION, instance, pid, at })}\n`
}

/**
 * Read one marker file: the name must match, the JSON must parse, the strict
 * schema must pass, and the instance inside must equal the instance in the
 * name. Anything else is not a marker and must not produce a crash offer.
 */
export function parseMarkerText(name: string, text: string): FlightMarker | undefined {
  const owned = parseMarkerName(name)
  if (owned === undefined) return undefined
  let candidate: unknown
  try {
    candidate = JSON.parse(text) as unknown
  } catch {
    return undefined
  }
  const parsed = flightMarkerSchema.safeParse(candidate)
  if (!parsed.success || parsed.data.instance !== owned) return undefined
  return parsed.data
}

/**
 * A marker is a crash hint only when it belongs to another instance whose
 * process is gone. A live window's marker — including this window's own —
 * is never a crash, so a second live window is never reported as one.
 */
export function isStaleMarker(marker: FlightMarker, ownInstance: string, isAlive: (pid: number) => boolean): boolean {
  if (marker.instance === ownInstance) return false
  return !isAlive(marker.pid)
}
