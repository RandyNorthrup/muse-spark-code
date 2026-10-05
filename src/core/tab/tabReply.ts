// A Tab reply's tags and filters (M94, PLAN.md D73): the suggestion is the
// text between the two fixed tags, placed against the cursor, cut to the
// mode and refused when it only repeats existing text, runs away, closes
// what it never opened, or holds a secret. Pure: no `vscode` import.
// "Repeats" means equal after trimming whitespace; the suggestion itself
// keeps its code whitespace.

import {
  REDACTED_MARK,
  TAB_FAST_MAX_LINES,
  TAB_MAX_COMPLETION_CHARS,
  TAB_MULTILINE_MAX_LINES,
  TAB_REPEATED_LINES,
  TAB_REPLY_CLOSE_TAG,
  TAB_REPLY_OPEN_TAG,
} from '../../shared/constants'
import { countSecretMatches } from '../redact'
import type { TabMode } from './tabContext'

const LINE_BREAK = '\n'
const CODE_FENCE = '```'

/** A line ending in one of these opens a block whose body starts below. */
const BLOCK_OPENERS: readonly string[] = ['{', '(', '[', ':']

/**
 * A first line that is a new line's body: it starts with indentation (a
 * tab, or two spaces or more) and holds code. A lone space is not: `x:`
 * followed by ` number` continues the cursor's line.
 */
const BODY_LINE = /^(?:\t| {2})\s*\S/u

/** Each closing bracket and the opening one it needs. */
const BRACKET_PAIRS: ReadonlyMap<string, string> = new Map([
  [')', '('],
  [']', '['],
  ['}', '{'],
])
const OPENING_BRACKETS: ReadonlySet<string> = new Set(BRACKET_PAIRS.values())

/** A fence wrapping the whole reply, before the tags are read. */
export function stripReplyWrapper(reply: string): string {
  let text = reply.trim()
  if (text.startsWith(CODE_FENCE)) {
    const end = text.indexOf(LINE_BREAK)
    text = end === -1 ? '' : text.slice(end + 1)
  }
  if (text.endsWith(CODE_FENCE)) {
    text = text.slice(0, text.length - CODE_FENCE.length)
  }
  return text.trim()
}

/**
 * The text between the first complete tag pair, whitespace and all. A
 * lead-in sentence before the tags and anything after them are not read.
 * Missing, unterminated, or stray tags (a close with no open before it)
 * mean no suggestion; of duplicate pairs the first wins.
 */
export function extractCompletion(reply: string): string | undefined {
  const stripped = stripReplyWrapper(reply)
  const open = stripped.indexOf(TAB_REPLY_OPEN_TAG)
  if (open === -1) {
    return undefined
  }
  const close = stripped.indexOf(TAB_REPLY_CLOSE_TAG, open + TAB_REPLY_OPEN_TAG.length)
  return close === -1 ? undefined : stripped.slice(open + TAB_REPLY_OPEN_TAG.length, close)
}

/**
 * The completion as shown: it ends at the first blank line after the first
 * line, then at the mode's line cap, then at `TAB_MAX_COMPLETION_CHARS`
 * (at a line boundary when one fits). Ending at a blank line also drops a
 * stray trailing line break and a whitespace-only last line; spaces at the
 * end of a line with code stay.
 */
export function cutCompletion(completion: string, mode: TabMode): string {
  const maxLines = mode === 'fast' ? TAB_FAST_MAX_LINES : TAB_MULTILINE_MAX_LINES
  const kept: string[] = []
  for (const [index, line] of completion.split(LINE_BREAK).entries()) {
    if (index > 0 && line.trim() === '') {
      break
    }
    kept.push(line)
    if (kept.length >= maxLines) {
      break
    }
  }
  const text = kept.join(LINE_BREAK)
  if (text.length <= TAB_MAX_COMPLETION_CHARS) {
    return text
  }
  const cut = text.slice(0, TAB_MAX_COMPLETION_CHARS)
  const boundary = cut.lastIndexOf(LINE_BREAK)
  return boundary === -1 ? cut : cut.slice(0, boundary)
}

/** The overlap where the completion's end repeats the suffix's start. */
export function trimTrailingOverlap(completion: string, suffix: string): string {
  const max = Math.min(completion.length, suffix.length)
  for (let size = max; size > 0; size -= 1) {
    if (completion.endsWith(suffix.slice(0, size))) {
      return completion.slice(0, completion.length - size)
    }
  }
  return completion
}

