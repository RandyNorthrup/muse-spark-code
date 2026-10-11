// A citation of PLAN.md by text, never by line number.
//
// A line number moves whenever anything above it is edited, and every branch
// edits PLAN.md: `PLAN.md:20254` named four different sentences in two days.
// A citation here names the decision's or milestone's heading and quotes a
// phrase from under it. It resolves only while
//
// - the heading is in PLAN.md exactly once,
// - the phrase is in PLAN.md exactly once, and
// - that one occurrence lies in the heading's own section (up to the next
//   heading of the same or a higher level).
//
// Text may be re-wrapped and lines may be added above or below: runs of
// whitespace compare as one space, and nothing else is forgiven. A phrase
// that was deleted, reworded, duplicated or moved to another section fails.

/** One PLAN.md passage, named by its heading and a phrase quoted from it. */
export interface PlanCitation {
  /** The whole heading line as PLAN.md writes it, `#` marks included. */
  readonly heading: string
  /** A phrase quoted exactly from that section (whitespace runs count as one space). */
  readonly phrase: string
}

/** Shorter than this, a phrase says too little to be a citation. */
export const PLAN_CITATION_MIN_PHRASE = 24

const HEADING = /^(#{1,6}) \S/
const FENCE = /^(`{3,}|~{3,})/

function oneSpaced(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim()
}

function occurrences(haystack: string, needle: string): number {
  let count = 0
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1))
    count += 1
  return count
}

/** The heading lines of a Markdown text, fenced code left out. */
function headings(lines: readonly string[]): { readonly line: number; readonly level: number }[] {
  const found: { line: number; level: number }[] = []
  let fence: string | undefined
  for (const [line, text] of lines.entries()) {
    const mark = FENCE.exec(text)?.[1]
    if (fence !== undefined) {
      if (mark?.startsWith(fence) === true) fence = undefined
      continue
    }
    if (mark !== undefined) {
      fence = mark
      continue
    }
    const level = HEADING.exec(text)?.[1]?.length
    if (level !== undefined) found.push({ line, level })
  }
  return found
}

/**
 * A checker over one PLAN.md text: `undefined` when the citation resolves,
 * otherwise what is wrong with it.
 */
export function planCitationChecker(plan: string): (citation: PlanCitation) => string | undefined {
  const lines = plan.split(/\r?\n/)
  const marks = headings(lines)
  const whole = oneSpaced(plan)
  return (citation) => {
    const heading = citation.heading.trimEnd()
    if (!HEADING.test(heading)) return `"${heading}" is not a Markdown heading line`
    const phrase = oneSpaced(citation.phrase)
    if (phrase.length < PLAN_CITATION_MIN_PHRASE)
      return `the phrase is shorter than ${String(PLAN_CITATION_MIN_PHRASE)} characters`
    const matches = marks.filter((mark) => lines[mark.line]?.trimEnd() === heading)
    const [start] = matches
    if (start === undefined) return `the heading "${heading}" is not in PLAN.md`
    if (matches.length > 1)
      return `the heading "${heading}" is in PLAN.md ${String(matches.length)} times`
    const total = occurrences(whole, phrase)
    if (total === 0) return `the phrase "${phrase}" is not in PLAN.md`
    if (total > 1) return `the phrase "${phrase}" is in PLAN.md ${String(total)} times`
    const end = marks.find((mark) => mark.line > start.line && mark.level <= start.level)
    const section = oneSpaced(lines.slice(start.line, end?.line).join('\n'))
    return section.includes(phrase) ? undefined : `the phrase "${phrase}" is not under "${heading}"`
  }
}
