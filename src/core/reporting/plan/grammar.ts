// plan-format v1: structural tokens, not display text or runtime tunables.
export const PLAN_SECTIONS = { questions: 3, milestones: 6, risks: 8, residuals: 9, releases: 10 }

export interface PlanLine {
  readonly text: string
  readonly line: number
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

export function milestoneIds(text: string): string[] {
  const matches = text.match(/\bM\d+[a-z\d]*\b/gi) ?? []
  return [...new Set(matches.map((id) => `M${id.slice(1).toLowerCase()}`))]
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

export function isTableSeparator(text: string): boolean {
  const cells = tableCells(text)
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell))
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
