// The Model API backend's byte-range file execution: reads and edits of
// one byte window at any file size. dist/modelApi.js loads this through
// dist/modelApiFileRange.js on the first range addressed call; the
// whole-file paths never load it. A bundle that cannot load refuses the
// call that needed it, never a silent fallback.

import { Buffer } from 'node:buffer'
import {
  MODEL_API_MODEL_TEXT,
  MODEL_TEXT,
  TOOL_FILE_RANGE_MAX_BYTES,
  TOOL_OUTPUT_MAX_CHARS,
} from '../../../shared/constants'
import type { FormatTarget, ToolContext, ToolOutcome, TouchedFiles } from './tools'
import {
  editRefusal,
  failure,
  fileText,
  locateHead,
  modelText,
  patchOutcome,
  type PathRefuser,
  resolveEditRanges,
  type TextShape,
  touchedBy,
  writeAdmission,
} from '../../toolEdit'

/** A byte window into a file: `offset` first, at most `length` bytes. */
export interface FileByteRange {
  readonly offset: number
  readonly length: number
}

/** A byte window read, with what reading and editing by range needs. */
export interface FileRangeRead {
  /** Actual aligned first byte, when the adapter completed a split character. */
  readonly offset?: number
  /** The window's bytes, possibly short at the end of the file. */
  readonly bytes: Uint8Array
  /** The file's size in bytes. */
  readonly size: number
  /** The file's mtime in milliseconds, for the edit's staleness check. */
  readonly mtimeMs: number
  /**
  Hex digest of the returned window's bytes (not the file): with the size
  and mtime it names the window the model saw, so a range edit refuses a
  window that moved. Older adapters may not supply it, and then no range
  edit can prove freshness.
  */
  readonly fingerprint?: string
  /** Whether the file starts with a UTF-8 byte-order mark (true only when the window covers byte 0). */
  readonly hasBom: boolean
  /** Whether every line break in this window is a CRLF. */
  readonly isCrlf: boolean
}

/**
The `seen` identity a range read records and a range edit requires: the
window's bytes, size and mtime as the model saw them. The model must have
read (about) this window: a whole-file read's digest does not satisfy it,
nor does another window's.
*/
export function rangeSeenIdentity(window: FileRangeRead): string | undefined {
  return window.fingerprint === undefined
    ? undefined
    : `w:${String(window.size)}:${String(window.mtimeMs)}:${window.fingerprint}`
}

/**
What a byte-range splice did: `written` with the file's new size and
mtime (for the edit's post-edit identity, without re-reading), or
`changed` when the file no longer held the expected size and mtime and
nothing was written.
*/
export type SpliceFileOutcome =
  | { readonly status: 'written'; readonly size: number; readonly mtimeMs: number }
  | { readonly status: 'changed' }

/** A path the caller already confined, as a range call receives it. */
export interface LocatedHead {
  readonly relative: string
  readonly canonical: string
  readonly absolute: string
  readonly checkedAbsolute: string
}

/** The addressing a range call parses: byte offset and length only. */
export interface FileRangeArgs {
  readonly byteOffset?: number | undefined
  readonly byteLength?: number | undefined
}

const UTF8_CONTINUATION_MASK = 0xc0
const UTF8_CONTINUATION_BITS = 0x80
const UTF8_ASCII_MAX = 0x80
const UTF8_LEAD_2_MIN = 0xc0
const UTF8_TWO_BYTE_MAX = 0xe0
const UTF8_THREE_BYTE_MAX = 0xf0
const UTF8_FOUR_BYTE_MAX = 0xf8
const UTF8_NUL = 0

function isContinuationByte(byte: number | undefined): boolean {
  return byte !== undefined && (byte & UTF8_CONTINUATION_MASK) === UTF8_CONTINUATION_BITS
}

const UTF8_THREE_BYTE_LENGTH = 3
const UTF8_FOUR_BYTE_LENGTH = 4

