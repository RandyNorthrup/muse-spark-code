// M97 C-M97-1: the pinned license-text matcher. Verbatim license texts
// match their canonical SPDX hashes exactly (holder and year lines aside);
// excerpts, modified texts and unknown prose stay heuristic or unmatched
// with the named full-matching incomplete reason downstream.

import { describe, expect, it } from 'vitest'
import { fingerprint } from '../../src/core/verify/fingerprint'
import { SPDX_LICENSE_TEXTS, spdxProvenance } from '../../src/core/legal/data'
import {
  identifyLicenseText,
  matchPinnedLicenseText,
  normalizeLicenseText,
} from '../../src/core/legal/projectLicense'
import { FULL_MIT_LICENSE, snapshotFrom } from './legal/helpers'
import { scanProjectLicense } from '../../src/core/legal/projectLicense'

const MIT_EXCERPT = `MIT License

Copyright (c) 2026 Example Corp

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction.`

const MIT_MODIFIED = `${FULL_MIT_LICENSE}
You must also pay the author one dollar per installed copy.
`

const MIT_BODY_ONLY = FULL_MIT_LICENSE.split('\n')
  .filter((line) => !/mit license/i.test(line))
  .join('\n')

const INSERTED_RESTRICTIONS: readonly string[] = [
  'You must also pay the author one dollar per installed copy.',
  'Copyright owners prohibit commercial use without a separate licence.',
  '© 2026 Example Corp. A fee of $1 per copy is required.',
  '(c) 2026 Example Corp. All rights reserved for commercial exploitation.',
  'All rights reserved.',
  'Commercial use requires a paid licence. Contact the authors.',
  'THE SOFTWARE MAY NOT BE USED FOR MILITARY PURPOSES.',
]

describe('normalizeLicenseText', () => {
  it('is stable across line endings, byte-order marks and holder lines', () => {
    const unix = normalizeLicenseText(FULL_MIT_LICENSE)
    const crlf = FULL_MIT_LICENSE.replaceAll('\n', '\r\n').replace(
      '2026 Example Corp',
      '1999 Someone Else',
    )
    expect(normalizeLicenseText(crlf)).toBe(unix)
    expect(normalizeLicenseText(String.fromCodePoint(0xfe_ff) + crlf)).toBe(unix)
    expect(unix).not.toContain('example corp')
    expect(unix.split(' ').length).toBeGreaterThan(100)
  })
})

describe('matchPinnedLicenseText', () => {
  it('matches a verbatim MIT text exactly regardless of the holder', () => {
    const match = matchPinnedLicenseText(FULL_MIT_LICENSE)
    expect(match).toMatchObject({ id: 'MIT', confidence: 1, exact: true })
  })

  it('matches a CRLF verbatim text exactly', () => {
    const match = matchPinnedLicenseText(FULL_MIT_LICENSE.replaceAll('\n', '\r\n'))
    expect(match).toMatchObject({ id: 'MIT', confidence: 1, exact: true })
  })

  it('reads a modified text heuristically, never as exact', () => {
    const match = matchPinnedLicenseText(MIT_MODIFIED)
    expect(match?.id).toBe('MIT')
    expect(match?.exact).toBe(false)
    expect(match?.differs?.canonicalId).toBe('MIT')
  })

  it('keeps a Copyright-headed restriction in the match text (RVCM971 P1)', () => {
    const restricted = `${FULL_MIT_LICENSE}Copyright owners prohibit commercial use without a separate licence.\n`
    const match = matchPinnedLicenseText(restricted)
    expect(match?.exact).not.toBe(true)
    expect(match?.differs?.canonicalId).toBe('MIT')
  })

  it('keeps a © payment requirement in the match text (RVCM971 P1)', () => {
    const restricted = `${FULL_MIT_LICENSE}© 2026 Example Corp. A fee of $1 per copy is required.\n`
    const match = matchPinnedLicenseText(restricted)
    expect(match?.exact).not.toBe(true)
    expect(match?.differs?.canonicalId).toBe('MIT')
  })

  it.each(INSERTED_RESTRICTIONS)(
    'never reads MIT with an inserted restriction (%s) as exact',
    (restriction) => {
      const lines = FULL_MIT_LICENSE.split('\n')
      const variants = [
        `${restriction}\n${FULL_MIT_LICENSE}`,
        `${lines[0] ?? ''}\n${restriction}\n${lines.slice(1).join('\n')}`,
        `${FULL_MIT_LICENSE}\n${restriction}`,
      ]
      for (const variant of variants) {
        expect(matchPinnedLicenseText(variant)?.exact).not.toBe(true)
      }
    },
  )

  it('never reads any pinned text with an inserted restriction as exact', () => {
    // CM971R2 follow-up: the property holds for every pinned record, not
    // only MIT. Each record's phrases plus neutral filler stand in for its
    // canonical text (full texts stay out of the repo): the filler text
    // matches its registered hash exactly, and every restriction-inserted
    // variant must read as differs, never as exact. A normalizer that
    // drops restriction lines fails this the same way the old one did.
    for (const record of SPDX_LICENSE_TEXTS) {
      const base = `${record.id} terms. ${record.phrases.join('. ')}. Sample neutral wording without distinctive phrases.`
      const normalized = normalizeLicenseText(base)
      const records = [
        { ...record, hash: fingerprint(normalized), words: normalized.split(' ').length },
      ]
      const verbatim = matchPinnedLicenseText(base, records)
      expect(verbatim?.exact, `${record.id} verbatim`).toBe(true)
      expect(verbatim?.id, `${record.id} verbatim`).toBe(record.id)
      const sentences = base.split('. ')
      for (const restriction of INSERTED_RESTRICTIONS) {
        const variants = [
          `${restriction} ${base}`,
          `${sentences[0] ?? ''}. ${restriction} ${sentences.slice(1).join('. ')}`,
          `${base} ${restriction}`,
        ]
        for (const variant of variants) {
          const match = matchPinnedLicenseText(variant, records)
          expect(match?.exact, `${record.id} with ${restriction}`).not.toBe(true)
          expect(match?.differs?.canonicalId, `${record.id} with ${restriction}`).toBe(record.id)
        }
      }
    }
  })

  it('prefers the closer word count for shared BSD phrases', () => {
    const shared =
      'Redistribution and use in source and binary forms. This software is provided by the copyright holders and contributors as is.'
    const match = matchPinnedLicenseText(shared)
    expect(match?.id).toBe('BSD-2-Clause')
    expect(match?.exact).toBe(false)
  })

  it('leaves unknown prose unmatched', () => {
    expect(matchPinnedLicenseText('The Example License grants nothing yet.')).toBeUndefined()
    expect(matchPinnedLicenseText('')).toBeUndefined()
  })

  it('matches nothing with an empty record list, failing closed', () => {
    expect(matchPinnedLicenseText(FULL_MIT_LICENSE, [])).toBeUndefined()
  })

  it('reads the GPL stem without a variant suffix, even over body wording', () => {
    // RVCM971 P2 (finding 5): `any later version` in the body never grants
    // `-or-later`; the variant resolves from the project's own grant.
    const text = 'Some grant text mentioning any later version of the terms.'
    const records = [
      {
        id: 'T-1.0',
        hash: '00',
        words: 3,
        phrases: ['some grant text'] as readonly string[],
        family: 'gpl' as const,
      },
    ]
    expect(matchPinnedLicenseText(text, records)?.id).toBe('T-1.0')
    expect(matchPinnedLicenseText('Some grant text with no such clause.', records)?.id).toBe(
      'T-1.0',
    )
  })

  it('returns the bare GPL stem for an exact body match', () => {
    const body = 'Some grant text with several distinctive words here.'
    const records = [
      {
        id: 'T-2.0',
        hash: fingerprint(normalizeLicenseText(body)),
        words: normalizeLicenseText(body).split(' ').length,
        phrases: ['several distinctive words'] as readonly string[],
        family: 'gpl' as const,
      },
    ]
    const exact = matchPinnedLicenseText(`${body} or (at your option) any later version.`, records)
    expect(exact?.exact).toBe(false)
    const verbatim = matchPinnedLicenseText(body, records)
    expect(verbatim).toMatchObject({ id: 'T-2.0', confidence: 1, exact: true })
  })
})

