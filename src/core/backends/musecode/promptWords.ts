// The person's words in a session title or first prompt as Muse Code
// returns them (`Session.title`, `Session.firstUserPrompt`).
//
// Muse Code derives both from the first turn's whole model-visible text:
// every part the extension sent, joined with nothing between them, each run
// of whitespace folded into one space, never shortened (captured live
// 2026-10-20 on Muse Code 1.4.11, test/fixtures/session-titles/). The
// person's words come first and the extension's own parts follow them:
//
// - the panel (`send` in conversationController.ts): attached text files, a
//   brief's note, a quoted chat passage, a Git draft prompt, the editor
//   context, the choice-steering and verify notes, the sandbox note;
// - the ACP agent: an editor's attached file, between the person's text
//   blocks, and the sandbox note; a headless run adds its schema request;
// - a scheduled run: its unattended note.
//
// Each part is known by how it opens, in the words its own builder writes
// (the same constants). A tagged part is its tag followed by the words the
// extension writes first inside it; an untagged part (a text file, a
// brief's note, a Git prompt, the schedule and schema notes) is its opening
// sentence. Only the extension's own parts are removed:
//
// - A tag a person typed stays: "<harness_note>" in a message is not
//   followed by one of the extension's notes. Someone who types one of the
//   extension's openings word for word (a tag and its first words, or an
//   opening sentence) loses what follows it from the title, never the text
//   before it.
// - A note, or an editor's attached file, can have the person's words
//   after it (an editor puts typed text after a file), so that block alone
//   goes, to its close. Every other part is followed only by more of the
//   extension's parts, and may hold anything (selected code, a quoted
//   passage, a file, a diff, even a closing tag), so the title ends where
//   it begins.
// - A title cut inside a tagged part (its tag stands without a close, and
//   what follows is the start of the extension's words) ends at that tag.
//
// A dismissed question's note and a late answer ride only a turn after the
// question, never the first one, so no title carries them.

import {
  CHAT_REFERENCE_TAG,
  CHOICE_STEERING_NOTE,
  EXEC_OUTPUT_SCHEMA,
  GIT_COMMIT_INSTRUCTIONS,
  GIT_PULL_REQUEST_INSTRUCTIONS,
  HANDOFF_NOTE,
  HARNESS_NOTE_TAG,
  IDE_CONTEXT_LEADS,
  IDE_CONTEXT_TAGS,
  PLAN_BRIEF_APPROVED,
  PLAN_BRIEF_FROM_FILE,
  SANDBOX_CANNOT_START_MODEL_NOTE,
  SCHEDULE_UNATTENDED_NOTE,
  TEXT_ATTACHMENT_MODEL_TEXT,
  VERIFY_GUIDANCE_CHECKS,
  VERIFY_GUIDANCE_DIAGNOSTICS,
} from '../../../shared/constants'

const WHITESPACE = /\s+/gu
const PLACEHOLDER = /\{\w+\}/u
const SPACE = ' '
const QUOTE = '"'
const ESCAPE = '\\'

/** Each run of whitespace as one space, as Muse Code folds a title. */
function folded(text: string): string {
  return text.replaceAll(WHITESPACE, ' ')
}

/** A template's fixed words before its first placeholder, folded. */
function opening(template: string): string {
  return folded(template.split(PLACEHOLDER)[0] ?? '')
}

/** A part of the extension's own that opens with a tag. */
interface TaggedPart {
  /** The tag as it opens the part, up to where its first words or attributes begin. */
  readonly start: string
  /** The words the extension writes right after `start`, folded. */
  readonly leads: readonly string[]
  readonly close: string
  /** Text of the person's can follow it: the block alone goes, not what follows. */
  readonly isBlock: boolean
}

function tagged(
  tag: string,
  start: string,
  leads: readonly string[],
  isBlock: boolean,
): TaggedPart {
  return { start, leads, close: `</${tag}>`, isBlock }
}

const NOTE_START = `<${HARNESS_NOTE_TAG}>`

const TAGGED: readonly TaggedPart[] = [
  tagged(
    HARNESS_NOTE_TAG,
    NOTE_START,
    [
      folded(CHOICE_STEERING_NOTE).slice(NOTE_START.length),
      folded(SANDBOX_CANNOT_START_MODEL_NOTE).slice(NOTE_START.length),
      opening(VERIFY_GUIDANCE_DIAGNOSTICS),
      opening(VERIFY_GUIDANCE_CHECKS),
    ],
    true,
  ),
  // acp/translate.ts `attachedContext`: `<ide_attached_context uri="…">`.
  tagged(
    IDE_CONTEXT_TAGS.attachedContext,
    `<${IDE_CONTEXT_TAGS.attachedContext}${SPACE}`,
    ['uri="'],
    true,
  ),
  tagged(
    IDE_CONTEXT_TAGS.selection,
    `<${IDE_CONTEXT_TAGS.selection}>`,
    [`${IDE_CONTEXT_LEADS.selection}${SPACE}`],
    false,
  ),
  tagged(
    IDE_CONTEXT_TAGS.openedFile,
    `<${IDE_CONTEXT_TAGS.openedFile}>`,
    [`${IDE_CONTEXT_LEADS.openedFile}${SPACE}`],
    false,
  ),
  // core/chatReference.ts: `<chat_reference intent="…" from="…">`.
  tagged(CHAT_REFERENCE_TAG, `<${CHAT_REFERENCE_TAG}${SPACE}`, ['intent="'], false),
]