/**
The offset and length a range read and a range edit parse from the same
arguments, under the same range cap. `verb` finishes the over-cap note
for the caller's direction.
*/
function windowRange(
  args: FileRangeArgs,
  verb: string,
): { readonly offset: number; readonly length: number } | { readonly refusal: ToolOutcome } {
  const offset = Math.max(Math.floor(args.byteOffset ?? 0), 0)
  const length = args.byteLength === undefined ? TOOL_OUTPUT_MAX_CHARS : Math.floor(args.byteLength)
  if (!(length > 0)) {
    return { refusal: failure('byteLength is a positive number of bytes') }
  }
  if (length > TOOL_FILE_RANGE_MAX_BYTES) {
    return {
      refusal: failure(
        `byteLength holds at most ${String(TOOL_FILE_RANGE_MAX_BYTES)} bytes; ${verb}`,
      ),
    }
  }
  return { offset, length }
}

/** The size a range read and a range edit share, or the not-found refusal. */
function windowSize(
  relative: string,
  size: number | undefined,
): { readonly size: number } | { readonly refusal: ToolOutcome } {
  return size === undefined ? { refusal: failure(`file not found: ${relative}`) } : { size }
}

/**
The addressed window a range read and a range edit share: parsed arguments
plus the file's size, or the first refusal.
*/
async function windowAddress(
  args: FileRangeArgs,
  verb: string,
  relative: string,
  checkedAbsolute: string,
  fileSize:
    | ((absolutePath: string, expectedCanonicalPath: string) => Promise<number | undefined>)
    | undefined,
): Promise<
  | { readonly offset: number; readonly length: number; readonly size: number }
  | { readonly refusal: ToolOutcome }
> {
  const range = windowRange(args, verb)
  if ('refusal' in range) {
    return range
  }
  const sized = windowSize(relative, await fileSize?.(checkedAbsolute, checkedAbsolute))
  return 'refusal' in sized ? sized : { ...range, ...sized }
}

function windowedLength(relative: string, offset: number, length: number, size: number): number {
  const longestHeader = `Read text file \`${relative}\` (bytes ${String(offset)}–${String(size)} of ${String(size)}):\n`
  const longestNote = `\n[bytes ${String(offset)}–${String(size)} of ${String(size)}; call read_file again with byteOffset ${String(size)} for the rest]`
  const payload =
    TOOL_OUTPUT_MAX_CHARS - longestHeader.length - longestNote.length - UTF8_FOUR_BYTE_LENGTH
  return Math.min(length, size - offset, Math.max(payload, 1))
}

/** Expected UTF-8 sequence length for a lead byte; 0 when it leads nothing. */
function utf8SequenceLength(lead: number): number {
  if (lead < UTF8_ASCII_MAX) return 1
  if (lead < UTF8_LEAD_2_MIN) return 0
  if (lead < UTF8_TWO_BYTE_MAX) return 2
  if (lead < UTF8_THREE_BYTE_MAX) return UTF8_THREE_BYTE_LENGTH
  return lead < UTF8_FOUR_BYTE_MAX ? UTF8_FOUR_BYTE_LENGTH : 0
}

/**
The byte window as the model reads it. Partial UTF-8 sequences at the
edges are left out, so the slice always decodes; an interior NUL or
invalid sequence refuses like a whole read (D27). Returns undefined for
bytes no text window can show.
*/
export function decodeWindow(bytes: Uint8Array, start: number, end: number): string | undefined {
  let from = Math.max(start, 0)
  const to = Math.min(end, bytes.length)
  while (from < to && isContinuationByte(bytes[from])) {
    from += 1
  }
  let trimmed = to
  let following = 0
  while (trimmed > from && isContinuationByte(bytes[trimmed - 1])) {
    trimmed -= 1
    following += 1
  }
  if (trimmed > from) {
    const lead = bytes[trimmed - 1]
    // A complete trailing sequence stays whole; a partial one is left out.
    trimmed = lead === undefined || following + 1 < utf8SequenceLength(lead) ? trimmed - 1 : to
  }
  const slice = bytes.slice(from, trimmed)
  if (slice.includes(UTF8_NUL)) {
    return undefined
  }
  try {
    // The BOM is kept as a character, exactly as whole reads decode (D27):
    // the display strips it, the digest covers it.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(slice)
  } catch (error: unknown) {
    // A fatal decode throws only TypeError for a malformed sequence (the
    // encoding and options above are constants): the window is not valid
    // UTF-8, so there is no text to show for it.
    if (!(error instanceof TypeError)) throw error
    return undefined
  }
}

