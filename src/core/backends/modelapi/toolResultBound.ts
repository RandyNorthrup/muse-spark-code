// TOOLCAP: the one bound every tool result passes through on its way into
// the conversation. D121: no trimming of ours — no per-result token cap, no
// per-line cap, no fallback byte guard. `boundToolResultText` enforces, in
// order: a cap the person set, and a cap relative to what is left of the
// model's window (a result may never take more than TOOL_RESULT_WINDOW_SHARE
// of the remaining room). The window share is measured in UTF-8 BYTES
// against tokens (a token is at least one byte, so a result of at most N
// bytes is at most N tokens: a true upper bound). A result under every cap
// returns byte-identical: no notice, no spill. A cut result's text ends with
// `cutNotice`, one line naming how much there was, which head and tail it
// kept with the omitted middle counted, and the spill file holding the full
// text. Pure: the caller writes the spill file.
import {
  MODEL_API_MODEL_TEXT,
  OBS_PACK_CHARS_PER_TOKEN,
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
   * `totalChars - keptChars`, net of the cut marker, so the kept and
   * the omitted always add up to the total.
   */
  readonly omittedChars: number
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
  /** A byte guard the person set, or no bound. */
  readonly maxBytes: number
  /** Room left in the model's window in tokens; unknown skips the share, never guessed. */
  readonly windowTokens: number | undefined
}

/**
 * The session's limits for one byte guard (the setting or the exec flag,
 * already validated). D121: no trimming of ours — the person's guard and
 * the model's window share are the only bounds.
 */
export function limitsForByteGuard(
  maxBytes: number,
  windowTokens: number | undefined,
): ToolResultLimits {
  return {
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
 * The configured byte guard, validated. D121: no fallback of ours — absent
 * or 0 passes the result to the window share alone; below the floor or
 * larger than the model's whole window is refused with the reason, and the
 * caller treats it as unset. Pure so the setting, the exec flag and the
 * host share it. Where the window is unknown the window fit cannot be
 * checked — said in the certification, not guessed.
 * `windowTokens` is the model's WHOLE window, never the room left: the
 * refusal sentence names the model's window, and a cap that fits it must
 * not be refused later merely because the conversation grew.
 */
export function validateToolResultCap(
  value: number | undefined,
  windowTokens: number | undefined,
): { readonly bytes: number } | { readonly refused: ToolResultCapRefusal } {
  if (value === undefined) return { bytes: Infinity }
  if (value === 0) return { bytes: Infinity }
  if (!Number.isSafeInteger(value) || value < TOOL_RESULT_MIN_BYTES) {
    return { refused: { kind: 'below-floor' } }
  }
  return windowTokens !== undefined &&
    Number.isSafeInteger(windowTokens) &&
    windowTokens > 0 &&
    value > windowTokens * OBS_PACK_CHARS_PER_TOKEN
    ? { refused: { kind: 'above-window', windowTokens } }
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
      spill: spill ?? '',
    },
  )
}

export function boundToolResultText(text: string, limits: ToolResultLimits): BoundToolResult {
  const totalChars = text.length
  const totalBytes = utf8Length(text)
  // The true upper bound: a byte guard the person set, and the window's
  // share in bytes against tokens. A kept text within it is within its
  // tokens. D121: no trimming of ours — no token cap, no line cap.
  const hardCapBytes = Math.min(
    limits.maxBytes,
    limits.windowTokens === undefined
      ? Number.MAX_SAFE_INTEGER
      : windowShareBytes(limits.windowTokens),
  )
  if (totalBytes <= hardCapBytes) {
    // Brand: the bound measured this text under every cap, so it may enter a request (PLAN.md §8: TOOLCAP brand).
    return { text: text as BoundedToolText, cut: undefined }
  }
  // `keptChars` counts original characters, and the splice marker is not
  // one (an original `…` in the text is counted).
  let joined = text
  // The most kept characters that fit the byte guarantee (binary search:
  // byte length falls as kept characters fall).
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
  // The kept head and tail are joined by a marker, so two fragments never
  // read as one continuous line the tool never printed; its bytes count
  // against the guarantee like any kept character's.
  const spliceBytes = (parts: { readonly head: string; readonly tail: string }): number =>
    parts.head === '' || parts.tail === '' ? 0 : utf8Length(LINE_MARK)
  let low = 0
  let high = joined.length
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
  const headLines =
    parts.head === ''
      ? 0
      : parts.head.split('\n').length -
        (parts.headEnd >= joined.length || joined[parts.headEnd] === '\n' ? 0 : 1)
  const tailLines =
    parts.tail === ''
      ? 0
      : parts.tail.split('\n').length -
        (parts.tailStart === 0 || joined[parts.tailStart - 1] === '\n' ? 0 : 1)
  const keptMarkers = isSpliced ? 1 : 0
  joined = isSpliced ? `${parts.head}${LINE_MARK}${parts.tail}` : `${parts.head}${parts.tail}`
  const keptBytes = utf8Length(joined)
  const keptChars = joined.length - keptMarkers
  return {
    // Brand: the cut kept at most the guaranteed bytes (PLAN.md §8: TOOLCAP brand).
    text: joined as BoundedToolText,
    cut: {
      totalChars,
      totalBytes,
      totalTokens: estimatePackTokens(totalChars),
      totalLines: splitLines(text).length,
      keptChars,
      keptBytes,
      headLines,
      tailLines,
      omittedChars: totalChars - keptChars,
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
