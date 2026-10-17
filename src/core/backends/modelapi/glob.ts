// A glob matcher for workspace-relative, forward-slash paths: `**` spans
// directories, `*` and `?` stay within one segment, `{a,b}` alternates (and
// nests), `[...]` is a character class (`[!x]` and `[^x]` negate). Enough
// for the `search` / `list_files` tools' `glob` argument; no dependency.
//
// It does not build a regular expression: a translated glob holds nested
// `.*` pieces, and a backtracking engine takes exponential time on some of
// them (`**a**a…b` hung the extension host for 25 s, PLAN.md D24). The match
// is a table over (pattern position, path position), so it costs at most
// pattern length × path length steps, whatever the pattern.
//
// Its limits come from the caller (globLimits.ts binds the extension's):
// the search worker imports this file too, and gets them with its job, so
// its bundle carries no constants table (M78).

/** How long a glob may be, and how many alternatives its braces may expand to. */
export interface GlobLimits {
  readonly maxLength: number
  readonly maxAlternatives: number
}

type Token =
  | { readonly kind: 'literal'; readonly char: string }
  | { readonly kind: 'any' }
  | { readonly kind: 'star' }
  | { readonly kind: 'globstar' }
  | { readonly kind: 'globstarSlash' }
  | {
      readonly kind: 'class'
      readonly ranges: readonly (readonly [string, string])[]
      readonly isNegated: boolean
    }

const SLASH = '/'
const DOUBLE_STAR = '**'
const DOUBLE_STAR_SLASH = '**/'
const CURRENT_DIRECTORY_PREFIX = './'
const RANGE_DASH = '-'
const NEGATIONS: ReadonlySet<string> = new Set(['!', '^'])
const BRACE_DEPTH_CHANGE: Readonly<Record<string, number>> = { '{': 1, '}': -1 }

/** The index of the `]` closing the class that opens at `open`, or -1. */
function classEnd(pattern: string, open: number): number {
  let index = open + 1
  if (NEGATIONS.has(pattern[index] ?? '')) {
    index += 1
  }
  // A `]` right after the opening (or the negation) is a member, not the end.
  if (pattern[index] === ']') {
    index += 1
  }
  const close = pattern.indexOf(']', index)
  return close
}

/** The index of the `}` matching the `{` at `open` (nesting and classes respected), or -1. */
function braceEnd(pattern: string, open: number): number {
  let depth = 0
  let index = open
  while (index < pattern.length) {
    const char = pattern[index] ?? ''
    if (char === '[') {
      // A class is skipped whole: a brace inside it is a member.
      const close = classEnd(pattern, index)
      index = (close === -1 ? index : close) + 1
      continue
    }
    depth += BRACE_DEPTH_CHANGE[char] ?? 0
    if (char === '}' && depth === 0) {
      return index
    }
    index += 1
  }
  return -1
}

/** Splits a brace body on its top-level commas. */
function braceOptions(body: string): string[] {
  const options: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
    } else if (char === ',' && depth === 0) {
      options.push(body.slice(start, index))
      start = index + 1
    }
  }
  options.push(body.slice(start))
  return options
}

/** Every brace alternative of `pattern`; throws past `maxAlternatives`. */
function expandBraces(pattern: string, maxAlternatives: number): string[] {
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern[index] === '[') {
      const close = classEnd(pattern, index)
      index = close === -1 ? index : close
      continue
    }
    if (pattern[index] !== '{') {
      continue
    }
    const close = braceEnd(pattern, index)
    if (close === -1) {
      // An unclosed brace is literal text, as in bash.
      return [pattern]
    }
    const options = braceOptions(pattern.slice(index + 1, close))
    if (options.length < 2) {
      // `{a}` is literal too; carry on past it.
      continue
    }
    const prefix = pattern.slice(0, index)
    const rest = expandBraces(pattern.slice(close + 1), maxAlternatives)
    const expanded: string[] = []
    for (const option of options) {
      for (const head of expandBraces(`${prefix}${option}`, maxAlternatives)) {
        for (const tail of rest) {
          expanded.push(`${head}${tail}`)
          if (expanded.length > maxAlternatives) {
            throw new RangeError(
              `glob expands to more than ${String(maxAlternatives)} alternatives`,
            )
          }
        }
      }
    }
    return expanded
  }
  return [pattern]
}

function classToken(body: string): Token {
  const isNegated = NEGATIONS.has(body[0] ?? '')
  const members = isNegated ? body.slice(1) : body
  const ranges: (readonly [string, string])[] = []
  for (let index = 0; index < members.length; index += 1) {
    const low = members[index] ?? ''
    const high = members[index + 2]
    if (high !== undefined && members[index + 1] === RANGE_DASH) {
      ranges.push([low, high])
      index += 2
    } else {
      ranges.push([low, low])
    }
  }
  return { kind: 'class', ranges, isNegated }
}