/**
One byte window of a text file of any size. The model never sees more
than the window; the note names the bytes shown, the total, and the
offset that fetches the rest. The caller confines the path first, so this
runs without loading anything else.
*/
export async function readFileWindow(
  head: LocatedHead,
  args: FileRangeArgs,
  context: ToolContext,
): Promise<ToolOutcome> {
  if (context.io.fileSize === undefined || context.io.readFileRange === undefined) {
    return failure(
      `${head.relative} needs byte addressing, which this host does not offer; read it whole instead`,
    )
  }
  const address = await windowAddress(
    args,
    'read the file window by window',
    head.relative,
    head.checkedAbsolute,
    context.io.fileSize,
  )
  if ('refusal' in address) {
    return address.refusal
  }
  const { offset, length, size } = address
  if (size === 0) {
    const empty = `Read text file \`${head.relative}\` (0 bytes): the file is empty.`
    return { output: empty, visibleOutput: empty }
  }
  if (offset >= size) {
    return failure(
      `byteOffset ${String(offset)} is past the end of \`${head.relative}\` (${String(size)} bytes); use an offset from 0 to ${String(size - 1)}`,
    )
  }
  // Reserve the complete header/note and UTF-8 edge before reading. Never
  // advertise bytes discarded later by a character-budget clip as delivered.
  // The edit clamps the same way, so the advertised range is its range.
  const window = await context.io.readFileRange(
    head.checkedAbsolute,
    head.checkedAbsolute,
    { offset, length: windowedLength(head.relative, offset, length, size) },
    context.signal,
  )
  if (window === undefined) {
    return failure(`file not found: ${head.relative}`)
  }
  const identity = rangeSeenIdentity(window)
  if (identity !== undefined) {
    context.provisionalSeen.set(head.absolute, identity)
  }
  const text = decodeWindow(window.bytes, 0, window.bytes.length)
  if (text === undefined) {
    throw new Error(`${head.checkedAbsolute} ${MODEL_TEXT.fileNotText}`)
  }
  const shown = modelText(text, {
    hasBom: window.hasBom && (window.offset ?? offset) === 0,
    isCrlf: window.isCrlf,
    hasTrailingBreak: text.endsWith('\n'),
  })
  const first = window.offset ?? offset
  const last = first + window.bytes.length
  const header = `Read text file \`${head.relative}\` (bytes ${String(first)}–${String(last)} of ${String(window.size)}):`
  const note =
    last < window.size
      ? `[bytes ${String(first)}–${String(last)} of ${String(window.size)}; call read_file again with byteOffset ${String(last)} for the rest]`
      : `[bytes ${String(first)}–${String(last)} of ${String(window.size)}; end of file]`
  const body = `${header}\n${shown}\n${note}`
  const touched: TouchedFiles = { names: [head.relative, head.canonical], complete: false }
  return { output: body, visibleOutput: body, touched }
}

