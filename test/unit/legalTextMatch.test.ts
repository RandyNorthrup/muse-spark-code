// M97 CM971-R3: licence texts match the official SPDX templates under the
// SPDX License List Matching Guidelines. Exact means every fixed token of
// a pinned template is present in order with only its variable and
// optional parts varying, each variable holding just what it stands for;
// anything else is "differs: human review" with the differing span. The
// property test inserts a restriction sentence into every pinned
// template's canonical text and never accepts the result as exact.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SPDX_TEMPLATE_FILES, spdxProvenance } from '../../src/core/legal/data'
import {
  licenseTemplateSet,
  loadLicenseTemplates,
  readLicenseText,
} from '../../src/core/legal/licenseTemplates'
import { identifyLicenseText, scanProjectLicense } from '../../src/core/legal/projectLicense'
import { UI_TEXT } from '../../src/shared/constants'
import { FULL_MIT_LICENSE, snapshotFrom } from './legal/helpers'
import { PINNED_TEMPLATE_IDS, canonicalText } from './legal/templates'

const LEGAL_DATA = path.join(__dirname, '..', '..', 'src', 'core', 'legal', 'legal-data')
const MIT_COPYRIGHT = 'Copyright (c) 2026 Example Corp'

/** Restriction sentences in several shapes and scripts. */
const RESTRICTIONS: readonly string[] = [
  'For educational purposes only.',
  'Nonprofit projects only.',
  'No AI training.',
  'Commercial use requires a paid license from the authors.',
  'You must pay the author one dollar per installed copy.',
  'This software may not be used by the military.',
  'Redistribution is limited to members of Example Corp.',
  'Copyright owners may not be used for commercial purposes.',
  'COMMERCIAL USE REQUIRES A FEE.',
  'Use of this software in Example Country is prohibited!',
  '仅限非商业用途。',
  '使用を教育目的に限定する。',
  'Коммерческое использование запрещено.',
]

/** Restriction vocabulary glued into a holder's name, with no full stop. */
const GLUED_RESTRICTIONS: readonly string[] = [
  'Example Nonprofit Projects Only',
  'Example Corp Noncommercial Use Only',
  'Example Educational Use',
  'Example Corp NO AI',
  'Example Personal Use Only',
  'Example Non-Commercial Ltd',
  'Example Corp, nonprofit',
  'EXAMPLE NONPROFIT',
  'Example Academic Research Only',
  'Example Corp Without Military',
]

/** Holder placeholders in the canonical (template original) texts. */
const HOLDER_PLACEHOLDERS: readonly string[] = [
  '<copyright holders>',
  '<owner>',
  '<copyright notice>',
  '[name of copyright owner]',
  '<name of author>',
]

/** Deterministic pseudo-random numbers (a 32-bit LCG), so failures replay. */
function random(seed: number): () => number {
  let state = seed
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 4_294_967_296
  }
}

/** Every place a sentence can start: line starts, after sentence ends, at the end. */
function sentenceBoundaries(text: string): number[] {
  const offsets = new Set<number>([0, text.length])
  for (const match of text.matchAll(/\n|[.:;]\s/gu)) offsets.add(match.index + match[0].length)
  return [...offsets].toSorted((a, b) => a - b)
}

