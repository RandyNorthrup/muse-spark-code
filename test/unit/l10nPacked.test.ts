import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { isPluralForms } from '../../src/shared/l10n/forms'
import { TABLE_LOCALES } from '../../src/shared/l10n/locales'
import { unpackUiTable } from '../../src/shared/l10n/packed'

function indexed(reference: unknown, translated: unknown): unknown[] {
  if (typeof reference !== 'object' || reference === null || isPluralForms(reference))
    return [translated]
  if (typeof translated !== 'object' || translated === null) throw new Error('Invalid fixture')
  return Object.entries(reference)
    .toSorted(([a], [b]) => a.localeCompare(b, 'en'))
    .flatMap(([key, entry]) =>
      indexed(entry, Object.getOwnPropertyDescriptor(translated, key)?.value),
    )
}
describe('lossless packaged localization', () => {
  it('restores every value and plural category in all fourteen tables', () => {
    for (const locale of TABLE_LOCALES) {
      const original: unknown = JSON.parse(readFileSync(`l10n/ui.${locale}.json`, 'utf8'))
      expect(unpackUiTable({ format: 1, values: indexed(EN, original) })).toEqual(original)
    }
  })
  it('refuses truncated, surplus and malformed packages', () => {
    const values = indexed(EN, EN)
    expect(() => unpackUiTable({ format: 1, values: values.slice(1) })).toThrow('Truncated')
    expect(() => unpackUiTable({ format: 1, values: [...values, 'surplus'] })).toThrow('Unexpected')
    expect(() => unpackUiTable({ format: 2, values })).toThrow()
    expect(unpackUiTable(EN)).toBe(EN)
  })
})
