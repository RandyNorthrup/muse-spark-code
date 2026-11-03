// Hidden characters in workspace context files (RLF-SECTEXT, from
// docs/research/agent-security-2026-11-02.md §6 E): the plan-document
// treatment's warning half (planDocument.ts refuses such a plan; a rules
// file or skill body only warns and loads unchanged, and the person
// decides). Warned classes: bidirectional controls, zero-width
// spaces/joiners outside emoji sequences, and tag characters. A tab is
// ordinary text, and a zero-width joiner inside an emoji sequence (the
// family emoji is one grapheme) is how the emoji is spelled: neither
// warns. Anything else the Cc/Cf test would catch (a stray control, a
// soft hyphen) stays silent: only these three classes warn.

/** The hidden-character classes a context warning names. */
export type HiddenCharacterClass = 'bidi' | 'zeroWidth' | 'tag'

// Bidirectional controls: the Arabic letter mark, the left-to-right and
// right-to-left marks, the embeddings and overrides, and the isolates.
const BIDI_CHARACTER = /[\u{061C}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/u
// Tag characters: U+E0000-U+E007F, all format characters.
const TAG_CHARACTER = /[\u{E0000}-\u{E007F}]/u
// Zero-width spaces and joiners: the space, the non-joiner, the word
// joiner, and the no-break space. A leading byte-order mark never
// survives the context read (the decoders drop their own mark), so any
// U+FEFF seen here is content. The joiner warns only outside emoji
// sequences and is tested on its own below.
const ZERO_WIDTH_CHARACTER = /[\u{200B}\u{200C}\u{2060}\u{FEFF}]/u
const ZERO_WIDTH_JOINER = '\u{200D}'
// Any candidate at all: the scan's fast path.
const HIDDEN_CANDIDATE =
  /\u{061C}|[\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}\u{2066}-\u{2069}\u{FEFF}]|[\u{E0000}-\u{E007F}]/u
const EMOJI_PICTOGRAPHIC = /\p{Extended_Pictographic}/u
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** The offsets of zero-width joiners that spell an emoji sequence. */
function emojiJoiners(text: string): ReadonlySet<number> {
  const tolerated = new Set<number>()
  for (const part of GRAPHEMES.segment(text)) {
    if (!part.segment.includes(ZERO_WIDTH_JOINER) || !EMOJI_PICTOGRAPHIC.test(part.segment)) {
      continue
    }
    let offset = part.index
    for (const char of part.segment) {
      if (char === ZERO_WIDTH_JOINER) {
        tolerated.add(offset)
      }
      offset += char.length
    }
  }
  return tolerated
}

/**
The first hidden character's class, scanning left to right; undefined
when the text holds none of the three warned classes.
*/
export function findHiddenCharacters(text: string): HiddenCharacterClass | undefined {
  if (!HIDDEN_CANDIDATE.test(text)) {
    return undefined
  }
  const tolerated = text.includes(ZERO_WIDTH_JOINER) ? emojiJoiners(text) : undefined
  let index = 0
  for (const char of text) {
    if (BIDI_CHARACTER.test(char)) {
      return 'bidi'
    }
    if (TAG_CHARACTER.test(char)) {
      return 'tag'
    }
    if (
      ZERO_WIDTH_CHARACTER.test(char) ||
      (char === ZERO_WIDTH_JOINER && tolerated?.has(index) !== true)
    ) {
      return 'zeroWidth'
    }
    index += char.length
  }
  return undefined
}
