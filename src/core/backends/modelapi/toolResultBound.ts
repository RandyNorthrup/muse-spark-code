// TOOLCAP: the one bound every tool result passes through on its way into
// the conversation. `boundToolResultText` enforces, in order: a cap per line
// (the measured failure was megabyte lines, not line count), a cap per
// result in estimated tokens (the unit the provider counts; bytes only as a
// first cheap guard), and a cap relative to what is left of the model's
// window (a result may never take more than TOOL_RESULT_WINDOW_SHARE of the
// remaining room). A result under every cap returns byte-identical: no
// notice, no spill. A cut result's text ends with `cutNotice`, one line
// naming how much there was, which head and tail it kept with the omitted
// middle counted, the longest line when lines were cut, and the spill file
// holding the full text. Pure: the caller writes the spill file.
import {
  MODEL_API_MODEL_TEXT,
  OBS_PACK_CHARS_PER_TOKEN,
  TOOL_RESULT_MIN_BYTES,
  TOOL_RESULT_WINDOW_SHARE,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { estimatePackTokens } from './observationPack'

/** What was cut, for the notice and the tests. Absent when uncut. */
export interface ToolResultCut {
  readonly totalChars: number
  readonly totalTokens: number
  readonly totalLines: number
  readonly keptChars: number
  readonly headLines: number
  readonly tailLines: number
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

/** The result's share of the remaining window, in characters. */
export function windowShareChars(windowTokens: number): number {
  return Math.max(0, Math.floor(windowTokens * TOOL_RESULT_WINDOW_SHARE) * OBS_PACK_CHARS_PER_TOKEN)
}

/**
 * The configured byte guard, validated. Unknown or absent keeps the default
 * (today's behaviour); below the floor or larger than the model's whole
 * window is refused with the reason, and the caller falls back to the
 * default. Pure so the setting, the exec flag and the host share it.
 */
export function validateToolResultCap(
  value: number | undefined,
  windowTokens: number | undefined,
  fallbackBytes: number,
): { readonly bytes: number } | { readonly refused: string; readonly fallback: number } {
  if (value === undefined) return { bytes: fallbackBytes }
  if (!Number.isSafeInteger(value) || value < TOOL_RESULT_MIN_BYTES) {
    return {
      refused: `below the readable floor of ${String(TOOL_RESULT_MIN_BYTES)} bytes`,
      fallback: fallbackBytes,
    }
  }
  if (
    windowTokens !== undefined &&
    Number.isSafeInteger(windowTokens) &&
    windowTokens > 0 &&
    value > windowTokens * OBS_PACK_CHARS_PER_TOKEN
  ) {
    return {
      refused: `larger than the model's window of about ${String(windowTokens)} tokens`,
      fallback: fallbackBytes,
    }
  }
  return { bytes: value }
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
  const lines = splitLines(text)
  let longestLine = 0
  for (const line of lines) longestLine = Math.max(longestLine, line.length)
  const cap = Math.min(
    limits.maxTokens * OBS_PACK_CHARS_PER_TOKEN,
    limits.maxBytes,
    limits.windowTokens === undefined
      ? Number.MAX_SAFE_INTEGER
      : windowShareChars(limits.windowTokens),
  )
  if (longestLine <= limits.maxLineChars && totalChars <= cap) {
    return { text, cut: undefined }
  }
  let omittedChars = 0
  let capped = lines
  let wasLineCut = false
  if (longestLine > limits.maxLineChars) {
    wasLineCut = true
    const keep = Math.max(limits.maxLineChars - LINE_MARK.length, 0)
    const head = Math.ceil(keep / HALVES)
    const tail = Math.floor(keep / HALVES)
    capped = lines.map((line) => {
      if (line.length <= limits.maxLineChars) return line
      omittedChars += line.length - keep
      return `${line.slice(0, boundary(line, head))}${LINE_MARK}${line.slice(boundary(line, line.length - tail))}`
    })
  }
  let joined = capped.join('\n')
  if (joined.length > cap) {
    const headEnd = boundary(joined, Math.ceil(cap / HALVES))
    const tailStart = boundary(joined, joined.length - Math.floor(cap / HALVES))
    omittedChars += joined.length - cap
    joined = `${joined.slice(0, headEnd)}${joined.slice(tailStart)}`
  }
  const keptLines = splitLines(joined)
  const headLines = Math.ceil(keptLines.length / HALVES)
  return {
    text: joined,
    cut: {
      totalChars,
      totalTokens: estimatePackTokens(totalChars),
      totalLines: lines.length,
      keptChars: joined.length,
      headLines,
      tailLines: keptLines.length - headLines,
      omittedChars,
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
