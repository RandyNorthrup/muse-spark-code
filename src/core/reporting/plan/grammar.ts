import { redactSecrets } from '../../../shared/redact'

// plan-format v1: structural tokens, not display text or runtime tunables.
export const PLAN_SECTIONS = { questions: 3, milestones: 6, risks: 8, residuals: 9, releases: 10 }

export interface PlanLine {
  readonly text: string
  readonly line: number
}

/** JSON fields are decoded by JSON.parse; resolve remaining Unicode escapes before the shared scrub. */
export function scrubPlanText(text: string): string {
  if (!text.includes('\\')) return redactSecrets(text)
  const decoded: string[] = []
  const escapeLength = String.raw`\u0000`.length
  const unicodeTail = () =>
    decoded.at(-escapeLength) === '\\'
      ? /^\\u([a-f\d]{4})$/i.exec(decoded.slice(-escapeLength).join(''))
      : null
  for (const char of text) {
    decoded.push(char)
    // Each successful reduction removes five characters, including newly formed
    // escapes. Both ordinary text and nested Unicode encodings take linear work.
    let escape = unicodeTail()
    while (escape?.[1]) {
      decoded.splice(-escapeLength, escapeLength, String.fromCodePoint(Number(`0x${escape[1]}`)))
      escape = unicodeTail()
    }
  }
  return redactSecrets(decoded.join(''))
}

/** Only fresh reader-owned objects enter here; no caller text or evidence is mutated. */
export function scrubPlanStrings(value: object): void {
  const cache = new Map<string, string>()
  const scrub = (text: string) => {
    const previous = cache.get(text)
    if (previous !== undefined) return previous
    const clean = scrubPlanText(text)
    cache.set(text, clean)
    return clean
  }
  const visit = (object: object) => {
    // Reader-owned array indices are generated numbers; their values still need the scrub.
    if (Array.isArray(object)) {
      for (let index = 0; index < object.length; index += 1) {
        const item: unknown = object[index]
        if (typeof item === 'string') {
          const clean = scrub(item)
          if (clean !== item) object[index] = clean
        } else if (typeof item === 'object' && item !== null) visit(item)
      }
      return
    }
    // Snapshot values before renaming keys; a scrubbed key may name a later field.
    const keys = Object.keys(object)
    const values: unknown[] = Object.values(object)
    let index = 0
    for (const key of keys) {
      const item: unknown = values[index]
      index += 1
      const cleanKey = scrub(key)
      if (cleanKey !== key) Reflect.deleteProperty(object, key)
      if (typeof item === 'string') {
        const clean = scrub(item)
        if (Reflect.get(object, cleanKey) !== clean) Reflect.set(object, cleanKey, clean)
      } else {
        if (typeof item === 'object' && item !== null) visit(item)
        if (cleanKey !== key) Reflect.set(object, cleanKey, item)
      }
    }
  }
  visit(value)
}

/** Mask fenced examples while preserving their original line numbers. */
export function planLines(text: string): PlanLine[] {
  let fence: { marker: string; length: number } | undefined
  return text
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((text, index) => {
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text)
      if (fence) {
        if (
          marker &&
          marker[1]?.[0] === fence.marker &&
          marker[1].length >= fence.length &&
          !marker[2]?.trim()
        )
          fence = undefined
        return { text: '', line: index + 1 }
      }
      if (marker?.[1]) {
        fence = { marker: marker[1][0] ?? '', length: marker[1].length }
        return { text: '', line: index + 1 }
      }
      return { text, line: index + 1 }
    })
}

export function compact(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim()
}

