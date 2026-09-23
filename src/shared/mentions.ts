// `@` mentions: how the extension writes them and how the composer reads
// them back. Pure and shared so the webview drives the menu and the host
// writes the same syntax.
//
// A mention starts with `@` at the beginning of the text or after
// whitespace. The Claude Code form is `@path` with an optional line range,
// `#start` or `#start-end` (`@src/app.ts#5-10`); its path stops at the first
// space (anthropics/claude-code#4012). A path holding whitespace, `#` or `"`
// is therefore quoted, the range after the closing quote
// (`@"my notes/a#1.md"#5-10`); inside the quotes `\"` is a quote and `\\`
// a backslash, and a line break ends an unclosed quote (PLAN.md D27). The
// composer's menu is open while the caret sits at the end of a mention, and
// searches for the path as written inside the quotes, spaces included.

export interface MentionQuery {
  /** Offset of the `@`. */
  readonly start: number
  /** Offset just past the token (the caret, since the token ends there). */
  readonly end: number
  /** The path the token names (unquoted, without its line range), possibly empty. */
  readonly query: string
}

/** 1-based, inclusive. */
export interface MentionLines {
  readonly startLine: number
  readonly endLine: number
}

interface MentionToken {
  readonly start: number
  readonly end: number
  readonly path: string
}

const MENTION = '@'
const QUOTE = '"'
const ESCAPE = '\\'
const FRAGMENT = '#'
const WHITESPACE = /\s/
const LINE_BREAK = /[\r\n]/
const NEEDS_QUOTES = /[\s#"]/
const ESCAPED_IN_QUOTES = /["\\]/g

function isTokenStart(text: string, index: number): boolean {
  return index === 0 || WHITESPACE.test(text.charAt(index - 1))
}

/** The `@` mention of `path`, quoted when it must be, with the lines when given. */
export function formatMention(path: string, lines?: MentionLines): string {
  const written = NEEDS_QUOTES.test(path)
    ? `${QUOTE}${path.replaceAll(ESCAPED_IN_QUOTES, (char) => `${ESCAPE}${char}`)}${QUOTE}`
    : path
  if (lines === undefined) {
    return `${MENTION}${written}`
  }
  const start = String(lines.startLine)
  const range = lines.startLine === lines.endLine ? start : `${start}-${String(lines.endLine)}`
  return `${MENTION}${written}${FRAGMENT}${range}`
}

/** A quoted path from the opening quote at `open`: the path and where the quotes end. */
function readQuoted(text: string, open: number): { readonly path: string; readonly end: number } {
  let path = ''
  let index = open + 1
  while (index < text.length) {
    const char = text.charAt(index)
    const next = text.charAt(index + 1)
    if (char === QUOTE) {
      return { path, end: index + 1 }
    }
    if (LINE_BREAK.test(char)) {
      break
    }
    if (char === ESCAPE && (next === QUOTE || next === ESCAPE)) {
      path += next
      index += 2
      continue
    }
    path += char
    index += 1
  }
  return { path, end: index }
}

/** Where a run of characters that are neither whitespace nor `stop` ends. */
function runEnd(text: string, from: number, stop = ''): number {
  let index = from
  while (index < text.length) {
    const char = text.charAt(index)
    if (char === stop || WHITESPACE.test(char)) {
      break
    }
    index += 1
  }
  return index
}

/** The mention whose `@` is at `at`: its path, then its line range if any. */
function readMention(text: string, at: number): MentionToken {
  const open = at + 1
  const quoted = text.charAt(open) === QUOTE ? readQuoted(text, open) : undefined
  const pathEnd = quoted?.end ?? runEnd(text, open, FRAGMENT)
  const path = quoted?.path ?? text.slice(open, pathEnd)
  const end = text.charAt(pathEnd) === FRAGMENT ? runEnd(text, pathEnd + 1) : pathEnd
  return { start: at, end, path }
}

/** The last mention in `text`, read from the start so a quoted one's spaces stay inside it. */
function lastMention(text: string): MentionToken | undefined {
  let last: MentionToken | undefined
  let index = 0
  while (index < text.length) {
    if (text.charAt(index) === MENTION && isTokenStart(text, index)) {
      last = readMention(text, index)
      index = last.end
    } else {
      index += 1
    }
  }
  return last
}

/** The mention token the caret is at the end of, or undefined when there is none. */
export function mentionQueryAt(text: string, caret: number): MentionQuery | undefined {
  const token = lastMention(text.slice(0, caret))
  if (token?.end !== caret) {
    return undefined
  }
  // The caret must be at the end of the token, not inside a longer word.
  const next = text.charAt(caret)
  const isTokenEnd = next === '' || WHITESPACE.test(next)
  return isTokenEnd ? { start: token.start, end: caret, query: token.path } : undefined
}

/** Replace the token with the path's mention and a space, and report where the caret lands. */
export function applyMention(
  text: string,
  query: MentionQuery,
  path: string,
): { readonly text: string; readonly caret: number } {
  const replacement = `${formatMention(path)} `
  const updated = text.slice(0, query.start) + replacement + text.slice(query.end)
  return { text: updated, caret: query.start + replacement.length }
}

/**
 * The slash command a draft is typing, when the whole draft is one `/token`;
 * used to open the palette pre-filtered. `/compact args` is a command with
 * arguments, not a filter, so it returns undefined.
 */
export function slashFilterOf(text: string): string | undefined {
  const match = /^\/(\S*)$/.exec(text)
  return match?.[1]
}

export interface SkillInvocation {
  readonly selector: string
  readonly arguments: string | undefined
}

/**
 * Splits `/selector rest of text` into a skill invocation when `selector` is
 * one the host listed; any other leading slash is ordinary prompt text.
 */
export function parseSkillInvocation(
  text: string,
  knownSelectors: ReadonlySet<string>,
): SkillInvocation | undefined {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  const selector = match?.[1]
  if (selector === undefined || !knownSelectors.has(selector)) {
    return undefined
  }
  const rest = match?.[2]?.trim()
  return { selector, arguments: rest === undefined || rest === '' ? undefined : rest }
}
