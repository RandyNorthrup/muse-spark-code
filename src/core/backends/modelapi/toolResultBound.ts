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
  TOOL_RESULT_MAX_LINE_CHARS,
  TOOL_RESULT_MAX_TOKENS,
  TOOL_RESULT_MIN_BYTES,
  TOOL_RESULT_WINDOW_SHARE,
  UI_TEXT,
} from '../../../shared/constants'
import { Buffer } from 'node:buffer'
import { fill, formatNumber } from '../../../shared/l10n/text'
import type { ContextOverflowKind } from '../../context/overflow'
import type {
  BoundedToolText,
  FunctionCallOutputItem,
  FunctionOutputPart,
  InputItem,
} from './schemas'

/** What was cut, for the notice and the tests. Absent when uncut. */
export interface ToolResultCut {
  readonly totalChars: number
  readonly totalBytes: number
  readonly totalTokens: number
  readonly totalLines: number
  /** Original characters carried in the kept text (the cut's own `…` markers are not original characters). */
  readonly keptChars: number
  readonly keptBytes: number
  /** Whole lines actually kept in the head part (all of them when no middle was cut). */
  readonly headLines: number
  /** Whole lines actually kept in the tail part (0 when no middle was cut). */
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
  /** The kept head and tail, already allowed into a request; the caller appends the notice with `withCutNotice`. */
  readonly text: BoundedToolText
  readonly cut: ToolResultCut | undefined
}

/**
 * Bounded text with its cut notice appended: still allowed into a request.
 * The only string-to-brand construction beside the bound itself and fixed
 * harness words (one mechanism: the brand is produced here or not at all).
 */
export function withCutNotice(bounded: BoundedToolText, notice: string): BoundedToolText {
  // Brand: the kept text already passed the bound; the notice is harness words (PLAN.md §8: TOOLCAP brand).
  return `${bounded}\n${notice}` as BoundedToolText
}

/**
 * Fixed harness words with no tool text in them (a cancellation, a refusal):
 * safe to send as-is. Never a wrapper for tool text: tool text goes through
 * `boundToolResultText`, and a misuse here reads as one at the call site.
 */
export function fixedHarnessText(text: string): BoundedToolText {
  // Brand: the caller names fixed harness words with no tool text; misuse reads as one (PLAN.md §8: TOOLCAP brand).
  return text as BoundedToolText
}

/** A `function_call_output` carrying bounded text: the only way to build one. */
export function callOutputItem(
  callId: string,
  output: BoundedToolText | readonly FunctionOutputPart[],
): FunctionCallOutputItem {
  return { type: 'function_call_output', call_id: callId, output }
}