export function comparePlanText(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** Current single ids, range headings and named follow-ups all have distinct ids. */
export function milestoneHeading(text: string): { id: string; title: string } | null {
  const match =
    /^### (M\d+[a-z\d]*(?:[–-]M\d+[a-z\d]*)?(?: follow-up)?|[A-Z]{2}[A-Z\d]*) — (.+)$/.exec(text)
  return !match?.[1] || !match[2]
    ? null
    : { id: match[1].replace(' follow-up', '-follow-up'), title: match[2] }
}

export function milestoneIds(text: string, knownIds: ReadonlyMap<string, string>): string[] {
  const matches =
    text.match(/\b(?:m\d+[a-z\d]*(?:-follow-up)?|[a-z][a-z\d]*)(?:[/:][a-z\d]+)?\b/gi) ?? []
  const result: string[] = []
  for (const match of matches) {
    const [base = '', lane] = match.split(/[/:]/, 2)
    const id =
      knownIds.get(base.toLowerCase()) ??
      (/^m\d+[a-z\d]*(?:-follow-up)?$/i.test(base) ? `M${base.slice(1).toLowerCase()}` : null)
    if (id) result.push(lane ? `${id}:${lane.toUpperCase()}` : id)
  }
  return [...new Set(result)]
}

/** Validate the entire primary clause; an unknown prerequisite is never an empty success. */
export function deliveryNeeds(
  text: string,
  knownIds: ReadonlyMap<string, string>,
): string[] | null {
  if (/^(?:none|nothing(?: new)?|main(?: only)?)$/i.test(text.trim())) return []
  const needs: string[] = []
  let owner: string | undefined
  let hasLaneContext = false
  const invalidWords: string[] = []
  const remainder = text.replaceAll(
    /\b[a-z][a-z\d-]*(?:[/:][a-z\d]+)?\b|\b\d+(?:\.\d+\.\d+)?[a-z\d]*\b/gi,
    (word) => {
      if (/^(?:and|s|lane|lanes)$/.test(word.toLowerCase())) {
        if (/^(?:s|lane|lanes)$/.test(word.toLowerCase())) hasLaneContext = true
        return ''
      }
      if (/^\d+\.\d+\.\d+$/.test(word)) {
        needs.push(word)
        hasLaneContext = false
        return ''
      }
      if (hasLaneContext && owner && /^[a-z]{1,2}\d*$|^\d+$/i.test(word)) {
        // A lane qualification replaces the immediately preceding whole-milestone need.
        if (needs.at(-1) === owner) needs.pop()
        needs.push(`${owner}:${word.toUpperCase()}`)
        return ''
      }
      const id = milestoneIds(/^\d+[a-z\d]*$/i.test(word) ? `M${word}` : word, knownIds)[0]
      if (id) {
        needs.push(id)
        owner = id.split(':', 1)[0]
        hasLaneContext = false
      } else invalidWords.push(word)
      return ''
    },
  )
  return invalidWords.length === 0 && needs.length > 0 && /^[\s,()'’.]*$/.test(remainder)
    ? [...new Set(needs)]
    : null
}

/** GFM cells: escaped pipes and pipes inside code spans do not split a cell. */
export function tableCells(text: string): string[] {
  const cells: string[] = []
  let cell = ''
  let code = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    if (char === '\\' && text[index + 1] === '|') {
      cell += '|'
      index += 1
    } else if (char === '`') {
      let ticks = char
      while (text[index + 1] === '`') {
        ticks += '`'
        index += 1
      }
      if (!code) code = ticks
      else if (code === ticks) code = ''
      cell += ticks
    } else if (char === '|' && !code) {
      cells.push(cell.trim())
      cell = ''
    } else cell += char
  }
  cells.push(cell.trim())
  if (!cells[0]) cells.shift()
  if (!cells.at(-1)) cells.pop()
  return cells
}

function isTableSeparator(text: string): boolean {
  const cells = tableCells(text)
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell))
}

/** Delimiters establish tables, including list-indented tables; header words do not. */
export function planTables(
  body: readonly PlanLine[],
  drift: { code: string; line: number; detail: string }[],
): { columns: string[]; line: number; rows: PlanLine[] }[] {
  const tables: { columns: string[]; line: number; rows: PlanLine[] }[] = []
  for (let index = 0; index + 1 < body.length; index += 1) {
    const header = body[index]
    const delimiter = body[index + 1]
    if (!header || !delimiter || !/^\s*\|/.test(header.text) || !isTableSeparator(delimiter.text))
      continue
    const columns = tableCells(header.text)
    const isValid = tableCells(delimiter.text).length === columns.length
    if (!isValid)
      drift.push({ code: 'table-delimiter', line: delimiter.line, detail: header.text.trim() })
    const rows: PlanLine[] = []
    index += 2
    while (index < body.length && /^\s*\|/.test(body[index]?.text ?? '')) {
      const row = body[index]
      if (row) rows.push(row)
      index += 1
    }
    if (isValid) tables.push({ columns, line: header.line, rows })
    index -= 1
  }
  return tables
}

export function field(body: readonly PlanLine[], name: string): string {
  const start = body.findIndex(({ text }) => text.startsWith(`- **${name}.**`))
  if (start === -1) return ''
  const end = body.findIndex(
    ({ text }, index) => index > start && /^(?:- \*\*|#{2,4} |\| Lane)/.test(text),
  )
  return compact(
    body
      .slice(start, end === -1 ? undefined : end)
      .map(({ text }) => text)
      .join('\n')
      .replace(`- **${name}.**`, ''),
  )
}

export function requiredGates(text: string): string[] {
  const names =
    text.match(
      /\b(?:quality(?::[\w-]+)?|check:[\w-]+|test:[\w:-]+|schema:[\w-]+|typecheck(?::[\w-]+)?|build|deadcode|cycles|duplication|security:[\w-]+)\b/g,
    ) ?? []
  return [...new Set(names)]
}
