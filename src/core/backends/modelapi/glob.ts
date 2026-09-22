// A glob matcher for workspace-relative, forward-slash paths: `**` spans
// directories, `*` and `?` stay within one segment, `{a,b}` alternates,
// `[...]` is a character class. Enough for the `search` / `list_files`
// tools' `glob` argument; no dependency.

import { GLOB_MAX_LENGTH } from '../../../shared/constants'

const SPECIAL = /[.+^$()|\\[\]{}]/g
const DOUBLE_STAR = '**'
const DOUBLE_STAR_SEGMENT = '**/'

function escapeLiteral(text: string): string {
  return text.replaceAll(SPECIAL, String.raw`\$&`)
}

/** The translated source and the index just past what was consumed. */
interface Step {
  readonly source: string
  readonly next: number
}

function stepAt(pattern: string, index: number): Step {
  const char = pattern[index] ?? ''
  switch (char) {
    case '*': {
      if (pattern.startsWith(DOUBLE_STAR_SEGMENT, index)) {
        // `**/` matches zero or more whole segments.
        return { source: '(?:.*/)?', next: index + DOUBLE_STAR_SEGMENT.length }
      }
      return pattern.startsWith(DOUBLE_STAR, index)
        ? { source: '.*', next: index + DOUBLE_STAR.length }
        : { source: '[^/]*', next: index + 1 }
    }
    case '?': {
      return { source: '[^/]', next: index + 1 }
    }
    case '{': {
      const close = pattern.indexOf('}', index)
      if (close === -1) {
        return { source: escapeLiteral(char), next: index + 1 }
      }
      const options = pattern.slice(index + 1, close).split(',')
      return {
        source: `(?:${options.map((option) => translate(option)).join('|')})`,
        next: close + 1,
      }
    }
    case '[': {
      const close = pattern.indexOf(']', index)
      return close === -1
        ? { source: escapeLiteral(char), next: index + 1 }
        : { source: pattern.slice(index, close + 1), next: close + 1 }
    }
    default: {
      return { source: escapeLiteral(char), next: index + 1 }
    }
  }
}

/** Translates one glob into an anchored regular expression source. */
function translate(pattern: string): string {
  let out = ''
  let index = 0
  while (index < pattern.length) {
    const step = stepAt(pattern, index)
    out += step.source
    index = step.next
  }
  return out
}

/** Throws on a glob longer than the cap; the tools report that as a failure. */
export function globToRegExp(pattern: string): RegExp {
  if (pattern.length > GLOB_MAX_LENGTH) {
    throw new RangeError(`glob longer than ${String(GLOB_MAX_LENGTH)} characters`)
  }
  // A bare file pattern (`*.ts`) matches at any depth, as ripgrep's globs do.
  const source = pattern.includes('/') ? translate(pattern) : `(?:.*/)?${translate(pattern)}`
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- built from a length-capped glob out of bounded pieces and run over short relative paths (PLAN.md §8)
  return new RegExp(`^${source}$`)
}

export function isGlobMatch(relativePath: string, pattern: string): boolean {
  return globToRegExp(pattern).test(relativePath)
}