/** A user message carrying bounded tool text: the only way to note one. */
export function toolNoteItem(text: BoundedToolText): InputItem {
  return { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
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

/**
 * The session's limits for one byte guard (the setting or the exec flag,
 * already validated). The token cap follows the guard at the same
 * characters-per-token estimate the default pairs (64,000 bytes beside
 * 16,000 tokens): raising the guard raises what one result may keep, as the
 * setting promises, instead of leaving the fixed token cap silently in
 * charge. The byte guard and the window share still bind as guarantees.
 */
export function limitsForByteGuard(
  maxBytes: number,
  windowTokens: number | undefined,
): ToolResultLimits {
  return {
    maxTokens: Math.max(TOOL_RESULT_MAX_TOKENS, estimatePackTokens(maxBytes)),
    maxLineChars: TOOL_RESULT_MAX_LINE_CHARS,
    maxBytes,
    windowTokens,
  }
}

const LINE_MARK = '…'
const HALVES = 2
// A code point past the Basic Multilingual Plane starts at `index - 1`.
const LAST_BMP_CODE_POINT = 0xff_ff

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

/** The product's own token estimate for a character count (4 chars per token). */
export function estimatePackTokens(chars: number): number {
  return Math.ceil(chars / OBS_PACK_CHARS_PER_TOKEN)
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
 * `windowTokens` is the model's WHOLE window, never the room left: the
 * refusal sentence names the model's window, and a cap that fits it must
 * not be refused later merely because the conversation grew.
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

/**
 * The one line a cut result carries; the spill holds the full text. When
 * the spill could not be written (`spill` undefined) the line says so
 * instead of naming a file that does not exist.
 */
export function cutNotice(cut: ToolResultCut, spill: string | undefined, id: string): string {
  return fill(
    spill === undefined
      ? MODEL_API_MODEL_TEXT.toolResultCutNoSpill
      : MODEL_API_MODEL_TEXT.toolResultCut,
    {
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
      spill: spill ?? '',
    },
  )
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
    // Brand: the bound measured this text under every cap, so it may enter a request (PLAN.md §8: TOOLCAP brand).
    return { text: text as BoundedToolText, cut: undefined }
  }
  let capped = lines
  let wasLineCut = false
  // Offsets of the markers this cut adds, in the line-capped joined text:
  // `keptChars` counts original characters, and a marker is not one (an
  // original `…` in the text is counted, because only these offsets are).
  const markerOffsets: number[] = []
  if (longestLine > limits.maxLineChars) {
    wasLineCut = true
    const keep = Math.max(limits.maxLineChars - LINE_MARK.length, 0)
    const head = Math.ceil(keep / HALVES)
    const tail = Math.floor(keep / HALVES)
    let lineStart = 0
    capped = lines.map((line) => {
      if (line.length <= limits.maxLineChars) {
        lineStart += line.length + 1
        return line
      }
      const headEnd = boundary(line, head)
      markerOffsets.push(lineStart + headEnd)
      const cutLine = `${line.slice(0, headEnd)}${LINE_MARK}${line.slice(boundary(line, line.length - tail))}`
      lineStart += cutLine.length + 1
      return cutLine
    })
  }
  let joined = capped.join('\n')
  let headLines: number
  let tailLines: number
  let keptMarkers: number
  if (joined.length > estimateCapChars || utf8Length(joined) > hardCapBytes) {
    // The most kept characters that fit BOTH the estimate and the byte
    // guarantee (binary search: byte length falls as kept characters fall).
    const fit = (
      kept: number,
    ): {
      readonly head: string
      readonly tail: string
      readonly headEnd: number
      readonly tailStart: number
    } => {
      const headEnd = boundary(joined, Math.ceil(kept / HALVES))
      const tailStart = boundary(joined, joined.length - Math.floor(kept / HALVES))
      return { head: joined.slice(0, headEnd), tail: joined.slice(tailStart), headEnd, tailStart }
    }
    // The kept head and tail are joined by the same marker a line cut
    // uses, so two fragments never read as one continuous line the tool
    // never printed; its bytes count against the guarantee like any kept
    // character's.
    const spliceBytes = (parts: { readonly head: string; readonly tail: string }): number =>
      parts.head === '' || parts.tail === '' ? 0 : utf8Length(LINE_MARK)
    let low = 0
    let high = Math.min(estimateCapChars, joined.length)
    while (low < high) {
      const mid = Math.ceil((low + high) / HALVES)
      const parts = fit(mid)
      if (utf8Length(parts.head) + spliceBytes(parts) + utf8Length(parts.tail) <= hardCapBytes) {
        low = mid
      } else high = mid - 1
    }
    const parts = fit(low)
    const isSpliced = parts.head !== '' && parts.tail !== ''
    // Whole lines only: a fragment the cut made inside a line is not a kept
    // line, so the two counts can never claim more lines than there were.
    headLines =
      parts.head === ''
        ? 0
        : parts.head.split('\n').length -
          (parts.headEnd >= joined.length || joined[parts.headEnd] === '\n' ? 0 : 1)
    tailLines =
      parts.tail === ''
        ? 0
        : parts.tail.split('\n').length -
          (parts.tailStart === 0 || joined[parts.tailStart - 1] === '\n' ? 0 : 1)
    keptMarkers =
      markerOffsets.filter((offset) => offset < parts.headEnd || offset >= parts.tailStart).length +
      (isSpliced ? 1 : 0)
    joined = isSpliced ? `${parts.head}${LINE_MARK}${parts.tail}` : `${parts.head}${parts.tail}`
  } else {
    // Lines were cut but no middle was: every line is kept, shortened.
    headLines = splitLines(joined).length
    tailLines = 0
    keptMarkers = markerOffsets.length
  }
  const keptBytes = utf8Length(joined)
  const keptChars = joined.length - keptMarkers
  return {
    // Brand: the cut kept at most the estimate characters and at most the guaranteed bytes (PLAN.md §8: TOOLCAP brand).
    text: joined as BoundedToolText,
    cut: {
      totalChars,
      totalBytes,
      totalTokens: estimatePackTokens(totalChars),
      totalLines: lines.length,
      keptChars,
      keptBytes,
      headLines,
      tailLines,
      omittedChars: totalChars - keptChars,
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

/**
 * Whether a classified overflow may drive the trim-and-resend recovery.
 * Count-based kinds (preflight, input-above-window, empty-near-window) rest
 * on usage counts, not phrases. The phrase-based `error` kind recovers only
 * on the proven shape — the recorded `prompt is too long: N tokens >
 * M maximum` answer, with its numbers — so an unrecorded wire shape never
 * triggers a resend: the turn ends with the short sentence instead, until an
 * answer is recorded for its format. (TOOLCAP needs `ProviderRefusal`'s
 * `tooLarge` kind with the wire's own numbers when it lands; until then this
 * gate is the provenance record.)
 */
export function canRecoverOverflow(
  kind: ContextOverflowKind,
  tokens: number | undefined,
  maximum: number | undefined,
): boolean {
  return kind !== 'error' || (tokens !== undefined && maximum !== undefined)
}
