import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  licenseTemplateSet,
  loadLicenseTemplates,
  readLicenseText,
} from '../../src/core/legal/licenseTemplates'
import { LEGAL_TEMPLATE_SLOT_WORDS } from '../../src/shared/constants'
import { rawBytesFingerprint } from '../../src/core/verify/fingerprint'
import { spdxProvenance } from '../../src/core/legal/data'
import { FULL_MIT_LICENSE } from './legal/helpers'
import { RESTRICTION_WORD_FIXTURE } from './legal/restrictionWords'

const DATA = path.join(__dirname, '../../src/core/legal/legal-data')

describe('pinned holder review vocabulary outside the bundle', () => {
  it('preserves every original restriction word and its independent provenance', () => {
    const actual = licenseTemplateSet().equivalences.restrictionWords
    const expected = new Set(
      RESTRICTION_WORD_FIXTURE.map((word) => word.replaceAll('ı', 'i').replaceAll('ß', 'ss')),
    )
    expect(actual).toEqual(expected)
    expect(actual.size).toBe(312)
    const bytes = readFileSync(path.join(DATA, LEGAL_TEMPLATE_SLOT_WORDS.path))
    expect(rawBytesFingerprint(bytes)).toBe(LEGAL_TEMPLATE_SLOT_WORDS.sha256)
    expect(
      spdxProvenance().datasets.find((entry) => entry.name === 'holder-slot-words')?.files,
    ).toContainEqual(LEGAL_TEMPLATE_SLOT_WORDS)
  })

  it.each(['missing', 'changed'] as const)(
    'disables exact matching when slot data is %s',
    (kind) => {
      const folder = mkdtempSync(path.join(tmpdir(), 'legal-slot-data-'))
      try {
        cpSync(DATA, folder, { recursive: true })
        const file = path.join(folder, LEGAL_TEMPLATE_SLOT_WORDS.path)
        if (kind === 'missing') unlinkSync(file)
        else writeFileSync(file, 'unreviewed\n')
        const set = loadLicenseTemplates(folder)
        expect(set.problems).toContain(LEGAL_TEMPLATE_SLOT_WORDS.path)
        expect(set.templates).toEqual([])
        expect(readLicenseText(FULL_MIT_LICENSE, set)?.exact).not.toBe(true)
      } finally {
        rmSync(folder, { recursive: true, force: true })
      }
    },
  )
})
