// TOOLCAP: the one bound every tool result passes through on its way into
// the conversation. `boundToolResultText` enforces, in order: a cap per line
// (the measured failure was megabyte lines, not line count), a cap per
// result, and a cap relative to what is left of the model's window (a result
// may never take more than TOOL_RESULT_WINDOW_SHARE of the remaining room).
// Two of these numbers are estimates and one is a guarantee, and the code
// keeps them apart: the per-result cap is measured in characters at the
// product's own 4-characters-per-token rule (friendlier, but text denser
// than the estimate — hex, base64, minified JSON, CJK — carries more tokens
// per character), while the window share is measured in UTF-8 BYTES against
// tokens (a token is at least one byte, so a result of at most N bytes is at
// most N tokens: a true upper bound). A result under every cap returns
// byte-identical: no notice, no spill. A cut result's text ends with
// `cutNotice`, one line naming how much there was, which head and tail it
// kept with the omitted middle counted, the longest line when lines were
// cut, and the spill file holding the full text. Pure: the caller writes
// the spill file.
import {
  MODEL_API_MODEL_TEXT,
  OBS_PACK_CHARS_PER_TOKEN,
  TOOL_RESULT_MIN_BYTES,
  TOOL_RESULT_WINDOW_SHARE,
  UI_TEXT,
} from '../../../shared/constants'
import { Buffer } from 'node:buffer'
import { fill, formatNumber } from '../../../shared/l10n/text'
import { estimatePackTokens } from './observationPack'

/** What was cut, for the notice and the tests. Absent when uncut. */
export interface ToolResultCut {
  readonly totalChars: number
  readonly totalBytes: number
  readonly totalTokens: number
  readonly totalLines: number
  readonly keptChars: number
  readonly keptBytes: number
  /** Lines actually kept in the head part (all of them when no middle was cut). */
  readonly headLines: number
  /** Lines actually kept in the tail part (0 when no middle was cut). */
  readonly tailLines: number
  /**
   * Original characters not carried in the kept text: exactly
   * `totalChars - keptChars`, net of the line-cut markers, so the kept and
   * the omitted always add up to the total.
   */
  readonly omittedChars: number
  /** The longest original line; 0 when no line was cut. */
  readonly longestLine: number
  readonly lineCap: number
}

export interface BoundToolResult {
  /** The kept head and tail; the caller appends `cutNotice(cut, spill)`. */
  readonly text: string
  readonly cut: ToolResultCut | undefined
}

export interface ToolResultLimits {
  /** Per-result cap in estimated tokens (the provider's unit). */
  readonly maxTokens: number
  /** Per-line cap in characters. */
  readonly maxLineChars: number
  /** Cheap byte guard; applied as a character cap for mostly-text output. */
  readonly maxBytes: number
  /** Room left in the model's window in tokens; unknown skips the share. */
  readonly windowTokens: number | undefined
}

const LINE_MARK = '…'
const HALVES = 2
// A code point past the Basic Multilingual Plane starts at `index - 1`.
const LAST_BMP_CODE_POINT = 0xff_ff
const SPILL_NAME_MAX = 80

