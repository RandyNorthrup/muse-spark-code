// RLF-PINNED (M101): the person's own side constraints, carried verbatim
// past every compaction. Capture is deterministic — an explicit
// "Constraints:" section and imperative must/never/always lines in user
// turns — never a model call. The block is host-owned session state: it is
// stored with the session, rebuilt from that state at each accepted
// compaction, and never part of the summariser's input, so a summary of a
// summary can never rewrite it (the faithful-compaction rule: carry
// verbatim or drop, never re-summarise). When in doubt capture: the person
// sees what is pinned and can unpin an item.
import { MODEL_API_MODEL_TEXT } from '../../../shared/constants'
import type { InputItem } from './schemas'

const SECTION_START = /^\s*(?:#{1,6}\s*)?constraints\s*:\s*(.*)$/iu
const HEADING = /^\s*#{1,6}\s/u
const BULLET = /^(?:[-*•]|\d+[.)])\s+/u
const IMPERATIVE_START = /^(?:must\s+not|must|never|always|do\s+not|don't)\b/iu
const IMPERATIVE_WORD = /\b(?:must|never|always)\b/iu
const FENCE = /^\s*(?:```|~~~)/u

/** One line's own words: outer whitespace and one list marker are syntax, not words. */
function lineWords(line: string): string {
  return line.trim().replace(BULLET, '')
}

/**
The constraint lines a user turn states, in the order stated. A
"Constraints:" section contributes every line until a blank line or a
heading; outside a section, a line that opens with an imperative or
carries must/never/always as a directive counts (a question does not).
Fenced code is the person's data, not their directives, and never counts.
*/
export function extractPinnedConstraints(text: string): string[] {
  const found: string[] = []
  let isInSection = false
  let isInFence = false
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      isInFence = !isInFence
      isInSection = false
      continue
    }
    if (isInFence) continue
    const section = SECTION_START.exec(line)
    if (section !== null) {
      isInSection = true
      const inline = lineWords(section[1] ?? '')
      if (inline !== '') found.push(inline)
      continue
    }
    if (isInSection) {
      if (line.trim() === '' || HEADING.test(line)) {
        isInSection = false
        if (line.trim() === '') continue
      } else {
        const words = lineWords(line)
        if (words !== '') found.push(words)
        continue
      }
    }
    const words = lineWords(line)
    if (words === '' || words.endsWith('?')) continue
    if (IMPERATIVE_START.test(words) || IMPERATIVE_WORD.test(words)) found.push(words)
  }
  return found
}

/** First-seen order, exact-text duplicates folded: a pin stated twice is one pin. */
export function mergePinnedConstraints(
  existing: readonly string[],
  found: readonly string[],
): string[] {
  return [...new Set([...existing, ...found])]
}

/** The block as the model reads it after a compaction summary: heading plus each pin verbatim. */
export function pinnedConstraintsText(pins: readonly string[]): string {
  return `${MODEL_API_MODEL_TEXT.compactionPinned}\n${pins.map((pin) => `- ${pin}`).join('\n')}`
}

/** The replay item that re-sends the block; `undefined` when nothing is pinned. */
export function pinnedConstraintsItem(pins: readonly string[]): InputItem | undefined {
  return pins.length === 0
    ? undefined
    : {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: pinnedConstraintsText(pins) }],
      }
}

/** The summariser's input with the pinned block taken out: it is never summarised. */
export function withoutPinnedConstraints(
  items: readonly InputItem[],
  pins: readonly string[],
): InputItem[] {
  const pinned = pinnedConstraintsItem(pins)
  if (pinned === undefined) return [...items]
  const bytes = JSON.stringify(pinned)
  return items.filter((item) => JSON.stringify(item) !== bytes)
}
