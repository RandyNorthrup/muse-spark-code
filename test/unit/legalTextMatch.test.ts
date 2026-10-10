// M97 C-M97-1: the pinned license-text matcher. Verbatim license texts
// match their canonical SPDX hashes exactly (holder and year lines aside);
// excerpts, modified texts and unknown prose stay heuristic or unmatched
// with the named full-matching incomplete reason downstream.

import { describe, expect, it } from 'vitest'
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

  it('reads the GPL suffix from the input wording over injected records', () => {
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
    expect(matchPinnedLicenseText(text, records)?.id).toBe('T-1.0-or-later')
    expect(matchPinnedLicenseText('Some grant text with no such clause.', records)?.id).toBe(
      'T-1.0-only',
    )
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

  it('keeps the GPL version and or-later readings', () => {
    expect(identifyLicenseText('GNU LIBRARY GENERAL PUBLIC LICENSE\nVersion 2\n')?.id).toBe(
      'LGPL-2.0-only',
    )
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
