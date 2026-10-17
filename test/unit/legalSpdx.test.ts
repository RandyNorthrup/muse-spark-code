// M97 lane S: SPDX expressions and the pinned identifier data. The
// parser accepts AND/OR/WITH, parentheses and LicenseRef terms against
// the vendored lists, and malformed text comes back as one quotable
// error, never a guess.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  canonicalExceptionId,
  canonicalLicenseId,
  isDeprecatedLicenseId,
  SPDX_DATA_VERSION,
  SPDX_DEPRECATED_EXCEPTIONS,
  SPDX_DEPRECATED_LICENSE_IDS,
  SPDX_EXCEPTIONS,
  SPDX_LICENSE_IDS,
  spdxProvenance,
} from '../../src/core/legal/data'
import { orAlternatives, parseSpdxExpression } from '../../src/core/legal/spdx'
import { LEGAL_VERSION_MAX_CHARS } from '../../src/shared/constants'

function okExpression(text: string) {
  const parsed = parseSpdxExpression(text)
  if (!parsed.ok) {
    throw new Error(`Expected ${text} to parse: ${parsed.error}`)
  }
  return parsed
}

function malformedError(text: string): string {
  const parsed = parseSpdxExpression(text)
  if (parsed.ok) {
    throw new Error(`Expected ${text} to be malformed`)
  }
  return parsed.error
}

describe('parseSpdxExpression', () => {
  it('parses a single identifier', () => {
    const parsed = okExpression('MIT')
    expect(parsed.licenses).toHaveLength(1)
    expect(parsed.licenses[0]?.canonicalId).toBe('MIT')
    expect(parsed.root).toEqual({
      kind: 'license',
      license: expect.objectContaining({ id: 'MIT' }),
    })
  })

  it('recognizes identifiers case-insensitively', () => {
    const parsed = okExpression('mit')
    expect(parsed.licenses[0]?.canonicalId).toBe('MIT')
  })

  it('parses OR and AND with parentheses', () => {
    const parsed = okExpression('MIT AND (Apache-2.0 OR BSD-3-Clause)')
    expect(parsed.root.kind).toBe('and')
    expect(parsed.licenses.map((license) => license.canonicalId)).toEqual([
      'MIT',
      'Apache-2.0',
      'BSD-3-Clause',
    ])
  })

  it('gives AND tighter binding than OR', () => {
    const parsed = okExpression('MIT AND Apache-2.0 OR BSD-3-Clause')
    expect(parsed.root).toEqual({
      kind: 'or',
      children: [
        { kind: 'and', children: [expect.anything(), expect.anything()] },
        expect.objectContaining({ kind: 'license' }),
      ],
    })
  })

  it('parses WITH exceptions against the pinned list', () => {
    const parsed = okExpression('GPL-2.0-only WITH Classpath-exception-2.0')
    const license = parsed.licenses[0]
    expect(license?.exception).toEqual({ id: 'Classpath-exception-2.0', known: true })
  })

  it('keeps unknown WITH exceptions visible', () => {
    const parsed = okExpression('GPL-2.0-only WITH Made-Up-exception')
    expect(parsed.licenses[0]?.exception).toEqual({ id: 'Made-Up-exception', known: false })
  })

  it('preserves LicenseRef and DocumentRef terms as custom', () => {
    const custom = okExpression('LicenseRef-My-License').licenses[0]
    expect(custom?.custom).toBe(true)
    expect(custom?.canonicalId).toBeUndefined()
    const document = okExpression('DocumentRef-doc:LicenseRef-x').licenses[0]
    expect(document?.custom).toBe(true)
  })

  it('reads deprecated identifiers and the trailing plus', () => {
    const deprecated = okExpression('GPL-2.0').licenses[0]
    expect(deprecated?.canonicalId).toBe('GPL-2.0')
    expect(deprecated?.deprecated).toBe(true)
    const plus = okExpression('GPL-2.0+').licenses[0]
    expect(plus?.plus).toBe(true)
    expect(plus?.id).toBe('GPL-2.0')
  })

  it('bounds expression length, depth and combinatorial alternatives', () => {
    expect(parseSpdxExpression('('.repeat(100) + 'MIT' + ')'.repeat(100)).ok).toBe(false)
    expect(parseSpdxExpression('MIT'.repeat(1000)).ok).toBe(false)
    expect(
      parseSpdxExpression(Array.from({ length: 10 }, () => '(MIT OR GPL-3.0-only)').join(' AND '))
        .ok,
    ).toBe(false)
    for (const text of ['MIT:', 'MIT++', 'LicenseRef-', 'DocumentRef-x', 'LicenseRef-x+'])
      expect(parseSpdxExpression(text).ok).toBe(false)
  })

  it('keeps unrecognized identifiers visible instead of guessing', () => {
    const unknown = okExpression('Foo-1.0').licenses[0]
    expect(unknown?.canonicalId).toBeUndefined()
    expect(unknown?.custom).toBe(false)
  })

  it.each([
    ['', 'Empty license expression'],
    ['MIT OR', 'Unexpected end'],
    ['(MIT', 'Missing closing'],
    ['MIT Apache-2.0', 'Unexpected text'],
    ['mit or apache', 'Unexpected text'],
    ['MIT)', 'Unexpected text'],
    ['AND MIT', 'Unexpected operator'],
    ['MIT WITH', 'WITH must name'],
    ['MIT WITH (Apache-2.0)', 'WITH must name'],
    ['MI@T', 'Unexpected character'],
    ['MIT OR OR Apache-2.0', 'Unexpected operator'],
  ])('rejects malformed expressions (%s)', (text, fragment) => {
    expect(malformedError(text)).toContain(fragment)
  })
})