describe('SPDX template matching', () => {
  it('loads all twenty pinned templates with every hash verified', () => {
    const set = licenseTemplateSet()
    expect(set.problems).toEqual([])
    expect(set.templates).toHaveLength(PINNED_TEMPLATE_IDS.length)
    expect(PINNED_TEMPLATE_IDS).toHaveLength(20)
  })

  it.each(PINNED_TEMPLATE_IDS)(
    'matches %s canonical text exactly, optionals kept or dropped',
    (id) => {
      for (const isKept of [true, false]) {
        const reading = readLicenseText(canonicalText(id, isKept))
        expect(reading?.exact).toBe(true)
        expect(reading?.key).toBe(id.replace(/-(?:only|or-later)$/u, ''))
      }
    },
  )

  it('matches real-world MIT copies exactly: titles, holders, line endings, BOM, comments', () => {
    const variants = [
      FULL_MIT_LICENSE,
      FULL_MIT_LICENSE.replaceAll('\n', '\r\n'),
      `\u{FEFF}${FULL_MIT_LICENSE}`,
      FULL_MIT_LICENSE.replace('MIT License', 'The MIT License (MIT)'),
      FULL_MIT_LICENSE.replace(
        MIT_COPYRIGHT,
        'Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)',
      ),
      FULL_MIT_LICENSE.replace(
        MIT_COPYRIGHT,
        'Copyright Joyent, Inc. and other Node contributors. All rights reserved.',
      ),
      FULL_MIT_LICENSE.replace(
        MIT_COPYRIGHT,
        'Copyright (c) 2014-2026 J. Doe\nCopyright (c) Example Ltd.',
      ),
      FULL_MIT_LICENSE.split('\n')
        .map((line) => `// ${line}`)
        .join('\n'),
    ]
    for (const text of variants)
      expect(identifyLicenseText(text)).toMatchObject({ id: 'MIT', exact: true })
  })

  it.each([
    ['educational', `${MIT_COPYRIGHT}. For educational purposes only.`],
    ['nonprofit', '© 2026 Example Corp. Nonprofit projects only.'],
    ['no AI training', 'Copyright 2026 Example Corp. No AI training.'],
    [
      'Copyright-headed restriction',
      `${MIT_COPYRIGHT}\nCopyright owners may not use this commercially.`,
    ],
    ['© payment', `${MIT_COPYRIGHT}\n© Each copy costs $5, payable to the copyright holder.`],
    ['Chinese prose', `${MIT_COPYRIGHT}\n仅限非商业用途。`],
    ['Japanese prose', `${MIT_COPYRIGHT} 使用を教育目的に限定する。`],
    ['capitals run', `${MIT_COPYRIGHT} NO COMMERCIAL USE`],
  ])(
    'never reads a restriction in the copyright notice as exact: %s (RVCM971/B P1)',
    (_name, notice) => {
      const match = identifyLicenseText(FULL_MIT_LICENSE.replace(MIT_COPYRIGHT, () => notice))
      expect(match).toMatchObject({ id: 'MIT', exact: false })
      expect(match?.differs?.canonicalId).toBe('MIT')
      expect(match?.differs?.span).not.toBe('')
    },
  )

  it('ignores a title line written after the copyright line', () => {
    const text = FULL_MIT_LICENSE.replace(
      `MIT License\n\n${MIT_COPYRIGHT}`,
      () => `${MIT_COPYRIGHT}\n\nMIT License`,
    )
    expect(identifyLicenseText(text)).toMatchObject({ id: 'MIT', exact: true })
  })

  it('quotes the variable where a text stops short of the template', () => {
    const text = FULL_MIT_LICENSE.replace(/SOFTWARE\.\n$/u, 'SOFTWARE\n')
    const match = identifyLicenseText(text)
    expect(match?.exact).toBe(false)
    expect(match?.differs?.expected).toContain('<Software8>')
  })

  it('ignores a title line made only of the license name, and nothing more', () => {
    const bsd = canonicalText('BSD-3-Clause')
    expect(readLicenseText(`BSD 3-Clause License\n\n${bsd}`)?.exact).toBe(true)
    expect(readLicenseText(`BSD 3-Clause License, noncommercial\n\n${bsd}`)?.exact).toBe(false)
  })

  it.each(GLUED_RESTRICTIONS)(
    'never reads restriction vocabulary glued into the holder as exact: %s',
    (holder) => {
      const notice = `Copyright 2026 ${holder}`
      expect(
        identifyLicenseText(FULL_MIT_LICENSE.replace(MIT_COPYRIGHT, () => notice)),
      ).toMatchObject({
        id: 'MIT',
        exact: false,
      })
    },
  )

  it('never reads any pinned holder placeholder with glued restriction vocabulary as exact (property)', () => {
    let covered = 0
    for (const id of PINNED_TEMPLATE_IDS) {
      const base = canonicalText(id)
      const placeholder = HOLDER_PLACEHOLDERS.find((entry) => base.includes(entry))
      if (placeholder === undefined) continue
      covered += 1
      for (const holder of GLUED_RESTRICTIONS) {
        const reading = readLicenseText(base.replace(placeholder, () => holder))
        if (reading?.exact === true) throw new Error(`${id} read as exact with holder "${holder}"`)
      }
    }
    expect(covered).toBeGreaterThanOrEqual(8)
    for (const id of ['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC']) {
      const base = canonicalText(id)
      const placeholder = HOLDER_PLACEHOLDERS.find((entry) => base.includes(entry)) ?? ''
      const holder = id === 'ISC' ? 'Copyright (c) 2026 Example Corp' : 'Example Corp'
      expect(readLicenseText(base.replace(placeholder, () => holder))?.exact).toBe(true)
    }
  })

  it('never reads a restriction in a name variable as exact', () => {
    const text = FULL_MIT_LICENSE.replace(
      'THE AUTHORS OR COPYRIGHT HOLDERS BE',
      'THE AUTHORS. COMMERCIAL USE REQUIRES A FEE. BE',
    )
    expect(identifyLicenseText(text)).toMatchObject({ exact: false })
  })

  it('quotes the differing span and the template continuation', () => {
    const text = FULL_MIT_LICENSE.replace(
      'portions of the Software.',
      'portions of the Software. Each copy requires a payment of $5.',
    )
    const match = identifyLicenseText(text)
    expect(match?.differs).toMatchObject({ canonicalId: 'MIT' })
    expect(match?.differs?.span).toContain('Each copy requires a payment of $5.')
    expect(match?.differs?.expected).toContain('provided')
  })

  it('treats text after the end of a license as a difference, never as extraneous', () => {
    for (const restriction of RESTRICTIONS) {
      const match = identifyLicenseText(`${FULL_MIT_LICENSE}\n${restriction}\n`)
      expect(match?.exact).toBe(false)
    }
  })

  it.each(PINNED_TEMPLATE_IDS.map((id, index) => [id, index] as const))(
    'never reads %s with an inserted restriction sentence as exact (property)',
    (id, index) => {
      const next = random(97 + index)
      for (const isKept of [true, false]) {
        const base = canonicalText(id, isKept)
        const boundaries = sentenceBoundaries(base)
        const pick = (): number => boundaries[Math.floor(next() * boundaries.length)] ?? 0
        // The start, the end, sampled sentence starts and sampled word starts.
        const offsets = [
          0,
          base.length,
          ...Array.from({ length: 6 }, pick),
          ...Array.from({ length: 6 }, () => Math.floor(next() * base.length)),
        ]
        for (const offset of offsets) {
          const at = base.lastIndexOf(' ', offset - 1) + 1 || offset
          const restriction = RESTRICTIONS[Math.floor(next() * RESTRICTIONS.length)] ?? ''
          const text = `${base.slice(0, at)}${restriction} ${base.slice(at)}`
          const reading = readLicenseText(text)
          if (reading?.exact === true)
            throw new Error(`${id} read as exact with "${restriction}" at ${String(at)}`)
        }
      }
    },
  )

  it('fails closed when a pinned template does not match its SHA-256', () => {
    const tampered = SPDX_TEMPLATE_FILES.map((file) =>
      file.path === 'templates/MIT.template.txt' ? { ...file, sha256: '0'.repeat(64) } : file,
    )
    const set = loadLicenseTemplates(LEGAL_DATA, tampered)
    expect(set.problems).toEqual(['templates/MIT.template.txt'])
    expect(identifyLicenseText(FULL_MIT_LICENSE, set)?.exact).not.toBe(true)
  })

  it('matches nothing exactly with no templates (the matcher-off drill)', () => {
    const empty = loadLicenseTemplates(LEGAL_DATA, [])
    expect(empty.problems).toContain('templates')
    expect(identifyLicenseText(FULL_MIT_LICENSE, empty)).toMatchObject({ id: 'MIT', exact: false })
  })

  it('reads a GPL body as its bare stem, never or-later from the body (RVCM971 P2-5)', () => {
    for (const id of ['GPL-2.0-only', 'GPL-3.0-only', 'LGPL-2.1-only', 'AGPL-3.0-only']) {
      const match = identifyLicenseText(canonicalText(id))
      expect(match).toMatchObject({ exact: true, id: id.replace('-only', '') })
    }
  })
})

describe('pinned SPDX template provenance', () => {
  it('pins every vendored file by SHA-256 and version', () => {
    const dataset = spdxProvenance().datasets.find(
      (entry) => entry.name === 'spdx-license-templates',
    )
    expect(dataset).toMatchObject({ version: '3.28.0', tag: 'v3.28.0' })
    expect(SPDX_TEMPLATE_FILES).toHaveLength(21)
    for (const file of SPDX_TEMPLATE_FILES) {
      const bytes = readFileSync(path.join(LEGAL_DATA, ...file.path.split('/')))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256)
    }
  })

  it('keeps the heuristic caveat for an excerpt and lifts it for a verbatim license', () => {
    expect(
      scanProjectLicense(snapshotFrom({ LICENSE: 'MIT License\n\nShort excerpt only.\n' }))
        .incomplete,
    ).toContain(UI_TEXT.legalScanner.m084)
    const verbatim = scanProjectLicense(snapshotFrom({ LICENSE: FULL_MIT_LICENSE }))
    expect(verbatim.incomplete).toEqual([])
    expect(verbatim.requiresReview).toBe(false)
  })
})
