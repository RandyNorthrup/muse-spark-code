// Moving passages of PLAN.md into docs/plan-archive/, byte for byte.
//
// PLAN.md is read whole by check:plan, check:roadmap and /report, whose
// reader refuses a plan over REPORT_PLAN_MAX_BYTES, so closed history and
// design records live in docs/plan-archive/ and PLAN.md keeps the rule in
// force and a link (CONTRIBUTING.md, "Archiving closed history from
// PLAN.md"). This module is the text side of scripts/plan-archive.mjs: it
// reads no file and runs no process.
//
// A moved passage stands in its archive file as
//
//   <!-- plan-archive:begin id="…" lines="A-B" at="<commit>" bytes="N" sha256="…" -->
//   (blank line)
//   …the passage, unchanged…
//   (blank line)
//   <!-- plan-archive:end id="…" -->
//
// `lines` are its line numbers in PLAN.md at commit `at` (blocks of the first
// move carry no `at`; their file's introduction names the commit). The bytes
// between the two blank lines hash to `sha256`.
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

// The share of the plan reader's bound at which check:plan fails. The gate
// (scripts/check-plan.mjs) carries the same number, because its tests load
// it without its imports; test/unit/planArchiveTool.test.mjs keeps the two
// equal.
export const PLAN_ARCHIVE_AT_PERCENT = 85

export const PLAN_ARCHIVE_FILES = /** @type {const} */ ({
  decisions: 'docs/plan-archive/decisions.md',
  gates: 'docs/plan-archive/gates.md',
  milestones: 'docs/plan-archive/milestones.md',
})

const BLOCK =
  /<!-- plan-archive:begin id="([^"]+)" lines="(\d+)-(\d+)"(?: at="([0-9a-f]{7,40})")? bytes="(\d+)" sha256="([0-9a-f]{64})" -->\n\n([^]*?)\n<!-- plan-archive:end id="\1" -->/g
const FENCE = /^\s*(`{3,}|~{3,})/
const ORDERED_ITEM = /^\d+[.)] /
const HEADING = /^#{1,6} /
const WRAP_COLUMN = 78
// A wrapped line must not begin with something Markdown reads as a block
// start ("15)", "-", "#", ">", "|"): Prettier would then rewrite the paragraph.
const BLOCK_START_WORD = /^(?:\d+[.)]|[-+*>#|]+|={2,}|`{3,}|~{3,})/

/** @param {string} text */
export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** @param {string} text */
export function byteLength(text) {
  return Buffer.byteLength(text, 'utf8')
}

/**
The marked blocks of one archive file.
@param {string} text
@returns {{ id: string, firstLine: number, lastLine: number, at: string | undefined, bytes: number, sha256: string, body: string }[]}
*/
export function archiveBlocks(text) {
  return Array.from(text.matchAll(BLOCK), (match) => ({
    id: match[1] ?? '',
    firstLine: Number(match[2]),
    lastLine: Number(match[3]),
    at: match[4],
    bytes: Number(match[5]),
    sha256: match[6] ?? '',
    body: match[7] ?? '',
  }))
}

/**
What is wrong with one archive file's blocks; empty when nothing is.
@param {string} text
@returns {string[]}
*/
export function archiveProblems(text) {
  const blocks = archiveBlocks(text)
  const problems = []
  const begins = text.match(/<!-- plan-archive:begin /g)?.length ?? 0
  const ends = text.match(/<!-- plan-archive:end /g)?.length ?? 0
  if (begins !== blocks.length || ends !== blocks.length)
    problems.push(
      `${String(begins)} begin and ${String(ends)} end markers for ${String(blocks.length)} whole blocks`,
    )
  const seen = new Set()
  for (const block of blocks) {
    if (seen.has(block.id)) problems.push(`${block.id}: id used twice`)
    seen.add(block.id)
    if (byteLength(block.body) !== block.bytes) problems.push(`${block.id}: size`)
    if (sha256(block.body) !== block.sha256) problems.push(`${block.id}: sha256`)
  }
  return problems
}

/**
One block as it stands in an archive file, ending with a newline.
@param {{ id: string, firstLine: number, lastLine: number, at?: string, body: string }} block
*/
export function renderBlock(block) {
  const at = block.at === undefined ? '' : ` at="${block.at}"`
  return `<!-- plan-archive:begin id="${block.id}" lines="${String(block.firstLine)}-${String(block.lastLine)}"${at} bytes="${String(byteLength(block.body))}" sha256="${sha256(block.body)}" -->\n\n${block.body}\n<!-- plan-archive:end id="${block.id}" -->\n`
}

/**
Prose wrapped the way PLAN.md's paragraphs are, safe under Prettier.
@param {string} text
@returns {string[]}
*/
export function wrapProse(text) {
  const lines = []
  let line = ''
  for (const word of text.trim().split(/\s+/)) {
    if (line !== '' && `${line} ${word}`.length > WRAP_COLUMN && !BLOCK_START_WORD.test(word)) {
      lines.push(line)
      line = word
    } else line = line === '' ? word : `${line} ${word}`
  }
  if (line !== '') lines.push(line)
  return lines
}

