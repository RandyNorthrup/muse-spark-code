// A memory scope's `MEMORY.md` (PLAN.md D13, D41): one line per note,
// `- [Title](file.md) | hook`, read into the model's context at the start
// of a session. The index is cut at Muse Code's limits with its own marker;
// the extension adds a line for a note it creates and removes the lines of
// a note it deletes, so the index stays true to the folder. Pure.

import {
  MEMORY_HOOK_MAX_CHARS,
  MEMORY_INDEX_FILE,
  MEMORY_MARKDOWN_ESCAPE,
  MEMORY_INDEX_MAX_BYTES,
  MEMORY_INDEX_MAX_LINES,
  MEMORY_NOTE_EXTENSION,
  MEMORY_TRUNCATED_MARKER,
} from '../../shared/constants'

export interface LimitedIndex {
  readonly text: string
  /** Why the index was cut, for the log; undefined when it fits. */
  readonly warning: string | undefined
}

const LINE_BREAK = /\r?\n/
const TRAILING_BREAKS = /(?:\r?\n)+$/
const CURRENT_DIRECTORY = './'
const HEADING_MARKS = /^#+\s*/
const WHITESPACE_RUN = /\s+/g
const FRONT_MATTER_FENCE = '---'
const DESCRIPTION_KEY = 'description:'
const ELLIPSIS = '…'

/** The index within Muse Code's line and byte limits, `label` naming it in the warning. */
export function limitMemoryIndex(text: string, label: string): LimitedIndex {
  const lines = text.split(LINE_BREAK)
  const bytes = Buffer.byteLength(text)
  if (lines.length <= MEMORY_INDEX_MAX_LINES && bytes <= MEMORY_INDEX_MAX_BYTES) {
    return { text: text.trim(), warning: undefined }
  }
  let kept = lines.slice(0, MEMORY_INDEX_MAX_LINES).join('\n')
  if (Buffer.byteLength(kept) > MEMORY_INDEX_MAX_BYTES) {
    kept = Buffer.from(kept).subarray(0, MEMORY_INDEX_MAX_BYTES).toString()
  }
  const limit =
    lines.length > MEMORY_INDEX_MAX_LINES
      ? `${String(lines.length)} lines exceeds the ${String(MEMORY_INDEX_MAX_LINES)} line index limit`
      : `${String(bytes)} bytes exceeds the ${String(MEMORY_INDEX_MAX_BYTES)} byte index limit`
  return {
    text: `${kept.trim()}\n${MEMORY_TRUNCATED_MARKER}`,
    warning: `${label}: ${limit}; it is truncated for this session`,
  }
}

function linkTarget(line: string): string | undefined {
  // Titles may contain an escaped `](`, and a hand-written destination may
  // contain nested parentheses. Find the first unescaped closing bracket,
  // then the destination's balanced end.
  for (let index = 0; index < line.length - 1; index += 1) {
    if (line[index] === MEMORY_MARKDOWN_ESCAPE) {
      index += 1
      continue
    }
    if (line[index] !== ']' || line[index + 1] !== '(') {
      continue
    }
    const start = index + 2
    let depth = 1
    for (let end = start; end < line.length; end += 1) {
      if (line[end] === MEMORY_MARKDOWN_ESCAPE) {
        end += 1
        continue
      }
      if (line[end] === '(') {
        depth += 1
        continue
      }
      if (line[end] !== ')') {
        continue
      }
      depth -= 1
      if (depth !== 0) {
        continue
      }
      const raw = line.slice(start, end).trim()
      const relative = raw.startsWith(CURRENT_DIRECTORY) ? raw.slice(CURRENT_DIRECTORY.length) : raw
      try {
        return decodeURIComponent(relative)
      } catch {
        return relative
      }
    }
    return undefined
  }
  return undefined
}

/** Whether a line of the index links to the note at `notePath` (forward slashes). */
export function hasIndexLine(indexText: string, notePath: string): boolean {
  return indexText.split(LINE_BREAK).some((line) => linkTarget(line) === notePath)
}

/** The index with every line that links to `notePath` removed; undefined when none did. */
export function withoutIndexLines(indexText: string, notePath: string): string | undefined {
  const lines = indexText.split(LINE_BREAK)
  const kept = lines.filter((line) => linkTarget(line) !== notePath)
  return kept.length === lines.length ? undefined : kept.join('\n')
}

/** `text` with one more line at its end (a missing or empty index is the line alone). */
export function withIndexLine(indexText: string | undefined, line: string): string {
  const body = (indexText ?? '').replace(TRAILING_BREAKS, '')
  return body === '' ? `${line}\n` : `${body}\n${line}\n`
}

function oneLine(text: string): string {
  const flat = text.replace(HEADING_MARKS, '').replaceAll(WHITESPACE_RUN, ' ').trim()
  return flat.length > MEMORY_HOOK_MAX_CHARS
    ? `${flat.slice(0, MEMORY_HOOK_MAX_CHARS - ELLIPSIS.length)}${ELLIPSIS}`
    : flat
}

/**
 * What a note is about, in one line: its front matter's `description`, else
 * its first line of text (a heading's marks dropped). Empty for an empty note.
 */
export function noteSummary(text: string): string {
  const lines = text.split(LINE_BREAK)
  let index = 0
  if (lines[0]?.trim() === FRONT_MATTER_FENCE) {
    const end = lines.findIndex((line, at) => at > 0 && line.trim() === FRONT_MATTER_FENCE)
    const description = lines
      .slice(1, end === -1 ? 1 : end)
      .find((line) => line.startsWith(DESCRIPTION_KEY))
    if (description !== undefined) {
      return oneLine(description.slice(DESCRIPTION_KEY.length))
    }
    index = end === -1 ? 0 : end + 1
  }
  const first = lines.slice(index).find((line) => line.trim() !== '')
  return first === undefined ? '' : oneLine(first)
}

/** The index line of a note: its file name as the title, `hook` after the bar when there is one. */
export function indexLineFor(notePath: string, hook: string): string {
  const name = notePath.split('/').at(-1) ?? notePath
  const title = name.endsWith(MEMORY_NOTE_EXTENSION)
    ? name.slice(0, -MEMORY_NOTE_EXTENSION.length)
    : name
  const safeTitle = title
    .replaceAll(MEMORY_MARKDOWN_ESCAPE, () => MEMORY_MARKDOWN_ESCAPE.repeat(2))
    .replaceAll('[', () => `${MEMORY_MARKDOWN_ESCAPE}[`)
    .replaceAll(']', () => `${MEMORY_MARKDOWN_ESCAPE}]`)
  const destination = notePath
    .split('/')
    .map((segment) => encodeURIComponent(segment).replaceAll('(', '%28').replaceAll(')', '%29'))
    .join('/')
  const summary = oneLine(hook)
  return summary === ''
    ? `- [${safeTitle}](${destination})`
    : `- [${safeTitle}](${destination}) | ${summary}`
}

/** Whether a note path is the scope's index itself. */
export function isIndexPath(notePath: string): boolean {
  return notePath === MEMORY_INDEX_FILE
}
