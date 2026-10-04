// A Tab reply's tags and filters (M94, PLAN.md D73): the suggestion is the
// text between the two fixed tags, cut to the mode and refused when it only
// repeats existing text, runs away, closes what it never opened, or holds a
// secret. Pure: no `vscode` import. "Repeats" means equal after trimming
// whitespace.

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
 * The text between the first complete tag pair. A lead-in sentence before
 * the tags and anything after them are not read. Missing, unterminated, or
 * stray tags (a close with no open before it) mean no suggestion; of
 * duplicate pairs the first wins.
 */
export function extractCompletion(reply: string): string | undefined {
  const stripped = stripReplyWrapper(reply)
  const open = stripped.indexOf(TAB_REPLY_OPEN_TAG)
  if (open === -1) {
    return undefined
  }
  const close = stripped.indexOf(TAB_REPLY_CLOSE_TAG, open + TAB_REPLY_OPEN_TAG.length)
  if (close === -1) {
    return undefined
  }
  return stripped.slice(open + TAB_REPLY_OPEN_TAG.length, close)
}

/**
 * The completion as shown: it ends at the first blank line after the first
 * line, then at the mode's line cap, then at `TAB_MAX_COMPLETION_CHARS`
 * (at a line boundary when one fits).
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
function closesUnopened(completion: string): boolean {
  const opens = new Map<string, number>([
    ['(', 0],
    ['[', 0],
    ['{', 0],
  ])
  for (const char of completion) {
    if (char === '(' || char === '[' || char === '{') {
      opens.set(char, (opens.get(char) ?? 0) + 1)
    } else if (char === ')' || char === ']' || char === '}') {
      let open = '('
      if (char === ']') {
        open = '['
      } else if (char === '}') {
        open = '{'
      }
      const depth = opens.get(open) ?? 0
      if (depth === 0) {
        return true
      }
      opens.set(open, depth - 1)
    }
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
  /** The line above the cursor (`''` when there is none). */
  readonly lineAbove: string
  /** The lines below the cursor's line; the first non-blank one counts. */
  readonly linesBelow: readonly string[]
  /** Known secret values, also refused wherever they appear. */
  readonly secretLiterals: readonly string[]
}

/**
 * The reply's suggestion, or why there is none. The pipeline is extract,
 * cut, then refuse: what is cut away cannot refuse, and the kept text has
 * the suffix overlap trimmed first, so accepting it never duplicates the
 * suffix.
 */
export function suggestFromReply(reply: string, context: TabFilterContext): TabSuggestion {
  if (reply.trim() === '') {
    return { drop: 'empty' }
  }
  const extracted = extractCompletion(reply)
  if (extracted === undefined) {
    return { drop: 'untagged' }
  }
  const trimmed = extracted.trim()
  if (trimmed === '') {
    return { drop: 'empty' }
  }
  const cut = cutCompletion(trimmed, context.mode)
  const completion = trimTrailingOverlap(cut, context.suffix).trimEnd()
  if (completion === '' || context.suffix.trimStart().startsWith(completion)) {
    return { drop: 'suffixRepeat' }
  }
  const above = context.lineAbove.trim()
  if (above !== '' && completion === above) {
    return { drop: 'lineAboveRepeat' }
  }
  const below = context.linesBelow.find((line) => line.trim() !== '')
  if (below !== undefined && completion === below.trim()) {
    return { drop: 'lineBelowRepeat' }
  }
  if (hasRepeatedLines(completion)) {
    return { drop: 'repeatedLines' }
  }
  if (context.mode === 'fast' && closesUnopened(completion)) {
    return { drop: 'unbalancedClose' }
  }
  if (
    completion.includes(REDACTED_MARK) ||
    countSecretMatches(completion, context.secretLiterals) > 0
  ) {
    return { drop: 'secret' }
  }
  return { completion }
}