/**
Which lines are inside a fenced code block (the fence lines included).
@param {readonly string[]} lines
*/
function fencedLines(lines) {
  const fenced = new Uint8Array(lines.length)
  let fence
  for (const [index, line] of lines.entries()) {
    const mark = FENCE.exec(line)?.[1]
    if (fence !== undefined) {
      fenced[index] = 1
      if (mark?.startsWith(fence) === true) fence = undefined
    } else if (mark !== undefined) {
      fence = mark
      fenced[index] = 1
    }
  }
  return fenced
}

/**
The top-level blocks of PLAN.md: a block starts at a line in column 0 that
follows a blank line (or a heading), outside a fence, and takes everything
indented under it. A heading is a block of its own. A run of column-0
ordered-list items is one block, because Prettier renumbers a list and a
list that lost an item would be rewritten.
@param {readonly string[]} lines
@returns {{ start: number, end: number, isHeading: boolean }[]} 0-based, end exclusive
*/
export function topLevelBlocks(lines) {
  const fenced = fencedLines(lines)
  /** @type {{ start: number, end: number, isHeading: boolean }[]} */
  const blocks = []
  const isBlank = (index) => (lines[index] ?? '').trim() === ''
  const isHeading = (index) => fenced[index] === 0 && HEADING.test(lines[index] ?? '')
  const startsBlock = (index) => {
    if (isBlank(index)) return false
    if (index === 0 || isHeading(index) || isHeading(index - 1)) return true
    // Column 0 after a blank line, and not a line inside an open fence.
    return (
      !/^\s/.test(lines[index] ?? '') &&
      isBlank(index - 1) &&
      !(fenced[index] === 1 && fenced[index - 1] === 1)
    )
  }
  let start = -1
  const close = (end) => {
    if (start < 0) return
    let last = end
    while (last > start && isBlank(last - 1)) last -= 1
    blocks.push({ start, end: last, isHeading: isHeading(start) })
    start = -1
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (!startsBlock(index)) continue
    close(index)
    start = index
  }
  close(lines.length)
  /** @type {{ start: number, end: number, isHeading: boolean }[]} */
  const merged = []
  for (const block of blocks) {
    const previous = merged.at(-1)
    if (
      previous !== undefined &&
      !block.isHeading &&
      !previous.isHeading &&
      ORDERED_ITEM.test(lines[block.start] ?? '') &&
      ORDERED_ITEM.test(lines[previous.start] ?? '')
    )
      previous.end = block.end
    else merged.push({ ...block })
  }
  return merged
}

/**
Take line ranges out of a plan and say what stood there.

Every range must be a run of whole top-level blocks with no heading in it.
A range is replaced by its `stub` (the lines that say where the text went)
or, without one, by nothing. The blank lines after a range go with it, so
the text around it keeps one blank line between blocks.

@param {string} plan the whole PLAN.md
@param {readonly { first: number, last: number, stub?: readonly string[] }[]} ranges 1-based, inclusive
@returns {{ text: string, moves: { range: number, firstLine: number, lastLine: number, body: string, blankBefore: number, blankAfter: number, stubLines: number, newStart: number }[] }}
  the moves in the plan's order; `range` is the range's place in `ranges`
*/
export function takeOut(plan, ranges) {
  const lines = plan.split('\n')
  const blocks = topLevelBlocks(lines)
  const starts = new Map(blocks.map((block, index) => [block.start, index]))
  const sorted = ranges
    .map((range, index) => ({
      range: index,
      first: range.first - 1,
      end: range.last,
      stub: range.stub ?? [],
    }))
    .toSorted((left, right) => left.first - right.first)
  const problems = []
  /** @type {{ range: number, first: number, end: number, stub: readonly string[], removeEnd: number }[]} */
  const plans = []
  for (const [index, range] of sorted.entries()) {
    const label = `lines ${String(range.first + 1)}-${String(range.end)}`
    if (!(range.first >= 0 && range.end <= lines.length && range.first < range.end)) {
      problems.push(`${label}: outside the file`)
      continue
    }
    const previous = sorted[index - 1]
    if (previous !== undefined && range.first < previous.end) {
      problems.push(`${label}: overlaps the range before it`)
      continue
    }
    const from = starts.get(range.first)
    if (from === undefined) {
      problems.push(
        `${label}: line ${String(range.first + 1)} does not start a top-level block (a block starts in column 0 after a blank line)`,
      )
      continue
    }
    let at = from
    while (at < blocks.length && (blocks[at]?.end ?? 0) < range.end) at += 1
    const last = blocks[at]
    if (last?.end !== range.end) {
      problems.push(
        `${label}: line ${String(range.end)} does not end a top-level block (a list item moves with everything indented under it, an ordered list moves whole)`,
      )
      continue
    }
    const heading = blocks.slice(from, at + 1).find((block) => block.isHeading)
    if (heading !== undefined) {
      problems.push(
        `${label}: holds the heading on line ${String(heading.start + 1)}; headings stay`,
      )
      continue
    }
    const next = blocks[at + 1]
    plans.push({ ...range, removeEnd: next === undefined ? lines.length : next.start })
  }
  if (problems.length > 0) throw new RangeError(problems.join('\n'))
  const out = []
  const moves = []
  let cursor = 0
  for (const range of plans) {
    out.push(...lines.slice(cursor, range.first))
    // At the very end of the file what follows the range is the file's final
    // newline, which stays; a range that leaves nothing there takes the blank
    // line before it instead.
    const isLast = range.removeEnd === lines.length
    const kept = isLast ? lines.length - range.end : 0
    let blankBefore = 0
    if (isLast && range.stub.length === 0)
      while (out.at(-1) === '') {
        out.pop()
        blankBefore += 1
      }
    const added = isLast || range.stub.length === 0 ? [...range.stub] : [...range.stub, '']
    moves.push({
      range: range.range,
      firstLine: range.first + 1,
      lastLine: range.end,
      body: `${lines.slice(range.first, range.end).join('\n')}\n`,
      blankBefore,
      blankAfter: range.removeEnd - range.end - kept,
      stubLines: added.length,
      newStart: out.length,
    })
    out.push(...added)
    cursor = range.removeEnd - kept
  }
  out.push(...lines.slice(cursor))
  return { text: out.join('\n'), moves }
}

