import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { scanLegal } from '../../src/core/legal/scan'
import { EN, type UiText } from '../../src/shared/l10n/en'
import { tableProblems } from '../../src/shared/l10n/check'
import { setUiText } from '../../src/shared/l10n/text'
import { TABLE_LOCALES } from '../../src/shared/l10n/locales'
import { snapshotFrom } from './legal/helpers'

function isTable(value: unknown, locale: string): value is UiText {
  return tableProblems(EN, value, { locale, isStrict: false }).length === 0
}

const files = {
  'package.json': JSON.stringify({ name: 'test', license: 'MIT' }),
  'src/a.ts': 'export const value = 1\n',
  'package-lock.json': JSON.stringify({
    lockfileVersion: 3,
    packages: { 'node_modules/demo': { version: '1.0.0' } },
  }),
}
afterEach(() => {
  setUiText(EN, 'en')
})
describe('scanner localization', () => {
  it('uses every installed language at scan time and keeps identifiers stable', () => {
    const english = scanLegal(snapshotFrom(files), { headerPolicy: 'required' })
    for (const locale of TABLE_LOCALES) {
      const table: unknown = JSON.parse(readFileSync(`l10n/ui.${locale}.json`, 'utf8'))
      expect(isTable(table, locale)).toBe(true)
      if (!isTable(table, locale)) throw new Error('missing table')
      setUiText(table, locale)
      const result = scanLegal(snapshotFrom(files), { headerPolicy: 'required' })
      expect(
        result.findings.map(({ id, file, packageName, licenseExpression }) => ({
          id,
          file,
          packageName,
          licenseExpression,
        })),
      ).toEqual(
        english.findings.map(({ id, file, packageName, licenseExpression }) => ({
          id,
          file,
          packageName,
          licenseExpression,
        })),
      )
      expect(result.findings.map((f) => f.explanation)).not.toEqual(
        english.findings.map((f) => f.explanation),
      )
      expect(
        result.findings
          .filter((f) => f.file === 'src/a.ts' && f.category === 'copyrightHeader')
          .map((f) => f.explanation),
      ).not.toEqual(
        english.findings
          .filter((f) => f.file === 'src/a.ts' && f.category === 'copyrightHeader')
          .map((f) => f.explanation),
      )
      expect(result.incompleteChecks).not.toEqual(english.incompleteChecks)
      expect(result.findings.some((f) => f.explanation.includes('{v'))).toBe(false)
    }
  })
})
