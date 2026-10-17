// A minimal TOML reader (M97, PLAN.md D76): section tables with string
// and string-array values, plus `[[package]]` stanzas. It reads only the
// fields license evidence needs; anything more complex stays unread and
// is reported as such. Build files are never evaluated.

import type { LegalFileSnapshot } from '../files'

/** A section value: a quoted string, an inline table, or string items. */
export type TomlValue = string | readonly string[]

function stripTomlComment(line: string): string {
  let quote = ''
  let isEscaped = false
  for (let index = 0; index < line.length; index += 1) {
    if (isEscaped) {
      isEscaped = false
      continue
    }
    const char = line[index] ?? ''
    if (quote === '"' && char === '\\') {
      isEscaped = true
      continue
    }
    if (quote !== '') {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '#') return line.slice(0, index).trimEnd()
  }
  return line
}

/**
 * The key/value pairs of one `[section]` table. Multi-line arrays are
 * joined; nested tables, array tables and non-string values are skipped.
 */
export function parseTomlSection(text: string, section: string): Map<string, TomlValue> {
  const found = new Map<string, TomlValue>()
  const lines = text.split('\n').map((line) => stripTomlComment(line))
  let current = ''
  let index = 0
  while (index < lines.length) {
    const line = (lines[index] ?? '').trim()
    index += 1
    if (line === '' || line.startsWith('#')) {
      continue
    }
    const header = /^\[([^\s[\]]+)\]$/.exec(line)?.[1]
    if (header !== undefined) {
      current = header
      continue
    }
    if (current !== section) {
      continue
    }
    const assignment = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line)
    if (assignment?.[1] === undefined || assignment[2] === undefined) {
      continue
    }
    const key = assignment[1]
    let rest = assignment[2].trim()
    if (rest.startsWith('[')) {
      const items: string[] = []
      while (!rest.includes(']') && index < lines.length) {
        rest += `\n${lines[index] ?? ''}`
        index += 1
      }
      const quotedPattern = /"([^"]+)"|'([^']+)'/g
      const listed1 = rest.split('\n')
      for (const item of listed1) {
        quotedPattern.lastIndex = 0
        let quoted = quotedPattern.exec(item)
        while (quoted !== null) {
          const value = quoted[1] ?? quoted[2]
          if (value !== undefined) {
            items.push(value)
          }
          quoted = quotedPattern.exec(item)
        }
      }
      found.set(key, items)
      continue
    }
    const quoted = /^"([^"]*)"$/.exec(rest)?.[1] ?? /^'([^']*)'$/.exec(rest)?.[1]
    if (quoted !== undefined) {
      found.set(key, quoted)
      continue
    }
    if (rest.startsWith('{') && rest.endsWith('}')) {
      found.set(key, rest)
    }
  }
  return found
}

/** One field of an inline `{ key = "value" }` table. */
export function inlineTableField(table: string, field: string): string | undefined {
  for (const match of table.matchAll(/(?:^|[,{])\s*(file|text|version)\s*=\s*"([^"]+)"/g)) {
    if (match[1] === field) return match[2]
  }
  return undefined
}

/** One `[[package]]` stanza: a name, an optional version, optionality. */
export interface TomlPackageStanza {
  readonly name: string
  readonly version: string | undefined
  readonly optional: boolean
  /** The lock's source line (Cargo registries and git); absent for workspace members. */
  readonly source: string | undefined
}

/**
 * The `[[package]]` stanzas of `uv.lock`, `poetry.lock` and `Cargo.lock`:
 * names and versions only. Locks carry no license fields, so every entry
 * needs installed metadata to close its license gap.
 */
export function readTomlPackageStanzas(
  snapshot: LegalFileSnapshot,
  file: string,
): readonly TomlPackageStanza[] {
  const text = snapshot.readFile(file)
  if (text === undefined) {
    return []
  }
  const found: TomlPackageStanza[] = []
  let name: string | undefined
  let version: string | undefined
  let isOptional = false
  let source: string | undefined
  const commit = (): void => {
    if (name !== undefined) {
      found.push({ name, version, optional: isOptional, source })
    }
    name = undefined
    version = undefined
    isOptional = false
    source = undefined
  }
  const listed2 = text.split('\n')
  for (const raw of listed2) {
    const line = raw.trim()
    if (line === '[[package]]') {
      commit()
      continue
    }
    const quoted = /^([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/.exec(line)
    if (quoted?.[1] === undefined || quoted[2] === undefined) {
      const flag = /^([A-Za-z0-9_-]+)\s*=\s*(true|false)/.exec(line)
      if (flag?.[1] === 'optional') {
        isOptional = flag[2] === 'true'
      }
      continue
    }
    switch (quoted[1]) {
      case 'name': {
        name = quoted[2]
        continue
      }
      case 'version': {
        version = quoted[2]
        continue
      }
      case 'source': {
        source = quoted[2]
        continue
      }
      case 'optional': {
        isOptional = quoted[2] === 'true'
        continue
      }
    }
  }
  commit()
  return found
}

/** Every `[section]` header in a TOML document, in order. */
export function tomlSectionNames(text: string): string[] {
  const names: string[] = []
  const listed3 = text.split('\n')
  for (const raw of listed3) {
    const header = /^\[([^\s[\]]+)\]$/.exec(raw.trim())?.[1]
    if (header !== undefined && !names.includes(header)) {
      names.push(header)
    }
  }
  return names
}