/** `index` moved back off a split surrogate pair, as the shell clip does. */
function boundary(text: string, index: number): number {
  return (text.codePointAt(index - 1) ?? 0) > LAST_BMP_CODE_POINT ? index - 1 : index
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/** The length of a text in UTF-8 bytes (a token is at least one byte). */
export function utf8Length(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/**
 * The result's guaranteed share of the remaining window, in BYTES against
 * tokens: a result of at most this many bytes is at most this many tokens,
 * whatever the text's density. This is the bound's true upper bound; the
 * per-result character cap beside it is only the friendlier estimate.
 */
export function windowShareBytes(windowTokens: number): number {
  return Math.max(0, Math.floor(windowTokens * TOOL_RESULT_WINDOW_SHARE))
}

/** Why a configured byte guard cannot be honoured; the caller says it. */
export type ToolResultCapRefusal =
  | { readonly kind: 'below-floor' }
  | { readonly kind: 'above-window'; readonly windowTokens: number }

/**
 * The configured byte guard, validated. Unknown or absent keeps the default
 * (today's behaviour); below the floor or larger than the model's whole
 * window is refused with the reason, and the caller falls back to the
 * default. Pure so the setting, the exec flag and the host share it. Where
 * the window is unknown the window fit cannot be checked, so the bound is
 * then the per-result caps alone — said in the certification, not guessed.
 */
export function validateToolResultCap(
  value: number | undefined,
  windowTokens: number | undefined,
  fallbackBytes: number,
):
  | { readonly bytes: number }
  | { readonly refused: ToolResultCapRefusal; readonly fallback: number } {
  if (value === undefined) return { bytes: fallbackBytes }
  if (!Number.isSafeInteger(value) || value < TOOL_RESULT_MIN_BYTES) {
    return { refused: { kind: 'below-floor' }, fallback: fallbackBytes }
  }
  return windowTokens !== undefined &&
    Number.isSafeInteger(windowTokens) &&
    windowTokens > 0 &&
    value > windowTokens * OBS_PACK_CHARS_PER_TOKEN
    ? { refused: { kind: 'above-window', windowTokens }, fallback: fallbackBytes }
    : { bytes: value }
}

/** The refusal reason the person reads, each kind its own translated sentence. */
export function capRefusalReason(refused: ToolResultCapRefusal): string {
  return refused.kind === 'below-floor'
    ? fill(UI_TEXT.toolResultCapBelowFloor, { floor: formatNumber(TOOL_RESULT_MIN_BYTES) })
    : fill(UI_TEXT.toolResultCapAboveWindow, { window: formatNumber(refused.windowTokens) })
}

/** The one line a cut result carries; the spill holds the full text. */
export function cutNotice(cut: ToolResultCut, spill: string, id: string): string {
  return fill(MODEL_API_MODEL_TEXT.toolResultCut, {
    id,
    totalChars: String(cut.totalChars),
    totalTokens: String(cut.totalTokens),
    totalLines: String(cut.totalLines),
    keptChars: String(cut.keptChars),
    headLines: String(cut.headLines),
    tailLines: String(cut.tailLines),
    omittedChars: String(cut.omittedChars),
    longest:
      cut.longestLine > 0
        ? fill(MODEL_API_MODEL_TEXT.toolResultCutLongest, {
            longestLine: String(cut.longestLine),
            lineCap: String(cut.lineCap),
          })
        : '',
    spill,
  })
}

/** One spill path segment: safe on every platform, bounded in length. */
function spillSafePart(part: string): string {
  return part.replaceAll(/[^A-Za-z0-9_-]/g, '_').slice(0, SPILL_NAME_MAX) || 'output'
}

/** `TOOL_RESULT_SPILL_DIR`-relative spill path; safe on every platform. */
export function spillName(sessionId: string, callId: string): string {
  return `${spillSafePart(sessionId)}-${spillSafePart(callId)}.txt`
}

export function boundToolResultText(text: string, limits: ToolResultLimits): BoundToolResult {
  const totalChars = text.length
  const totalBytes = utf8Length(text)
  const lines = splitLines(text)
  let longestLine = 0
  for (const line of lines) longestLine = Math.max(longestLine, line.length)
  // The friendlier estimate: the per-result token cap in characters.
  const estimateCapChars = limits.maxTokens * OBS_PACK_CHARS_PER_TOKEN
  // The true upper bound: the configured byte guard, and the window's share
  // in bytes against tokens. A kept text within it is within its tokens.
  const hardCapBytes = Math.min(
    limits.maxBytes,
    limits.windowTokens === undefined
      ? Number.MAX_SAFE_INTEGER
      : windowShareBytes(limits.windowTokens),
  )
  if (
    longestLine <= limits.maxLineChars &&
    totalChars <= estimateCapChars &&
    totalBytes <= hardCapBytes
  ) {
    return { text, cut: undefined }
  }
  let capped = lines
  let wasLineCut = false
  if (longestLine > limits.maxLineChars) {
    wasLineCut = true
    const keep = Math.max(limits.maxLineChars - LINE_MARK.length, 0)
    const head = Math.ceil(keep / HALVES)
    const tail = Math.floor(keep / HALVES)
    capped = lines.map((line) => {
      return line.length <= limits.maxLineChars
        ? line
        : `${line.slice(0, boundary(line, head))}${LINE_MARK}${line.slice(boundary(line, line.length - tail))}`
    })
  }
  let joined = capped.join('\n')
  let headLines: number
  let tailLines: number
  if (joined.length > estimateCapChars || utf8Length(joined) > hardCapBytes) {
    // The most kept characters that fit BOTH the estimate and the byte
    // guarantee (binary search: byte length falls as kept characters fall).
    const fit = (kept: number): { readonly head: string; readonly tail: string } => ({
      head: joined.slice(0, boundary(joined, Math.ceil(kept / HALVES))),
      tail: joined.slice(boundary(joined, joined.length - Math.floor(kept / HALVES))),
    })
    let low = 0
    let high = Math.min(estimateCapChars, joined.length)
    while (low < high) {
      const mid = Math.ceil((low + high) / HALVES)
      const parts = fit(mid)
      if (utf8Length(parts.head) + utf8Length(parts.tail) <= hardCapBytes) low = mid
      else high = mid - 1
    }
    const parts = fit(low)
    headLines = parts.head === '' ? 0 : splitLines(parts.head).length
    tailLines = parts.tail === '' ? 0 : splitLines(parts.tail).length
    joined = `${parts.head}${parts.tail}`
  } else {
    // Lines were cut but no middle was: every line is kept, shortened.
    headLines = splitLines(joined).length
    tailLines = 0
  }
  const keptBytes = utf8Length(joined)
  return {
    text: joined,
    cut: {
      totalChars,
      totalBytes,
      totalTokens: estimatePackTokens(totalChars),
      totalLines: lines.length,
      keptChars: joined.length,
      keptBytes,
      headLines,
      tailLines,
      omittedChars: totalChars - joined.length,
      longestLine: wasLineCut ? longestLine : 0,
      lineCap: limits.maxLineChars,
    },
  }
}

/** Anthropic's exact refusal, typed: `prompt is too long: N tokens > M maximum`. */
const PROMPT_TOO_LONG_NUMBERS = /prompt is too long:\s*(\d+)\s*tokens?\s*>\s*(\d+)\s*maximum/i

export interface PromptTooLong {
  readonly tokens: number
  readonly maximum: number
}

export function parsePromptTooLong(message: string): PromptTooLong | undefined {
  const match = PROMPT_TOO_LONG_NUMBERS.exec(message)
  if (match?.[1] === undefined || match[2] === undefined) return undefined
  const tokens = Number(match[1])
  const maximum = Number(match[2])
  return Number.isSafeInteger(tokens) && Number.isSafeInteger(maximum)
    ? { tokens, maximum }
    : undefined
}