/** Whether three equal non-blank lines run together (after trimming). */
function hasRepeatedLines(completion: string): boolean {
  const lines = completion.split(LINE_BREAK)
  let run = 1
  let previous: string | undefined
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed !== '' && trimmed === previous) {
      run += 1
      if (run >= TAB_REPEATED_LINES) {
        return true
      }
    } else {
      run = 1
    }
    previous = trimmed
  }
  return false
}

/** Whether the completion closes a bracket type more often than it opens it. */
function hasUnopenedClose(completion: string): boolean {
  const depths = new Map<string, number>()
  for (const char of completion) {
    if (OPENING_BRACKETS.has(char)) {
      depths.set(char, (depths.get(char) ?? 0) + 1)
      continue
    }
    const open = BRACKET_PAIRS.get(char)
    if (open === undefined) {
      continue
    }
    const depth = depths.get(open) ?? 0
    if (depth === 0) {
      return true
    }
    depths.set(open, depth - 1)
  }
  return false
}

export type TabDropReason =
  | 'empty'
  | 'untagged'
  | 'suffixRepeat'
  | 'lineAboveRepeat'
  | 'lineBelowRepeat'
  | 'repeatedLines'
  | 'unbalancedClose'
  | 'secret'

export type TabSuggestion = { readonly completion: string } | { readonly drop: TabDropReason }

export interface TabFilterContext {
  readonly mode: TabMode
  /** The text after the cursor, for the suffix-repeat check. */
  readonly suffix: string
  /** The cursor's line before the cursor, to place the completion against. */
  readonly cursorLineBefore: string
  /** The line above the cursor (`''` when there is none). */
  readonly lineAbove: string
  /** The lines below the cursor's line; the first non-blank one counts. */
  readonly linesBelow: readonly string[]
  /** Known secret values, also refused wherever they appear. */
  readonly secretLiterals: readonly string[]
}

/** The text up to the first line break (all of it when there is none). */
function firstLineOf(text: string): string {
  const end = text.indexOf(LINE_BREAK)
  return end === -1 ? text : text.slice(0, end)
}

/**
 * The completion placed against the cursor, its code whitespace otherwise
 * kept (a body's indentation, a line break the model supplied):
 * - after a block opener with nothing left on the cursor's line, a body
 *   that starts on the cursor's line gets the line break the model left out;
 * - on a line holding only indentation, the first line drops that same
 *   indentation, which the user already typed.
 */
function placeAtCursor(completion: string, context: TabFilterContext): string {
  const before = context.cursorLineBefore
  const opened = before.trimEnd()
  if (
    BLOCK_OPENERS.some((opener) => opened.endsWith(opener)) &&
    firstLineOf(context.suffix).trim() === '' &&
    BODY_LINE.test(firstLineOf(completion))
  ) {
    return `${LINE_BREAK}${completion}`
  }
  const hasTypedIndent = opened === '' && before !== '' && completion.startsWith(before)
  return hasTypedIndent ? completion.slice(before.length) : completion
}

/**
 * The reply's suggestion, or why there is none. The pipeline is extract,
 * place against the cursor, cut, then refuse: what is cut away cannot
 * refuse, and the kept text has the suffix overlap trimmed first, so
 * accepting it never duplicates the suffix. What the overlap trim leaves
 * (a space or a line break before the suffix) stays: it separates the two.
 */
export function suggestFromReply(reply: string, context: TabFilterContext): TabSuggestion {
  if (reply.trim() === '') {
    return { drop: 'empty' }
  }
  const extracted = extractCompletion(reply)
  if (extracted === undefined) {
    return { drop: 'untagged' }
  }
  if (extracted.trim() === '') {
    return { drop: 'empty' }
  }
  const cut = cutCompletion(placeAtCursor(extracted, context), context.mode)
  if (cut.trim() === '') {
    return { drop: 'empty' }
  }
  const completion = trimTrailingOverlap(cut, context.suffix)
  const bare = completion.trim()
  if (bare === '' || context.suffix.trimStart().startsWith(bare)) {
    return { drop: 'suffixRepeat' }
  }
  const above = context.lineAbove.trim()
  if (above !== '' && bare === above) {
    return { drop: 'lineAboveRepeat' }
  }
  const below = context.linesBelow.find((line) => line.trim() !== '')
  if (bare === below?.trim()) {
    return { drop: 'lineBelowRepeat' }
  }
  if (hasRepeatedLines(completion)) {
    return { drop: 'repeatedLines' }
  }
  if (context.mode === 'fast' && hasUnopenedClose(completion)) {
    return { drop: 'unbalancedClose' }
  }
  return completion.includes(REDACTED_MARK) ||
    countSecretMatches(completion, context.secretLiterals) > 0
    ? { drop: 'secret' }
    : { completion }
}