/**
An edit scoped to the byte window the model read, at any file size: only
the window is read and decoded, and the rest of the file streams
untouched through a temporary file into place. No invented whole-file
cap: memory stays flat (the window plus one 64 KiB copy chunk); what the
OS itself refuses (permissions, a full disk) throws, naming the cause.
The model must have read (about) this window: a whole-file read's digest
does not satisfy it, nor does another window's.
*/
export async function editFileRange(
  head: LocatedHead,
  args: FileRangeArgs,
  singles: readonly { readonly find: string; readonly replace: string }[],
  hasEdits: boolean,
  context: ToolContext,
): Promise<ToolOutcome> {
  const refusal = editRefusal(head, context)
  if (refusal !== undefined) {
    return refusal
  }
  if (
    context.io.fileSize === undefined ||
    context.io.readFileRange === undefined ||
    context.io.spliceFileRange === undefined
  ) {
    return failure(
      `${head.relative} needs byte addressing, which this host does not offer; edit it whole instead`,
    )
  }
  const address = await windowAddress(
    args,
    'edit window by window',
    head.relative,
    head.checkedAbsolute,
    context.io.fileSize,
  )
  if ('refusal' in address) {
    return address.refusal
  }
  const { offset, length, size } = address
  if (size > 0 && offset >= size) {
    return failure(
      `byteOffset ${String(offset)} is past the end of \`${head.relative}\` (${String(size)} bytes); use an offset from 0 to ${String(size - 1)}`,
    )
  }
  // The same clamp the read applies, so the same arguments address the
  // same window the model was shown.
  const clamped = windowedLength(head.relative, offset, length, size)
  const window = await context.io.readFileRange(
    head.checkedAbsolute,
    head.checkedAbsolute,
    { offset, length: clamped },
    context.signal,
  )
  if (window === undefined) {
    return failure(`file not found: ${head.relative}`)
  }
  const first = window.offset ?? offset
  const seen = rangeSeenIdentity(window)
  if (seen === undefined || context.seen.get(head.absolute) !== seen) {
    return failure(
      `${head.relative} ${MODEL_API_MODEL_TEXT.fileChangedSinceRead}: read the byte window with read_file first, then edit_file with the same byteOffset and byteLength`,
    )
  }
  const text = decodeWindow(window.bytes, 0, window.bytes.length)
  if (text === undefined) {
    throw new Error(`${head.checkedAbsolute} ${MODEL_TEXT.fileNotText}`)
  }
  const shape: TextShape = {
    hasBom: window.hasBom && first === 0,
    isCrlf: window.isCrlf,
    hasTrailingBreak: text.endsWith('\n'),
  }
  const current = modelText(text, shape)
  // Compare actual byte boundaries, not the length of separately decoded
  // prefixes: a split UTF-8 character or CRLF is not an editable character.
  // Offsets are file bytes (a leading BOM counts), matching the window the
  // read advertised.
  const byteAt = (index: number): number =>
    Buffer.byteLength(fileText(current.slice(0, index), shape), 'utf8')
  // Window-scoped misses: only this window was searched, so the note names
  // it. A match elsewhere is reached by reading its window, never by
  // widening this one past its cap.
  const scope = `bytes ${String(offset)}–${String(offset + clamped)} of \`${head.relative}\``
  // Every single resolved against the window text first (M101): overlaps
  // are refused and one splice applies all of them, so either all land or
  // none does. A miss or repeat names this window; a match elsewhere is
  // reached by reading its window, never by widening this one past its cap.
  const resolved = await resolveEditRanges(
    current,
    shape,
    singles,
    hasEdits,
    context.signal,
    (prefix, isRepeated) =>
      isRepeated
        ? failure(
            `${prefix}find text occurs more than once in ${scope}; include more context`,
            `${prefix}Find text occurs more than once in this window; include more context.`,
          )
        : failure(
            `${prefix}find text not found in ${scope}; read the window that holds it and pass that range`,
            `${prefix}Find text was not found in this window; read the window that holds it and pass that range.`,
          ),
    MODEL_API_MODEL_TEXT.editOverlap,
  )
  if (!resolved.ok) return resolved.outcome
  const ordered = resolved.ranges
  for (const [index, range] of ordered.entries()) {
    if (byteAt(range.start) < offset - first || byteAt(range.end) > offset - first + clamped) {
      return failure(
        `edits[${String(index)}]: matched outside the read window (bytes ${String(offset)}–${String(offset + clamped)} of \`${head.relative}\`); read the window that holds it and pass that range`,
        `edits[${String(index)}]: matched outside the read window; read the window that holds it and pass that range`,
      )
    }
  }
  const firstMatch = ordered.at(0)
  const lastMatch = ordered.at(-1)
  if (firstMatch === undefined || lastMatch === undefined) {
    return failure(
      `${head.relative} ${MODEL_API_MODEL_TEXT.fileChangedSinceRead}: read the byte window with read_file first, then edit_file with the same byteOffset and byteLength`,
    )
  }
  const updated = applyOrdered(current, ordered)
  // A range edit skips format on edit (M68): a formatter reads a whole
  // file, never a window, so running one over the slice would corrupt it.
  // Absolute file bytes of the matched span: only this span is replaced.
  // The span's new text is re-encoded on its own (never the whole window):
  // gaps between matches re-encode byte-identical by construction, and a
  // leading BOM is outside every span, so it is never re-encoded either.
  const spanStart = first + byteAt(firstMatch.start)
  const spanEnd = first + byteAt(lastMatch.end)
  const newSpanText = updated.slice(
    firstMatch.start,
    lastMatch.end + (updated.length - current.length),
  )
  const replacement = Buffer.from(fileText(newSpanText, { ...shape, hasBom: false }), 'utf8')
  const target: FormatTarget = {
    absolute: head.absolute,
    checkedAbsolute: head.checkedAbsolute,
    relative: head.relative,
    canonical: head.canonical,
  }
  const spliced = await context.io.spliceFileRange(
    head.checkedAbsolute,
    head.checkedAbsolute,
    { size: window.size, mtimeMs: window.mtimeMs },
    spanStart,
    spanEnd,
    replacement,
    {
      unsavedAt: [head.absolute, head.checkedAbsolute],
      assertCanWrite: writeAdmission(target, context),
    },
    context.signal,
  )
  if (spliced.status === 'changed') {
    return failure(`${head.relative} ${MODEL_API_MODEL_TEXT.fileChangedSinceRead}`)
  }
  context.signal?.throwIfAborted()
  // The post-edit window identity, from a fresh read of the same range: a
  // length-changing edit shifts every later byte, so only a re-read names
  // the window a further edit must match. Recorded only while the file
  // still holds what the splice wrote (a concurrent change in between
  // leaves nothing to prove fresh with); the read itself is one window.
  const reread = await context.io.readFileRange(
    head.checkedAbsolute,
    head.checkedAbsolute,
    { offset, length: clamped },
    context.signal,
  )
  const identity = reread === undefined ? undefined : rangeSeenIdentity(reread)
  if (
    reread !== undefined &&
    identity !== undefined &&
    reread.size === spliced.size &&
    reread.mtimeMs === spliced.mtimeMs
  ) {
    context.provisionalSeen.set(head.absolute, identity)
  }
  return {
    ...patchOutcome(
      head.relative,
      current,
      updated,
      hasEdits
        ? `edited ${head.relative} (${String(singles.length)} edits, bytes ${String(offset)}–${String(offset + clamped)})`
        : `edited ${head.relative} (bytes ${String(offset)}–${String(offset + clamped)})`,
      hasEdits
        ? `edited ${head.relative} (${String(singles.length)} edits, bytes ${String(offset)}–${String(offset + clamped)})`
        : `edited ${head.relative} (bytes ${String(offset)}–${String(offset + clamped)})`,
    ),
    touched: touchedBy(head),
  }
}

