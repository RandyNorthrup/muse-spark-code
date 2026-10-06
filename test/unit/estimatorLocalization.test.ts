import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import manifestCopy from '../fixtures/estimator/manifest-strings.json'
import { EN } from '../../src/shared/l10n/en'
import { TABLE_LOCALES } from '../../src/shared/l10n/locales'
import { BASE_LOCALE, fill, setUiText, UI_TEXT } from '../../src/shared/l10n/text'

const strings = z.record(z.string(), z.string())
const enRegion = strings.parse(
  Object.fromEntries(Object.entries(EN).filter(([key]) => key.startsWith('estimate'))),
)
const here = import.meta.dirname
function regionFor(locale: string): Record<string, string> {
  if (locale === BASE_LOCALE) return enRegion
  const table = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(readFileSync(path.join(here, `../../l10n/ui.${locale}.json`), 'utf8')))
  return strings.parse(
    Object.fromEntries(Object.entries(table).filter(([key]) => key.startsWith('estimate'))),
  )
}

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('M117 localized estimator consent and manifest handoff', () => {
  it.each([BASE_LOCALE, ...TABLE_LOCALES])(
    'keeps all estimator copy and consent values in %s',
    (locale) => {
      const region = regionFor(locale)
      expect(Object.keys(region)).toEqual(Object.keys(enRegion))
      setUiText({ ...EN, ...region }, locale)
      const question = fill(UI_TEXT.estimateConfirmServer, {
        server: 'server-1',
        price: 'PRICE',
        total: 'TOTAL',
        budget: 'BUDGET',
      })
      for (const value of ['server-1', 'PRICE', 'TOTAL', 'BUDGET'])
        expect(question).toContain(value)
      const idle = fill(UI_TEXT.estimateIdleNotice, { server: 'server-1', duration: 'DURATION' })
      expect(idle).toContain('DURATION')
      expect(fill(UI_TEXT.estimateCatalog, { date: 'DATE' })).toContain('DATE')
      expect(UI_TEXT.estimateTitle).toBe(region['estimateTitle'])
      if (locale !== BASE_LOCALE)
        expect(UI_TEXT.estimateConfirmServer).not.toBe(EN.estimateConfirmServer)
    },
  )

  it('supplies exact five manifest translations for W without registering unfinished commands', () => {
    expect(Object.keys(manifestCopy.mapping)).toHaveLength(5)
    const tables = z.record(z.string(), strings).parse(manifestCopy.tables)
    expect(new Set(Object.keys(tables))).toEqual(new Set([BASE_LOCALE, ...TABLE_LOCALES]))
    for (const [locale, table] of Object.entries(tables)) {
      const region = regionFor(locale)
      expect(new Set(Object.keys(table))).toEqual(new Set(Object.values(manifestCopy.mapping)))
      for (const [key, value] of Object.entries(table)) expect(value).toBe(region[key])
    }
  })
})
