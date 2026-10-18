import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { tableProblems } from '../../src/shared/l10n/check'
import { TABLE_LOCALES } from '../../src/shared/l10n/locales'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'

const root = process.cwd()

function readJson(file) {
  return JSON.parse(readFileSync(path.join(root, file), 'utf8'))
}

function usageExceptions() {
  const lists = readJson('l10n/untranslated.json').usage ?? {}
  const everywhere = lists['*'] ?? []
  return { lists, everywhere }
}

describe('shipped usage tables (lane L)', () => {
  it.each(TABLE_LOCALES)('ships a complete %s usage table', (locale) => {
    const { lists, everywhere } = usageExceptions()
    const untranslated = new Set([...everywhere, ...(lists[locale] ?? [])])
    const table = readJson(`l10n/usage.${locale}.json`)
    expect(tableProblems(USAGE_EN, table, { locale, isStrict: true, untranslated })).toEqual([])
  })
})