/** One brace-free glob as match tokens. */
function tokenize(pattern: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < pattern.length) {
    const char = pattern[index] ?? ''
    if (pattern.startsWith(DOUBLE_STAR_SLASH, index)) {
      tokens.push({ kind: 'globstarSlash' })
      index += DOUBLE_STAR_SLASH.length
    } else if (pattern.startsWith(DOUBLE_STAR, index)) {
      tokens.push({ kind: 'globstar' })
      index += DOUBLE_STAR.length
    } else if (char === '*') {
      tokens.push({ kind: 'star' })
      index += 1
    } else if (char === '?') {
      tokens.push({ kind: 'any' })
      index += 1
    } else if (char === '[' && classEnd(pattern, index) !== -1) {
      const close = classEnd(pattern, index)
      tokens.push(classToken(pattern.slice(index + 1, close)))
      index = close + 1
    } else {
      tokens.push({ kind: 'literal', char })
      index += 1
    }
  }
  return tokens
}

function isInClass(token: Extract<Token, { kind: 'class' }>, char: string): boolean {
  const isMember = token.ranges.some(([low, high]) => char >= low && char <= high)
  return isMember !== token.isNegated
}

/** Whether one character (never `/`) satisfies a single-character token. */
function isSingleMatch(token: Token, char: string): boolean {
  switch (token.kind) {
    case 'literal': {
      return char === token.char
    }
    case 'any': {
      return char !== SLASH
    }
    case 'class': {
      return char !== SLASH && isInClass(token, char)
    }
    default: {
      return false
    }
  }
}

/**
 * One row of the match table: `row[j]` says whether this token and the ones
 * after it match `path[j…]`, given `next`, the row of the token after it.
 */
function rowFor(token: Token, path: string, next: Uint8Array): Uint8Array {
  const row = new Uint8Array(path.length + 1)
  switch (token.kind) {
    case 'star': {
      row[path.length] = next[path.length] ?? 0
      for (let j = path.length - 1; j >= 0; j -= 1) {
        row[j] = next[j] === 1 || (path[j] !== SLASH && row[j + 1] === 1) ? 1 : 0
      }
      return row
    }
    case 'globstar': {
      row[path.length] = next[path.length] ?? 0
      for (let j = path.length - 1; j >= 0; j -= 1) {
        row[j] = next[j] === 1 || row[j + 1] === 1 ? 1 : 0
      }
      return row
    }
    case 'globstarSlash': {
      // Some '/' at or after j closes the directories `**/` skipped.
      row[path.length] = next[path.length] ?? 0
      let isSlashAhead = false
      for (let j = path.length - 1; j >= 0; j -= 1) {
        if (path[j] === SLASH && next[j + 1] === 1) {
          isSlashAhead = true
        }
        row[j] = isSlashAhead || next[j] === 1 ? 1 : 0
      }
      return row
    }
    default: {
      for (let j = path.length - 1; j >= 0; j -= 1) {
        row[j] = isSingleMatch(token, path[j] ?? '') && next[j + 1] === 1 ? 1 : 0
      }
      return row
    }
  }
}

/**
 * The table match, filled from the last token and the end of the path
 * backwards: whether `tokens` match the whole of `path`.
 */
function isTokenMatch(tokens: readonly Token[], path: string): boolean {
  let next: Uint8Array = new Uint8Array(path.length + 1)
  next[path.length] = 1
  for (const token of tokens.toReversed()) {
    next = rowFor(token, path, next)
  }
  return next[0] === 1
}

/**
 * Compiles a glob into a matcher. Throws on a glob longer than the limit or
 * one whose braces expand past it; the tools report either as a failure.
 */
export function compileGlobWithin(
  pattern: string,
  limits: GlobLimits,
): (relativePath: string) => boolean {
  if (pattern.length > limits.maxLength) {
    throw new RangeError(`glob longer than ${String(limits.maxLength)} characters`)
  }
  const trimmed = pattern.startsWith(CURRENT_DIRECTORY_PREFIX)
    ? pattern.slice(CURRENT_DIRECTORY_PREFIX.length)
    : pattern
  const alternatives = expandBraces(trimmed, limits.maxAlternatives).map((alternative) => {
    const tokens = tokenize(alternative)
    // A bare file pattern (`*.ts`) matches at any depth, as ripgrep's globs do.
    return alternative.includes(SLASH) ? tokens : [{ kind: 'globstarSlash' } as const, ...tokens]
  })
  return (relativePath) => alternatives.some((tokens) => isTokenMatch(tokens, relativePath))
}

/** Every folder above a relative path and the path itself: `a`, `a/b`, `a/b/c`. */
function selfAndAncestors(relative: string): string[] {
  const segments = relative.split(SLASH)
  return segments.map((_segment, index) => segments.slice(0, index + 1).join(SLASH))
}

/**
 * The permission settings' deny-read globs as one matcher (M78): a path is
 * covered when a glob matches it or a folder above it, case ignored (the
 * globs come lower case). Throws on a glob the limits refuse.
 */
export function compileDenyGlobsWithin(
  lowerCaseGlobs: readonly string[],
  limits: GlobLimits,
): (relativePaths: readonly string[]) => boolean {
  const matchers = lowerCaseGlobs.map((glob) => compileGlobWithin(glob, limits))
  return (relativePaths) =>
    matchers.length > 0 &&
    relativePaths.some((relative) =>
      selfAndAncestors(relative.toLowerCase()).some((candidate) =>
        matchers.some((matches) => matches(candidate)),
      ),
    )
}
