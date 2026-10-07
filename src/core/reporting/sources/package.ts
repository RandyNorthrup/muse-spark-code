import * as z from 'zod/mini'
import { REPORT_MAX_ROWS, REPORT_MAX_TEXT_CHARS } from '../../../shared/constants'
import {
  codeUnitCompare,
  localSource,
  LocalSourceError,
  type LocalFileIo,
  type SourceScrub,
} from './local'

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string().check(z.maxLength(REPORT_MAX_TEXT_CHARS))),
})

function escapeGlobLiteral(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

/** A `**` pair ending just before crossed: the crossing source and next index. */
function readDoubleStar(token: string, crossed: number): { source: string; next: number } {
  const after = token[crossed]
  return after === ':' || after === '/'
    ? { source: '(?:.*[:/])?', next: crossed + 1 }
    : { source: '.*', next: crossed }
}

/** Stars at index: `*` stays inside a segment while `**` crosses segments. */
function readStars(token: string, index: number): { source: string; next: number } {
  return token[index + 1] === '*'
    ? readDoubleStar(token, index + 2)
    : { source: '[^:/]*', next: index + 1 }
}

/** `[...]` at index: the class source and next index, or undefined when invalid. */
function readClass(token: string, index: number): { source: string; next: number } | undefined {
  const close = token.indexOf(']', index + 1)
  if (close === -1) return undefined
  const body = token.slice(index + 1, close)
  const isNegated = body.startsWith('!') || body.startsWith('^')
  const tested = `[${isNegated ? `^${body.slice(1)}` : body}]`
  try {
    new RegExp(tested)
  } catch {
    return undefined
  }
  return { source: tested, next: close + 1 }
}

/** Index of the brace closing the `{` at index, or -1 when unbalanced. */
function braceClose(token: string, index: number): number {
  let depth = 0
  for (let cursor = index + 1; cursor < token.length; cursor += 1) {
    if (token[cursor] === '{') depth += 1
    else if (token[cursor] === '}') {
      if (depth === 0) return cursor
      depth -= 1
    }
  }
  return -1
}

/** `{a,b}` at index: the alternation source and next index, or undefined. */
function readBraces(token: string, index: number): { source: string; next: number } | undefined {
  const close = braceClose(token, index)
  if (close === -1) return undefined
  const body = token.slice(index + 1, close)
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of body) {
    if (char === '{') depth += 1
    else if (char === '}') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else current += char
  }
  parts.push(current)
  if (parts.length < 2) return undefined
  const translated: string[] = []
  for (const part of parts) {
    const alternative = globSource(part)
    if (alternative === undefined) return undefined
    translated.push(alternative)
  }
  return { source: `(?:${translated.join('|')})`, next: close + 1 }
}

/** The source for the shape at index, or undefined for an unsupported token. */
function nextGlobSource(
  token: string,
  index: number,
): { source: string; next: number } | undefined {
  const char = token[index]
  switch (char) {
    case '*': {
      return readStars(token, index)
    }
    case '?': {
      return { source: '[^:/]', next: index + 1 }
    }
    case '[': {
      return readClass(token, index)
    }
    case '{': {
      return readBraces(token, index)
    }
    default: {
      return char === undefined ? undefined : { source: escapeGlobLiteral(char), next: index + 1 }
    }
  }
}

/** One glob token to a source string; undefined when the token is not a supported glob. */
function globSource(token: string): string | undefined {
  let source = ''
  let index = 0
  while (index < token.length) {
    const step = nextGlobSource(token, index)
    if (step === undefined) return undefined
    source += step.source
    index = step.next
  }
  return source
}

/**
 * The npm-run-all2 task matcher without the dependency: `:` separates
 * segments, so `*` and `?` never cross it while `**` does. Unsupported
 * tokens fall back to an exact name, never a prefix. Expectations below
 * were captured from the installed npm-run-all2 9.0.3 matchTasks.
 */
export function matchTaskNames(names: readonly string[], token: string): readonly string[] {
  if (!token.includes('*') && !token.includes('?') && !token.includes('[') && !token.includes('{'))
    return names.filter((name) => name === token)
  const source = globSource(token)
  if (source === undefined) return names.filter((name) => name === token)
  let pattern: RegExp
  try {
    pattern = new RegExp(`^${source}$`)
  } catch {
    return names.filter((name) => name === token)
  }
  return names.filter((name) => pattern.test(name))
}
/** Declarations only. A report never starts a check or runs a package script. */
export function packageSource(io: LocalFileIo, scrub: SourceScrub) {
  return localSource('package', async ({ signal }) => {
    const raw: unknown = JSON.parse(await io.read('package.json', signal))
    const { scripts } = packageSchema.parse(raw)
    if (Object.keys(scripts).length > REPORT_MAX_ROWS) throw new LocalSourceError('limit')
    const included = new Set<string>()
    const visit = (name: string) => {
      if (included.has(name)) return
      const command = scripts[name]
      if (command === undefined) return
      included.add(name)
      // Covers npm run and this repository's npm-run-all2 run-s/run-p declarations.
      for (const match of command.matchAll(/\bnpm(?:\.cmd)? run ([\w:.-]+)/gu))
        visit(match[1] ?? '')
      for (const match of command.matchAll(/\b(?:run-s|run-p)\s+([^&|;]+)/gu)) {
        const tokens = (match[1] ?? '').trim().split(/\s+/u)
        const names = Object.keys(scripts)
        for (const token of tokens) {
          if (token.startsWith('-')) continue
          const matched = matchTaskNames(names, token)
          for (const key of matched) visit(key)
        }
      }
    }
    visit('quality')
    if (included.size === 0) throw new LocalSourceError('missing')
    return {
      data: {
        qualityScripts: [...included]
          .toSorted(codeUnitCompare)
          .map((name) => ({ name: scrub(name), command: scrub(scripts[name] ?? '') })),
      },
    }
  })
}
