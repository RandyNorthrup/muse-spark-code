// While a reply streams, every delta would re-parse the whole markdown. The
// text is split into a stable head (rendered once and memoised) and a tail
// (re-rendered per delta) at the last blank line that is outside a code
// fence, so neither half ever holds an unclosed fence or a broken block.
// A fence still open at the end of the tail is split off too (M25): it is
// shown as plain text until it closes, instead of being re-highlighted
// whole on every delta.
//
// Fences follow CommonMark: a line indented at most three spaces opening
// with three or more backticks or tildes, closed by a line of the same
// character at least as long with nothing else on it.

export interface StreamSplit {
  readonly head: string
  readonly tail: string
}

/** A code fence still open at the end of the text: its info-string language and body so far. */
export interface OpenFence {
  readonly language: string | undefined
  readonly code: string
}

interface Fence {
  readonly marker: string
  readonly start: number
  readonly language: string | undefined
  /** Where the body starts: after the opening line. */
  readonly bodyStart: number
}

const BLANK_LINE = '\n\n'
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const BACKTICK = '`'
// The tail keeps at least this much text so the split moves in steps instead
// of on every paragraph, and short replies are never split at all.
const MIN_TAIL_CHARS = 1500

/** The fence state after one line: opened, closed, or unchanged. */
function step(open: Fence | undefined, line: string, start: number): Fence | undefined {
  const match = FENCE_LINE.exec(line)
  const run = match?.[1]
  if (run === undefined) {
    return open
  }
  const rest = match?.[2] ?? ''
  if (open !== undefined) {
    const isClosing =
      run.startsWith(open.marker.charAt(0)) &&
      run.length >= open.marker.length &&
      rest.trim() === ''
    return isClosing ? undefined : open
  }
  // A backtick fence's info string cannot hold a backtick (it would be inline code).
  if (run.startsWith(BACKTICK) && rest.includes(BACKTICK)) {
    return undefined
  }
  const language = rest.trim().split(/\s+/, 1)[0]
  return {
    marker: run,
    start,
    language: language === '' ? undefined : language,
    bodyStart: start + line.length + 1,
  }
}

/**
 * Walk the text line by line, calling `visit` with each line's start offset
 * and whether that line begins outside a fence. Returns the fence open at
 * the end, if any.
 */
function scan(
  text: string,
  visit?: (lineStart: number, isOutside: boolean) => void,
): Fence | undefined {
  let open: Fence | undefined
  let start = 0
  for (const line of text.split('\n')) {
    visit?.(start, open === undefined)
    open = step(open, line, start)
    start += line.length + 1
  }
  return open
}

/** Split `text` for streaming; an unsplittable text is all tail. */
export function splitForStreaming(text: string): StreamSplit {
  const limit = text.length - MIN_TAIL_CHARS
  if (limit <= 0) {
    return { head: '', tail: text }
  }
  // The cut is the "\n\n" that ends a line outside every fence, where the
  // next line starts a new block: the last such one before the limit.
  let cut = 0
  let previousStart = -1
  let isPreviousOutside = false
  scan(text, (lineStart, isOutside) => {
    const boundary = lineStart - 1
    const isBlankBoundary =
      previousStart >= 0 && boundary > 0 && text.startsWith(BLANK_LINE, boundary - 1)
    if (isBlankBoundary && isPreviousOutside && isOutside && boundary - 1 <= limit) {
      cut = boundary - 1
    }
    previousStart = lineStart
    isPreviousOutside = isOutside
  })
  return cut > 0 ? { head: text.slice(0, cut), tail: text.slice(cut) } : { head: '', tail: text }
}

/** The text before a fence left open at its end, and that fence's content so far. */
export function splitOpenFence(text: string): {
  readonly closed: string
  readonly open: OpenFence | undefined
} {
  const fence = scan(text)
  if (fence === undefined) {
    return { closed: text, open: undefined }
  }
  return {
    closed: text.slice(0, fence.start),
    open: { language: fence.language, code: text.slice(Math.min(fence.bodyStart, text.length)) },
  }
}
