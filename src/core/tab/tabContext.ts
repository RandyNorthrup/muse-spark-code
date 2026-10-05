// Inline completions' context windows (M94, PLAN.md D73): the cursor's line,
// the mode choice, the anchored prefix window and the ordered snippets.
// Pure: no `vscode` import; the host supplies the document text, the cursor
// and the language facts (blank line, block opener).

import {
  TAB_CONTEXT_CHARS,
  TAB_FAST_PREFIX_CHARS,
  TAB_FAST_SUFFIX_CHARS,
  TAB_MULTILINE_PREFIX_CHARS,
  TAB_MULTILINE_SUFFIX_CHARS,
  TAB_PREFIX_ANCHOR_LINES,
  type TabMultiline,
  type TabTrigger,
} from '../../shared/constants'

export type TabMode = 'fast' | 'multiline'

/** The cursor's own line, split at the cursor. */
export interface TabCursorLine {
  readonly before: string
  readonly after: string
  readonly isBlank: boolean
}

const LINE_BREAK = '\n'

/** The cursor's line: an offset outside the document is clamped to it. */
export function cursorLine(text: string, offset: number): TabCursorLine {
  const at = Math.min(Math.max(offset, 0), text.length)
  const start = text.lastIndexOf(LINE_BREAK, at - 1) + 1
  const end = text.indexOf(LINE_BREAK, at)
  const before = text.slice(start, at)
  const after = text.slice(at, end === -1 ? text.length : end)
  return { before, after, isBlank: before.trim() === '' && after.trim() === '' }
}

export interface TabModeInput {
  /** `automatic`: typed; `onInvoke`: the explicit trigger command. */
  readonly trigger: TabTrigger
  readonly multiline: TabMultiline
  /** The cursor's line holds only whitespace (detected by the host). */
  readonly blankLine: boolean
  /** The text before the cursor ends in a block opener (also the host's). */
  readonly blockOpener: boolean
}

/**
 * D73's mode rules: Invoke is always multi-line; `never` and `onInvoke`
 * keep Automatic fast; `auto` goes multi-line on a blank line or a block
 * opener with nothing after the cursor.
 */
export function selectMode(input: TabModeInput): TabMode {
  if (input.trigger === 'onInvoke') {
    return 'multiline'
  }
  if (input.multiline !== 'auto') {
    return 'fast'
  }
  return input.blankLine || input.blockOpener ? 'multiline' : 'fast'
}

/** The request's window, and the prefix's first line (0-based, for logs). */
export interface TabWindow {
  readonly prefix: string
  readonly suffix: string
  readonly startLine: number
}

/** The 0-based line holding `offset`: the line breaks before it. */
function lineIndexAt(text: string, offset: number): number {
  let line = 0
  for (const char of text.slice(0, offset)) {
    if (char === LINE_BREAK) {
      line += 1
    }
  }
  return line
}

/** The offset where the 0-based `line` starts. */
function lineStartAt(text: string, line: number): number {
  let start = 0
  for (let seen = 0; seen < line; seen += 1) {
    const feed = text.indexOf(LINE_BREAK, start)
    if (feed === -1) {
      return text.length
    }
    start = feed + 1
  }
  return start
}

/**
 * The request's window: the prefix runs back at most the mode's allowance,
 * then back to the nearest line starting a `TAB_PREFIX_ANCHOR_LINES` block
 * (0-based, so the first line anchors), so its start stays put while the
 * user types forward and consecutive requests share a cached prefix. The
 * suffix runs forward from the cursor, unanchored.
 */
export function contextWindow(text: string, offset: number, mode: TabMode): TabWindow {
  const at = Math.min(Math.max(offset, 0), text.length)
  const maxPrefix = mode === 'fast' ? TAB_FAST_PREFIX_CHARS : TAB_MULTILINE_PREFIX_CHARS
  const maxSuffix = mode === 'fast' ? TAB_FAST_SUFFIX_CHARS : TAB_MULTILINE_SUFFIX_CHARS
  const rawStart = Math.max(at - maxPrefix, 0)
  const rawLine = lineIndexAt(text, rawStart)
  const startLine = rawLine - (rawLine % TAB_PREFIX_ANCHOR_LINES)
  const start = lineStartAt(text, startLine)
  return {
    prefix: text.slice(start, at),
    suffix: text.slice(at, at + maxSuffix),
    startLine,
  }
}

/** One related file's excerpt for multi-line mode. */
export interface TabSnippet {
  readonly path: string
  readonly text: string
}

const SNIPPET_FENCE = '```'

function compareSnippetPath(a: TabSnippet, b: TabSnippet): number {
  if (a.path < b.path) {
    return -1
  }
  if (a.path > b.path) {
    return 1
  }
  return 0
}

/**
 * The snippets fenced in path order (D73's request order: instructions,
 * snippets sorted by path, header, prefix, marker, suffix), each kept whole
 * while it fits in `TAB_CONTEXT_CHARS`. Sorted and whole, so the request
 * head stays byte-stable while the user types.
 */
export function orderSnippets(snippets: readonly TabSnippet[]): string {
  const ordered = [...snippets].sort(compareSnippetPath)
  const kept: string[] = []
  let used = 0
  for (const snippet of ordered) {
    const rendered = `${SNIPPET_FENCE}${snippet.path}${LINE_BREAK}${snippet.text}${LINE_BREAK}${SNIPPET_FENCE}`
    const gap = kept.length === 0 ? 0 : LINE_BREAK.length
    if (used + gap + rendered.length > TAB_CONTEXT_CHARS) {
      continue
    }
    kept.push(rendered)
    used += gap + rendered.length
  }
  return kept.join(LINE_BREAK)
}