describe('identifyLicenseText with pinned data', () => {
  it('keeps heuristic readings for excerpts, marked inexact', () => {
    const match = identifyLicenseText(MIT_EXCERPT)
    expect(match).toMatchObject({ id: 'MIT', exact: false })
  })

  it('falls back to pinned phrases when the title line is missing', () => {
    const match = identifyLicenseText(MIT_BODY_ONLY)
    expect(match?.id).toBe('MIT')
    expect(match?.exact).toBe(false)
  })

  it('keeps the GPL version reading without a variant suffix', () => {
    // RVCM971 P2 (finding 5): the heuristic reads the bare stem; the
    // `-only`/`-or-later` variant resolves from the project's own grant.
    expect(identifyLicenseText('GNU LIBRARY GENERAL PUBLIC LICENSE\nVersion 2\n')?.id).toBe(
      'LGPL-2.0',
    )
    expect(
      identifyLicenseText(
        'GNU GENERAL PUBLIC LICENSE\nVersion 3\nor (at your option) any later version.',
      )?.id,
    ).toBe('GPL-3.0')
  })

  it('fails closed to heuristics with an empty record list', () => {
    const match = identifyLicenseText(FULL_MIT_LICENSE, [])
    expect(match).toMatchObject({ id: 'MIT', exact: false })
  })
})

describe('pinned text data provenance', () => {
  it('carries well-formed records sorted by text key', () => {
    expect(SPDX_LICENSE_TEXTS.length).toBeGreaterThanOrEqual(15)
    const ids = SPDX_LICENSE_TEXTS.map((record) => record.id)
    expect(ids).toEqual([...ids].toSorted((a, b) => a.localeCompare(b, 'en')))
    for (const record of SPDX_LICENSE_TEXTS) {
      expect(record.hash).toMatch(/^[0-9a-f]{64}$/)
      expect(record.words).toBeGreaterThan(50)
      expect(record.phrases.length).toBeGreaterThanOrEqual(3)
      for (const phrase of record.phrases) {
        expect(phrase).toBe(phrase.toLowerCase())
        expect(phrase).not.toMatch(/[^a-z0-9 ]/)
      }
    }
  })

  it('records the text dataset beside the identifier datasets', () => {
    const dataset = spdxProvenance().datasets.find((entry) => entry.name === 'spdx-license-texts')
    expect(dataset?.version).toBe('3.28.0')
    expect(dataset?.sourceUrl).toMatch(/^https:\/\//)
    expect(dataset?.vendoredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('keeps the heuristic caveat for excerpt license files', () => {
    const result = scanProjectLicense(snapshotFrom({ LICENSE: MIT_EXCERPT }), [])
    expect(result.licenses).toEqual(['MIT'])
    expect(result.incomplete.join(' ')).toContain('full SPDX text matching')
  })

  it('lifts the heuristic caveat for a verbatim license file', () => {
    const result = scanProjectLicense(snapshotFrom({ LICENSE: FULL_MIT_LICENSE }), [
      { file: 'package.json', raw: 'MIT' },
    ])
    expect(result.findings).toEqual([])
    expect(result.licenses).toEqual(['MIT'])
    expect(result.incomplete).toEqual([])
  })
})