/**
Every matched entry applied to the original text in order, so either all
land or none does (M101).
*/
function applyOrdered(
  current: string,
  ordered: readonly { readonly start: number; readonly end: number; readonly replace: string }[],
): string {
  let updated = ''
  let at = 0
  for (const range of ordered) {
    updated += `${current.slice(at, range.start)}${range.replace}`
    at = range.end
  }
  return updated + current.slice(at)
}

/** A range `read_file` call: byte addressing only, confined before anything reads. */
export async function readFileByRange(
  args: FileRangeArgs & {
    readonly path: string
    readonly offset?: number | undefined
    readonly limit?: number | undefined
  },
  context: ToolContext,
  refuse?: PathRefuser,
): Promise<ToolOutcome> {
  if (args.offset !== undefined || args.limit !== undefined) {
    return failure(
      'read_file takes either line addressing (offset and limit) or byte addressing (byteOffset and byteLength), not both',
    )
  }
  // The path is confined first, exactly as the inline version did.
  const head = await locateHead(args.path, context, MODEL_API_MODEL_TEXT.pathDeniedByPolicy, refuse)
  return head.ok ? await readFileWindow(head, args, context) : head.outcome
}

/** A range `edit_file` call: validated singles applied to the confined window. */
export async function editFileByRange(
  args: FileRangeArgs & { readonly path: string },
  singles: readonly { readonly find: string; readonly replace: string }[],
  hasEdits: boolean,
  context: ToolContext,
  refuse?: PathRefuser,
): Promise<ToolOutcome> {
  // The path is confined first, exactly as the inline version did.
  const head = await locateHead(args.path, context, MODEL_API_MODEL_TEXT.pathDeniedByPolicy, refuse)
  return head.ok ? await editFileRange(head, args, singles, hasEdits, context) : head.outcome
}
