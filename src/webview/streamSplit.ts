// While a reply streams, every delta would re-parse the whole markdown. The
// text is split into a stable head (rendered once and memoised) and a tail
// (re-rendered per delta) at the last blank line that is outside a code
// fence, so neither half ever holds an unclosed fence or a broken block.

export interface StreamSplit {
  readonly head: string
  readonly tail: string
}

const BLANK_LINE = '\n\n'
const FENCE = '```'
// The tail keeps at least this much text so the split moves in steps instead
// of on every paragraph, and short replies are never split at all.
const MIN_TAIL_CHARS = 1500

function countFences(text: string): number {
  let count = 0
  let index = text.indexOf(FENCE)
  while (index !== -1) {
    count += 1
    index = text.indexOf(FENCE, index + FENCE.length)
  }
  return count
}

/** Split `text` for streaming; an unsplittable text is all tail. */
export function splitForStreaming(text: string): StreamSplit {
  let cut = text.lastIndexOf(BLANK_LINE, text.length - MIN_TAIL_CHARS)
  while (cut > 0) {
    const head = text.slice(0, cut)
    if (countFences(head) % 2 === 0) {
      return { head, tail: text.slice(cut) }
    }
    cut = text.lastIndexOf(BLANK_LINE, cut - 1)
  }
  return { head: '', tail: text }
}
