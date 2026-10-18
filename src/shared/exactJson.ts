// Exact-money JSON reads (M121 P2-1). Version 1 journals and schedules wrote
// dollars as JSON numbers; a literal a double cannot carry (an edited or
// foreign file) must be refused, never rounded. `JSON.parse` revivers receive
// the literal's source text only on newer Node: the production host targets
// Node 20, whose two-argument reviver carries no source text, so exactness
// must not depend on it. The scanner below records every money-keyed numeric
// literal's written digits independently of the runtime; the parsed value is
// plain `JSON.parse` output, and `isExact` is false when a written literal
// does not denote the double it parses to.
import { canonicalUsd } from './usdSchema'

export interface ExactJsonRead {
  readonly value: unknown
  readonly isExact: boolean
}

/** A value is exact when its written decimal denotes the parsed double. */
function isSameDecimal(source: string, parsed: number): boolean {
  try {
    if (!Number.isFinite(parsed) || Object.is(parsed, -0)) return false
    const canonical = canonicalUsd(parsed)
    const exponent = Number(source.split(/e/i, 2)[1] ?? 0)
    // A matching decimal cannot need more exponent expansion than the input
    // digits plus the double's canonical digits. Refuse an unbounded expansion
    // before allocating it, including exotic zero literals.
    return (
      Number.isSafeInteger(exponent) &&
      Math.abs(exponent) <= source.length + canonical.length &&
      canonicalUsd(source) === canonical
    )
  } catch {
    // Exactness was not proved. A schema may accept the rounded value (even
    // underflowed zero), so it cannot decide whether the written money was lost.
    return false
  }
}

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}

/** `\u` plus its four hex digits. */
const UNICODE_ESCAPE_LENGTH = 6

/** The only whitespace JSON allows outside strings. */
const JSON_WHITESPACE: ReadonlySet<string> = new Set([' ', '\t', '\n', '\r'])

/** Decode one JSON string starting at `start` (the opening quote). */
function scanString(text: string, start: number): { readonly value: string; readonly end: number } {
  let result = ''
  let index = start + 1
  while (index < text.length) {
    const char = text[index]
    if (char === '"') return { value: result, end: index + 1 }
    if (char !== '\\') {
      result += char ?? ''
      index += 1
      continue
    }
    const escape = text[index + 1] ?? ''
    if (escape === 'u') {
      result += String.fromCodePoint(
        Number.parseInt(text.slice(index + 2, index + UNICODE_ESCAPE_LENGTH), 16),
      )
      index += UNICODE_ESCAPE_LENGTH
      continue
    }
    result += SIMPLE_ESCAPES[escape] ?? escape
    index += 2
  }
  return { value: result, end: index }
}

const NUMBER_CHAR = /[-+0-9.eE]/

function scanNumberEnd(text: string, start: number): number {
  let index = start
  while (NUMBER_CHAR.test(text[index] ?? '')) index += 1
  return index
}

/**
Record the source text of every numeric literal held under a money key,
keyed by its path (decoded object keys and array indices) so document order
and integer-like key reordering cannot misalign a comparison. Runs only on
text `JSON.parse` has already accepted, so escapes and structure are valid.
*/
function scanSources(
  text: string,
  moneyKeys: ReadonlySet<string>,
): Map<string, { readonly source: string }> {
  const sources = new Map<string, { readonly source: string }>()
  const path: (string | number)[] = []
  let index = 0
  const skipGap = (): void => {
    while (JSON_WHITESPACE.has(text[index] ?? '')) index += 1
  }
  const parseValue = (): void => {
    skipGap()
    const char = text[index]
    if (char === '"') {
      index = scanString(text, index).end
      return
    }
    if (char === '{') {
      index += 1
      skipGap()
      if (text[index] === '}') {
        index += 1
        return
      }
      while (index < text.length) {
        skipGap()
        const key = scanString(text, index)
        index = key.end
        skipGap()
        index += 1 // The colon: `JSON.parse` has already validated the text.
        path.push(key.value)
        parseValue()
        path.pop()
        skipGap()
        const next = text[index]
        index += 1
        if (next !== ',') return
      }
      return
    }
    if (char === '[') {
      index += 1
      skipGap()
      if (text[index] === ']') {
        index += 1
        return
      }
      let member = 0
      while (index < text.length) {
        path.push(member)
        parseValue()
        path.pop()
        member += 1
        skipGap()
        const next = text[index]
        index += 1
        if (next !== ',') return
      }
      return
    }
    const end = scanNumberEnd(text, index)
    if (end > index) {
      const last = path.at(-1)
      if (typeof last === 'string' && moneyKeys.has(last))
        sources.set(JSON.stringify(path), { source: text.slice(index, end) })
      index = end
      return
    }
    // A literal (`true`, `false`, `null`): skip its letters.
    while (text[index] !== undefined && /[a-z]/.test(text[index] ?? '')) index += 1
  }
  parseValue()
  return sources
}

function collectNumbers(
  value: unknown,
  moneyKeys: ReadonlySet<string>,
  path: (string | number)[],
  out: Map<string, number>,
): void {
  if (typeof value === 'number') {
    const last = path.at(-1)
    if (typeof last === 'string' && moneyKeys.has(last)) out.set(JSON.stringify(path), value)
    return
  }
  if (Array.isArray(value)) {
    for (const [memberIndex, member] of value.entries())
      collectNumbers(member, moneyKeys, [...path, memberIndex], out)
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, member] of Object.entries(value))
      collectNumbers(member, moneyKeys, [...path, key], out)
  }
}

/**
Parse stored JSON, keeping each money-keyed numeric literal's source text.
`isExact` is false when a written literal cannot denote the double it
parses to, on every Node version. Invalid text throws, as `JSON.parse` does.
*/
export function parseJsonWithExactNumbers(
  text: string,
  moneyKeys: ReadonlySet<string>,
): ExactJsonRead {
  const value: unknown = JSON.parse(text)
  const sources = scanSources(text, moneyKeys)
  const numbers = new Map<string, number>()
  collectNumbers(value, moneyKeys, [], numbers)
  // On valid JSON both passes visit the same literals; a mismatch means the
  // scan failed, so the record is refused rather than trusted.
  if (sources.size !== numbers.size) return { value, isExact: false }
  for (const [path, source] of sources) {
    const parsed = numbers.get(path)
    if (parsed === undefined || !isSameDecimal(source.source, parsed))
      return { value, isExact: false }
  }
  return { value, isExact: true }
}
