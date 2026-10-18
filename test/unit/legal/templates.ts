// Canonical texts from the pinned SPDX templates (M97 CM971-R3): each
// template rendered with every variable at its `original` value, with
// optional parts kept or dropped, so the matcher's tests run over every
// pinned template instead of hand-copied fixtures.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { SPDX_TEMPLATE_FILES } from '../../../src/core/legal/data'

const LEGAL_DATA = path.join(__dirname, '..', '..', '..', 'src', 'core', 'legal', 'legal-data')
const MARKUP =
  /<<(beginOptional|endOptional|var;name="[\s\S]*?";\s*original="([\s\S]*?)";[\s\S]*?)>>/gu

/** The pinned template ids, from the provenance record. */
export const PINNED_TEMPLATE_IDS: readonly string[] = SPDX_TEMPLATE_FILES.filter(
  (file) => file.kind === 'template',
).map((file) => path.posix.basename(file.path, '.template.txt'))

const sources = new Map<string, string>()

/** The raw pinned template markup for an SPDX id. */
function templateSource(id: string): string {
  const source =
    sources.get(id) ??
    readFileSync(path.join(LEGAL_DATA, 'templates', `${id}.template.txt`), 'utf8')
  sources.set(id, source)
  return source
}

/** Render a template: variables at their originals, optionals kept or dropped. */
export function canonicalText(
  id: string,
  isOptionalKept = true,
  replacement?: { readonly index: number; readonly value: string },
): string {
  let depth = 0
  let skipping = 0
  let out = ''
  let last = 0
  let variableIndex = 0
  const source = templateSource(id)
  for (const match of source.matchAll(MARKUP)) {
    if (skipping === 0) out += source.slice(last, match.index)
    last = match.index + match[0].length
    if (match[1] === 'beginOptional') {
      depth += 1
      if (!isOptionalKept && skipping === 0) skipping = depth
    } else if (match[1] === 'endOptional') {
      if (skipping === depth) skipping = 0
      depth -= 1
    } else {
      if (skipping === 0)
        out += replacement?.index === variableIndex ? replacement.value : (match[2] ?? '')
      variableIndex += 1
    }
  }
  return out + source.slice(last)
}
