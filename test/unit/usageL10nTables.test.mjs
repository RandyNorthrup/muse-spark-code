import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { tableProblems } from '../../src/shared/l10n/check'
import { isPluralForms } from '../../src/shared/l10n/forms'
import { TABLE_LOCALES } from '../../src/shared/l10n/locales'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'

const root = process.cwd()
const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other']

function stringKeys(table, prefix = '') {
  return Object.entries(table).flatMap(([name, value]) => {
    const key = `${prefix}${name}`
    if (typeof value === 'string') return [key]
    return isPluralForms(value)
      ? [key, ...PLURAL_CATEGORIES.map((category) => `${key}.${category}`)]
      : []
  })
}

function readJson(file) {
  return JSON.parse(readFileSync(path.join(root, file), 'utf8'))
}

function usageExceptions() {
  const lists = readJson('l10n/untranslated.json').usage ?? {}
  const everywhere = lists['*'] ?? []
  return { lists, everywhere }
}

describe('shipped usage tables (lane L)', () => {
  it('keeps a valid usage section in l10n/untranslated.json', () => {
    const { lists, everywhere } = usageExceptions()
    const known = new Set(stringKeys(USAGE_EN))
    for (const [locale, keys] of Object.entries(lists)) {
      if (locale !== '*' && !TABLE_LOCALES.includes(locale)) {
        throw new Error(`usage.${locale}: not a language TABLE_LOCALES lists`)
      }
      expect(Array.isArray(keys), `usage.${locale}: a list of keys expected`).toBe(true)
      for (const key of keys) {
        expect(typeof key, `usage.${locale}: keys are strings`).toBe('string')
        expect(known.has(key), `usage.${locale}: ${key}: not a string of the usage table`).toBe(
          true,
        )
      }
      const repeated = keys.filter(
        (key, index) => keys.indexOf(key) !== index || (locale !== '*' && everywhere.includes(key)),
      )
      expect(repeated, `usage.${locale}: listed twice`).toEqual([])
    }
  })

  it.each(TABLE_LOCALES)('ships a complete %s usage table', (locale) => {
    const { lists, everywhere } = usageExceptions()
    const untranslated = new Set([...everywhere, ...(lists[locale] ?? [])])
    const table = readJson(`l10n/usage.${locale}.json`)
    expect(tableProblems(USAGE_EN, table, { locale, isStrict: true, untranslated })).toEqual([])
  })

  it('leaves no locale without its table', () => {
    expect(TABLE_LOCALES).toHaveLength(14)
  })
})