/**
The plan as it was before `takeOut`: the proof that nothing was lost. The
bodies come from the archive files as written, not from memory.
@param {string} plan the plan after the move
@param {readonly { newStart: number, stubLines: number, blankBefore: number, blankAfter: number }[]} moves
@param {readonly string[]} bodies each move's block as read back from its archive file
*/
export function putBack(plan, moves, bodies) {
  const lines = plan.split('\n')
  const out = []
  let cursor = 0
  const blank = (count) => {
    for (let index = 0; index < count; index += 1) out.push('')
  }
  for (const [index, move] of moves.entries()) {
    out.push(...lines.slice(cursor, move.newStart))
    blank(move.blankBefore)
    out.push(...(bodies[index] ?? '').replace(/\n$/, '').split('\n'))
    blank(move.blankAfter)
    cursor = move.newStart + move.stubLines
  }
  out.push(...lines.slice(cursor))
  return out.join('\n')
}

/**
Where a passage of whole lines stands in a text: the 1-based first line of
each place it stands. A marker's `lines` are those of the commit it names,
so a passage moved from a PLAN.md that differs from that commit's (a merge
in progress, a second move before a commit) is looked up there.
@param {string} text
@param {string} body whole lines, ending with a newline
@returns {number[]}
*/
export function linesOf(text, body) {
  const hay = `\n${text}`
  const needle = `\n${body}`
  const found = []
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) found.push(at)
  if (found.length === 0) return []
  /** @type {number[]} */
  const starts = [0]
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) starts.push(at + 1)
  // `hay` is `text` moved one place right, so a match at `at` starts the line at `at` in `text`.
  return found.map((at) => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if ((starts[middle] ?? 0) <= at) low = middle
      else high = middle - 1
    }
    return low + 1
  })
}

/**
The lines of the section a line stands in, from the heading above it to the
line before the next heading (1-based, inclusive).
@param {string} plan
@param {number} line 1-based
@returns {readonly [number, number]}
*/
export function sectionOf(plan, line) {
  const lines = plan.split('\n')
  const headings = topLevelBlocks(lines)
    .filter((block) => block.isHeading)
    .map((block) => block.start + 1)
  const above = headings.findLast((heading) => heading <= line) ?? 1
  const below = headings.find((heading) => heading > line)
  return [above, below === undefined ? lines.length : below - 1]
}

/**
An archive file with blocks added under a `## heading` (appended to the
heading's own blocks when the file already has it, else at the end).
@param {string} archive
@param {string} heading the heading's text, without the `## `
@param {readonly string[]} rendered blocks from `renderBlock`
*/
export function addToArchive(archive, heading, rendered) {
  const lines = archive.replace(/\n*$/, '').split('\n')
  const fenced = fencedLines(lines)
  const added = rendered.join('\n').replace(/\n$/, '').split('\n')
  const at = lines.findIndex((line, index) => fenced[index] === 0 && line === `## ${heading}`)
  if (at === -1) return `${[...lines, '', `## ${heading}`, '', ...added].join('\n')}\n`
  let end = lines.findIndex(
    (line, index) => index > at && fenced[index] === 0 && /^#{1,2} /.test(line),
  )
  if (end === -1) end = lines.length
  while (end > at + 1 && (lines[end - 1] ?? '').trim() === '') end -= 1
  const tail = lines.slice(end)
  return `${[...lines.slice(0, end), '', ...added, ...(tail.length > 0 ? [''] : []), ...tail.filter((line, index) => !(index === 0 && line.trim() === ''))].join('\n')}\n`
}