describe('orAlternatives', () => {
  it('treats each OR branch as a choice', () => {
    const parsed = okExpression('MIT OR Apache-2.0')
    expect(orAlternatives(parsed.root)).toEqual([['MIT'], ['Apache-2.0']])
  })

  it('keeps AND branches together inside one alternative', () => {
    const parsed = okExpression('(MIT AND Apache-2.0) OR BSD-3-Clause')
    expect(orAlternatives(parsed.root)).toEqual([['MIT', 'Apache-2.0'], ['BSD-3-Clause']])
  })

  it('returns one alternative for a single license', () => {
    const parsed = okExpression('MIT')
    expect(orAlternatives(parsed.root)).toEqual([['MIT']])
  })
})

describe('pinned SPDX data', () => {
  it('covers the common identifiers and exceptions', () => {
    const listed1 = [
      'MIT',
      'Apache-2.0',
      'GPL-3.0-only',
      'BSD-3-Clause',
      'LGPL-2.1-only',
      'MPL-2.0',
    ]
    for (const id of listed1) {
      expect(SPDX_LICENSE_IDS.has(id)).toBe(true)
    }
    expect(SPDX_LICENSE_IDS.size).toBeGreaterThan(500)
    expect(SPDX_DEPRECATED_LICENSE_IDS.has('GPL-2.0')).toBe(true)
    expect(SPDX_EXCEPTIONS.has('Classpath-exception-2.0')).toBe(true)
    expect(SPDX_DEPRECATED_EXCEPTIONS.has('Nokia-Qt-exception-1.1')).toBe(true)
  })

  it('resolves canonical spellings and deprecation', () => {
    expect(canonicalLicenseId('mit')).toBe('MIT')
    expect(canonicalLicenseId('Foo-1.0')).toBeUndefined()
    expect(isDeprecatedLicenseId('GPL-2.0')).toBe(true)
    expect(isDeprecatedLicenseId('MIT')).toBe(false)
    expect(canonicalExceptionId('classpath-exception-2.0')).toBe('Classpath-exception-2.0')
    expect(canonicalExceptionId('Made-Up-exception')).toBeUndefined()
  })

  it('versions the dataset inside the shared bound with provenance', () => {
    expect(SPDX_DATA_VERSION.length).toBeLessThanOrEqual(LEGAL_VERSION_MAX_CHARS)
    const provenance = spdxProvenance()
    expect(provenance.dataVersion).toBe(SPDX_DATA_VERSION)
    const listed2 = provenance.datasets
    for (const dataset of listed2) {
      expect(dataset.sourceUrl).toMatch(/^https:\/\//)
      expect(dataset.vendoredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(dataset.license).not.toBe('')
      expect(dataset.attribution).not.toBe('')
      const listed3 = dataset.files
      for (const file of listed3) {
        const bytes = readFileSync(
          new URL(`../../src/core/legal/data/${file.path}`, import.meta.url),
        )
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256)
      }
    }
  })
})
