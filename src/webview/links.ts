// Where a link in a reply leads (M25). A URL with a scheme goes to the host,
// which opens http, https and mailto and refuses the rest with a notice. A
// relative link is a workspace file, as models write them ("[parser](src/
// parser.ts#L12)"): it opens in an editor at the lines it names. A path that
// climbs out of the workspace or starts at a root is refused here; the host
// never sees it. A bare "#anchor" does nothing (the reply is not a page).

import { defaultUrlTransform } from 'react-markdown'
import type { LineRange } from '../shared/protocol'

export type LinkTarget =
  | { readonly kind: 'external'; readonly url: string }
  | { readonly kind: 'file'; readonly path: string; readonly range: LineRange | undefined }
  | { readonly kind: 'anchor' }
  | { readonly kind: 'refused' }

const SCHEME = /^[a-z][\d+.a-z-]*:/i
// `notes.md:12` reads like a scheme ("notes.md:") but is a file and a line;
// the dot of an extension is required, so `javascript:1` stays a scheme.
const NAME_WITH_LINES = /^[^./:\\][^/:\\]*\.[^/:\\]+:\d+(?:-\d+)?$/
const ANCHOR = '#'
const ROOTED = /^[/\\]/
const SEPARATORS = /[/\\]/
const PARENT_SEGMENT = '..'
const CURRENT_SEGMENT = '.'
// `#L12`, `#L12-L20`, `#L12-20` (GitHub's form) or a `:12` / `:12-20` suffix.
const FRAGMENT_LINES = /#L(\d+)(?:-L?(\d+))?$/
const SUFFIX_LINES = /:(\d+)(?:-(\d+))?$/

function decoded(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    // A stray `%` is part of the name, not an escape.
    return text
  }
}

function rangeOf(match: RegExpExecArray | null): LineRange | undefined {
  const start = Number(match?.[1])
  if (match === null || !Number.isSafeInteger(start) || start < 1) {
    return undefined
  }
  const end = match[2] === undefined ? start : Number(match[2])
  return { startLine: start, endLine: Math.max(start, end) }
}

/**
 * The href react-markdown puts on a link: its own filter (which blanks
 * `javascript:` and every scheme it does not know), except that a
 * `name:line` file link is let through rather than read as a scheme.
 */
export function linkHref(url: string): string {
  return NAME_WITH_LINES.test(url) ? url : defaultUrlTransform(url)
}

export function linkTarget(href: string): LinkTarget {
  if (SCHEME.test(href) && !NAME_WITH_LINES.test(href)) {
    return { kind: 'external', url: href }
  }
  if (href.startsWith(ANCHOR)) {
    return { kind: 'anchor' }
  }
  if (ROOTED.test(href)) {
    return { kind: 'refused' }
  }
  const lines = FRAGMENT_LINES.exec(href) ?? SUFFIX_LINES.exec(href)
  const withoutLines = lines === null ? href : href.slice(0, lines.index)
  const [pathPart = ''] = withoutLines.split(ANCHOR)
  const segments = decoded(pathPart)
    .split(SEPARATORS)
    .filter((segment) => segment !== '' && segment !== CURRENT_SEGMENT)
  if (segments.length === 0) {
    return { kind: 'anchor' }
  }
  return segments.includes(PARENT_SEGMENT)
    ? { kind: 'refused' }
    : { kind: 'file', path: segments.join('/'), range: rangeOf(lines) }
}

/** A web source's link text: its title, else its host, else the URL itself. */
export function linkLabel(title: string | undefined, url: string): string {
  if (title !== undefined && title !== '') {
    return title
  }
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}