/** The opening sentences of the untagged parts; each is followed only by more of the extension's parts. */
const OPENINGS: readonly string[] = [
  opening(HANDOFF_NOTE),
  opening(PLAN_BRIEF_APPROVED),
  opening(PLAN_BRIEF_FROM_FILE),
  opening(GIT_COMMIT_INSTRUCTIONS),
  opening(GIT_PULL_REQUEST_INSTRUCTIONS),
  opening(SCHEDULE_UNATTENDED_NOTE),
  opening(EXEC_OUTPUT_SCHEMA),
]

// core/textAttachment.ts: `Attached text file {name}:\n\n{text}`, the name
// as `JSON.stringify` writes it.
const [TEXT_FILE_HEAD = '', TEXT_FILE_AFTER_NAME = ''] =
  TEXT_ATTACHMENT_MODEL_TEXT.attachedTextFile.split(PLACEHOLDER)
const TEXT_FILE_OPENING = `${folded(TEXT_FILE_HEAD)}${QUOTE}`
const TEXT_FILE_NAME_END = folded(TEXT_FILE_AFTER_NAME).trim()

/** Where one part of the extension's begins, and where it ends when the person's words may follow. */
interface Part {
  readonly start: number
  readonly end?: number
}

/** The first tagged part of this kind at or after `from`. */
function taggedPart(text: string, from: number, part: TaggedPart): Part | undefined {
  for (let at = text.indexOf(part.start, from); at !== -1; at = text.indexOf(part.start, at + 1)) {
    const inside = at + part.start.length
    const rest = text.slice(inside)
    const closeAt = text.indexOf(part.close, inside)
    if (part.leads.some((lead) => rest.startsWith(lead))) {
      return closeAt !== -1 && part.isBlock
        ? { start: at, end: closeAt + part.close.length }
        : { start: at }
    }
    // The title was cut inside the part: no close, and only its first words.
    if (closeAt === -1 && part.leads.some((lead) => lead.startsWith(rest))) {
      return { start: at }
    }
  }
  return undefined
}

/** The first attached text file at or after `from`: its opening, a quoted name, then a colon. */
function textFilePart(text: string, from: number): Part | undefined {
  for (
    let at = text.indexOf(TEXT_FILE_OPENING, from);
    at !== -1;
    at = text.indexOf(TEXT_FILE_OPENING, at + 1)
  ) {
    let index = at + TEXT_FILE_OPENING.length
    while (index < text.length && text[index] !== QUOTE) {
      index += text[index] === ESCAPE ? 2 : 1
    }
    if (index < text.length && text.startsWith(TEXT_FILE_NAME_END, index + 1)) {
      return { start: at }
    }
  }
  return undefined
}

/** The earliest part of the extension's at or after `from`. */
function nextPart(text: string, from: number): Part | undefined {
  const found = [
    ...TAGGED.map((part) => taggedPart(text, from, part)),
    ...OPENINGS.map((words): Part | undefined => {
      const at = text.indexOf(words, from)
      return at === -1 ? undefined : { start: at }
    }),
    textFilePart(text, from),
  ]
  let first: Part | undefined
  for (const part of found) {
    if (part !== undefined && (first === undefined || part.start < first.start)) first = part
  }
  return first
}

/** Words on both sides of a removed block are kept apart by a space. */
function joined(before: string, after: string): string {
  return before === '' || after === '' || before.endsWith(SPACE) || after.startsWith(SPACE)
    ? `${before}${after}`
    : `${before}${SPACE}${after}`
}

/**
The person's words of a title or first prompt as Muse Code returns it:
every part of the extension's own taken out, trimmed. Empty when nothing
of theirs is left (a message that was only an attachment, say).
*/
export function promptWords(prompt: string): string {
  const text = folded(prompt)
  let words = ''
  let from: number | undefined = 0
  while (from !== undefined) {
    const part = nextPart(text, from)
    words = joined(words, text.slice(from, part?.start))
    // A part with no end runs to the end of the title.
    from = part?.end
  }
  return words.trim()
}
