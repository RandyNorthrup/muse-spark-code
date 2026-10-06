import {
  L10N_COMPACT_FRAGMENT_WORDS,
  L10N_COMPACT_TOKEN_FIRST,
  L10N_COMPACT_TOKEN_LAST,
} from '../constants'

interface EnglishTree {
  readonly [key: string]: string | EnglishTree
}

const encoder = new TextEncoder()
const bytes = (value: string): number => encoder.encode(value).byteLength

function occurrences(value: string, term: string): number {
  let count = 0
  let position = value.indexOf(term)
  while (position !== -1) {
    count += 1
    position = value.indexOf(term, position + term.length)
  }
  return count
}

/** Build-only lossless encoding; the complete browser fallback stays inline. */
export function compactEnglishSource(english: EnglishTree): string {
  const strings: { original: string; value: string; key: boolean }[] = []
  const tokenPattern = new RegExp(
    `[${String.fromCodePoint(L10N_COMPACT_TOKEN_FIRST)}-${String.fromCodePoint(L10N_COMPACT_TOKEN_LAST)}]`,
    'g',
  )
  const collect = (table: EnglishTree): void => {
    for (const [key, value] of Object.entries(table)) {
      strings.push({ original: key, value: key, key: true })
      if (typeof value === 'string') strings.push({ original: value, value, key: false })
      else collect(value)
    }
  }
  collect(english)
  if (strings.some(({ value }) => value.match(tokenPattern))) {
    throw new Error('English fallback contains a reserved dictionary token')
  }
  const counts = new Map<string, number>()
  for (const { value, key } of strings) {
    const words: RegExpExecArray[] = []
    const matches = value.matchAll(
      key ? /[A-Z]?[a-z]+|[A-Z]+(?![a-z])|[0-9]+/g : /[A-Za-z][A-Za-z0-9]*/g,
    )
    for (const word of matches) words.push(word)
    for (const [index, first] of words.entries()) {
      const endings = words.slice(index, index + L10N_COMPACT_FRAGMENT_WORDS)
      for (const last of endings) {
        const term = value.slice(first.index, last.index + last[0].length)
        counts.set(term, (counts.get(term) ?? 0) + 1)
      }
    }
  }
  const tokenBytes = bytes(String.fromCodePoint(L10N_COMPACT_TOKEN_FIRST))
  const saving = (term: string, count: number): number =>
    count * (bytes(term) - tokenBytes) - bytes(JSON.stringify(term)) - 1
  const candidates = [...counts]
    .map(([term, count]) => ({ term, score: saving(term, count) }))
    .filter(({ score }) => score > 0)
    .toSorted((a, b) => b.score - a.score)
  const dictionary: string[] = []
  for (const { term } of candidates) {
    const count = strings.reduce((sum, entry) => sum + occurrences(entry.value, term), 0)
    if (saving(term, count) <= 0) continue
    const token = String.fromCodePoint(L10N_COMPACT_TOKEN_FIRST + dictionary.length)
    dictionary.push(term)
    for (const entry of strings) {
      if (entry.value.includes(term)) entry.value = entry.value.replaceAll(term, () => token)
    }
    if (dictionary.length === L10N_COMPACT_TOKEN_LAST - L10N_COMPACT_TOKEN_FIRST + 1) break
  }
  const encodedStrings = new Map(strings.map(({ original, value }) => [original, value]))
  const encode = (table: EnglishTree): EnglishTree =>
    Object.fromEntries(
      Object.entries(table).map(([key, value]) => [
        encodedStrings.get(key) ?? key,
        typeof value === 'string' ? (encodedStrings.get(value) ?? value) : encode(value),
      ]),
    )
  // Only canonical build-time English is decoded; no user input reaches this.
  return `const words=${JSON.stringify(dictionary)};
function decode(value){return value.replace(${tokenPattern.toString()},c=>words[c.charCodeAt(0)-${String(L10N_COMPACT_TOKEN_FIRST)}])}
function unpack(table){return Object.fromEntries(Object.entries(table).map(([key,value])=>[decode(key),typeof value==='string'?decode(value):unpack(value)]))}
export const EN=unpack(${JSON.stringify(encode(english))});`
}
