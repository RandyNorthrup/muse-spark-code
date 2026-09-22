// `@` mention parsing for the composer. A mention token starts with `@` at the
// beginning of the draft or after whitespace and runs to the next whitespace;
// the menu is open while the caret sits inside such a token. Pure and shared
// so the webview drives the menu and the host can reuse the same rules.

export interface MentionQuery {
  /** Offset of the `@`. */
  readonly start: number
  /** Offset just past the token (the caret, since the token ends there). */
  readonly end: number
  /** The text after `@`, possibly empty. */
  readonly query: string
}

const WHITESPACE = /\s/

function isTokenStart(text: string, index: number): boolean {
  return index === 0 || WHITESPACE.test(text.charAt(index - 1))
}

/** The mention token the caret is in, or undefined when there is none. */
export function mentionQueryAt(text: string, caret: number): MentionQuery | undefined {
  const head = text.slice(0, caret)
  const at = head.lastIndexOf('@')
  if (at === -1 || !isTokenStart(head, at)) {
    return undefined
  }
  const query = head.slice(at + 1)
  if (WHITESPACE.test(query)) {
    return undefined
  }
  // The caret must be at the end of the token, not inside a longer word.
  const next = text.charAt(caret)
  const isTokenEnd = next === '' || WHITESPACE.test(next)
  return isTokenEnd ? { start: at, end: caret, query } : undefined
}

/** Replace the token with `@path ` and report where the caret lands. */
export function applyMention(
  text: string,
  query: MentionQuery,
  path: string,
): { readonly text: string; readonly caret: number } {
  const replacement = `@${path} `
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
