// A saved plan as a Markdown file (M79, PLAN.md D49), after Muse Code's own
// convention: its bundled `plan` skill (Muse Code 1.4.0) saves a plan to
// `.agents/plans/YYYY-MM-DD-<slug>.md`, a short numeric suffix when that
// name is taken, and the file's content is exactly the plan's body. The
// name it gets, the body a reply holds, how a file is read back, and the
// steps that seed a new conversation's todo list. No file system, no
// `vscode`.
//
// A plan's heading and steps, and what the panel leaves out of it, need the
// panel's own Markdown parser, which loads on first use (planMarkdown.ts,
// dist/planMarkdown.js): they arrive here as a `PlanMarkdown`.

import { createHash } from 'node:crypto'
import {
  MUSE_PLAN_HANDOFF_LEAD,
  MUSE_PLAN_HANDOFF_TAIL,
  PLAN_FILE_EXTENSION,
  PLAN_LOG_HASH_CHARS,
  PLAN_SLUG_FALLBACK,
  PLAN_SLUG_MAX_CHARS,
  PLAN_STEP_MAX_CHARS,
  PLAN_STEPS_MAX,
  PLAN_TITLE_MAX_CHARS,
} from '../../shared/constants'

/** A plan read back from its file. */
export interface PlanDocument {
  /** Its first top-level heading, else its file name. */
  readonly title: string
  /** The file whole: the plan as the model wrote it. */
  readonly body: string
}

/**
 * What the panel's Markdown parser says of a plan (planMarkdown.ts), loaded
 * with dist/planMarkdown.js on the first plan action.
 */
export interface PlanMarkdown {
  /** The text of its first top-level heading as the panel shows it, if any. */
  readonly topHeading: (text: string) => string | undefined
  /** The items of its top-level numbered lists, else of its bulleted ones, each on one line. */
  readonly listItems: (body: string) => readonly string[]
  /** Whether it holds raw HTML, which the panel never renders. */
  readonly hasRawHtml: (text: string) => boolean
  /** The plan as the model gets it: what the panel showed of it, written as Markdown. */
  readonly briefText: (text: string) => string
}

/** What a plan file is written from. */
export interface PlanContent {
  /** What the file is named after. */
  readonly title: string
  readonly savedAt: Date
  /** The plan, written byte for byte. */
  readonly text: string
}

const LINE_BREAK = /\r?\n/
// "Plan", "Plan:", "Plan how to", "Implementation plan —" say nothing about the task.
const GENERIC_PLAN_LEAD = /^(?:implementation\s+)?plan\b(?:\s+how\s+to\b)?[\s:.\-–—]*/i
const WHITESPACE = /\s+/g
// Letters, their marks (Devanagari's vowel signs, Thai's tones) and digits.
const NOT_SLUG = /[^\p{L}\p{M}\p{N}]+/gu
// The accents of Latin, Greek and Cyrillic letters once decomposed; kana's
// voicing marks and Hangul's jamo are left to recompose.
const COMBINING_ACCENTS = /[\u{300}-\u{36F}]+/gu
const EDGE_HYPHENS = /^-+|-+$/g
const LEADING_BREAKS = /^(?:\r?\n)+/
const TRAILING_BREAKS = /(?:\r?\n)+$/
// A separator, a drive or stream colon, a control character (a line break
// would reach the brief unquoted) or a format character (a right-to-left
// override would disguise the name in Plans…): never part of a plan's name.
const UNSAFE_NAME_CHARACTER = /[\\/:\p{Cc}\p{Cf}]/u
// In a plan's text: a control character other than a tab or a line break
// (DEL and the C1 controls included), or a format character (a direction
// override, a zero-width character). The panel paints them, reordering or
// hiding text, while the model reads the string as it is.
const UNSHOWN_CHARACTER = /[^\P{Cc}\t\n\r]|\p{Cf}/u
// A plan file's name as the extension makes it starts with its day.
const DATED_NAME = /^(\d{4})-(\d{2})-(\d{2})(?=[-.])/
const DATE_PAD = 2
const ELLIPSIS = '…'

// Characters as the user sees them: a cut never splits a pair or a cluster.
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function graphemes(text: string): readonly string[] {
  return Array.from(GRAPHEMES.segment(text), (part) => part.segment)
}

function oneLine(text: string): string {
  return text.replaceAll(WHITESPACE, ' ').trim()
}

/** At most `maxChars` characters, never split, an ellipsis when cut. */
function cut(text: string, maxChars: number): string {
  const characters = graphemes(text)
  return characters.length <= maxChars
    ? text
    : `${characters
        .slice(0, maxChars - 1)
        .join('')
        .trimEnd()}${ELLIPSIS}`
}

/**
 * The plan a reply holds. A Muse Code plan reply opens and closes with its
 * `plan` skill's handoff (captured live 2026-09-27, docs/certification/m79.md):
 * the plan is what lies between, the blank lines around it dropped, and
 * nothing else changed. Any other reply is the plan whole.
 */
export function planBody(reply: string): string {
  if (!reply.startsWith(MUSE_PLAN_HANDOFF_LEAD)) {
    return reply
  }
  const inner = reply.slice(MUSE_PLAN_HANDOFF_LEAD.length).replace(LEADING_BREAKS, '')
  const withoutTail = inner.trimEnd().endsWith(MUSE_PLAN_HANDOFF_TAIL)
    ? inner.trimEnd().slice(0, -MUSE_PLAN_HANDOFF_TAIL.length)
    : inner
  const body = withoutTail.replace(TRAILING_BREAKS, '')
  return body.trim() === '' ? reply : body
}

/**
 * What a plan is named after: its top-level heading, unless that only says
 * "Plan"; else the first line of the prompt that asked for it, its "Plan how
 * to" dropped; else `fallback`.
 */
export function planTitle(
  markdown: PlanMarkdown,
  text: string,
  prompt: string | undefined,
  fallback: string,
): string {
  const heading = markdown.topHeading(text)?.replace(GENERIC_PLAN_LEAD, '').trim()
  const request = (prompt ?? '')
    .split(LINE_BREAK)
    .map((line) => oneLine(line).replace(GENERIC_PLAN_LEAD, ''))
    .find((line) => line !== '')
  const title = heading === undefined || heading === '' ? (request ?? fallback) : heading
  return cut(title, PLAN_TITLE_MAX_CHARS)
}

/**
 * The file-name form of a title: letters and digits of any script, lower
 * case, accents dropped, everything else one hyphen, cut to a length.
 */
export function planSlug(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replaceAll(COMBINING_ACCENTS, '')
    .normalize('NFC')
    .toLowerCase()
    .replaceAll(NOT_SLUG, '-')
    .replaceAll(EDGE_HYPHENS, '')
  // Cut by characters: a pair cut in half would reach the disk as U+FFFD.
  const kept = graphemes(slug).slice(0, PLAN_SLUG_MAX_CHARS).join('').replaceAll(EDGE_HYPHENS, '')
  return kept === '' ? PLAN_SLUG_FALLBACK : kept
}

/** A name's leading `YYYY-MM-DD` when it is a real day, as the extension names plans. */
function datePrefix(fileName: string): string | undefined {
  const match = DATED_NAME.exec(fileName)
  const [, year = 0, month = 0, date = 0] = (match ?? []).map(Number)
  const day = new Date(Date.UTC(year, month - 1, date))
  const isRealDay = day.getUTCMonth() === month - 1 && day.getUTCDate() === date
  return match !== null && isRealDay ? match[0] : undefined
}

/**
 * How the log names a plan file: a short hash of its name, after its day
 * when the name verifiably starts with one, and nothing else of it: the rest
 * of a name is drawn from what the user or the model wrote (M39), and a file
 * someone else put in the folder may be named anything.
 */
export function planLogName(fileName: string): string {
  const hash = createHash('sha256').update(fileName).digest('hex').slice(0, PLAN_LOG_HASH_CHARS)
  const day = datePrefix(fileName)
  return `${day === undefined ? '' : `${day}-`}#${hash}${PLAN_FILE_EXTENSION}`
}

/** `2026-09-27`: the local calendar day. */
function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(DATE_PAD, '0')
  const day = String(date.getDate()).padStart(DATE_PAD, '0')
  return `${String(date.getFullYear())}-${month}-${day}`
}

/** `<date>-<slug>.md`, or `<date>-<slug>-<n>.md` from the second attempt on. */
export function planFileName(savedAt: Date, slug: string, attempt: number): string {
  const suffix = attempt <= 1 ? '' : `-${String(attempt)}`
  return `${localDay(savedAt)}-${slug}${suffix}${PLAN_FILE_EXTENSION}`
}

/** Reads a plan file back; `fileName` names it when no top-level heading does. */
export function parsePlanFile(
  markdown: PlanMarkdown,
  content: string,
  fileName: string,
): PlanDocument {
  const bareName = fileName.endsWith(PLAN_FILE_EXTENSION)
    ? fileName.slice(0, -PLAN_FILE_EXTENSION.length)
    : fileName
  return {
    title: cut(markdown.topHeading(content) ?? bareName, PLAN_TITLE_MAX_CHARS),
    body: content,
  }
}

/**
 * The plan's steps: its top-level numbered items, or, when it numbers none,
 * its top-level bullets, as the panel parses them; at most PLAN_STEPS_MAX,
 * each cut to PLAN_STEP_MAX_CHARS.
 */
export function planSteps(markdown: PlanMarkdown, body: string): readonly string[] {
  return markdown
    .listItems(body)
    .slice(0, PLAN_STEPS_MAX)
    .map((item) => cut(item, PLAN_STEP_MAX_CHARS))
}

/** The steps as numbered lines, as the model is told its todo list was set. */
export function numberedSteps(steps: readonly string[]): string {
  return steps.map((step, index) => `${String(index + 1)}. ${step}`).join('\n')
}

/**
 * Whether a plan's text holds a character the panel does not show as the
 * model reads it (see UNSHOWN_CHARACTER): such a plan is neither saved nor
 * started, as the rendered view is no longer what the model gets.
 */
export function hasUnshownCharacters(text: string): boolean {
  return UNSHOWN_CHARACTER.test(text)
}

/** Whether a name is a plan file's own: one path segment ending in `.md`. */
export function isPlanFileName(name: string): boolean {
  return (
    name.endsWith(PLAN_FILE_EXTENSION) &&
    name.length > PLAN_FILE_EXTENSION.length &&
    !name.startsWith('.') &&
    !UNSAFE_NAME_CHARACTER.test(name)
  )
}
