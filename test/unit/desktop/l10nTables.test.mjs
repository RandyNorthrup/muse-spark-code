// Muse Desktop (M111, D91.20) lane IN: the generated native tables stay
// complete and fresh. The Rust table must carry every loaded key in every
// locale's own section; the QML singleton must parse and carry the same
// fifteen tables; both committed files must equal the generator's output.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  RUST_TABLES_FILE,
  flattenTable,
  loadTables,
  renderAll,
} from '../../../desktop/crates/l10n/tools/tables.mjs'
import { loadL10n } from '../../../scripts/lib/l10nSource.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

// One load of the fifteen tables for the whole file: compiling the English
// source dominates, and every test reads the same bytes.
const shared = {}
beforeAll(async () => {
  shared.loaded = await loadTables(root)
  shared.helpers = await loadL10n(root)
})

describe('M111 lane IN generated language tables', () => {
  it('flattens nesting once and expands each plural form', () => {
    expect(
      flattenTable(
        {
          plain: 'Hi',
          group: { nested: 'Yo', count: { one: '{count} thing', other: '{count} things' } },
        },
        shared.helpers.isPluralForms,
      ),
    ).toEqual([
      ['plain', 'Hi'],
      ['group.nested', 'Yo'],
      ['group.count.one', '{count} thing'],
      ['group.count.other', '{count} things'],
    ])
  })

  it('carries every loaded key in every locale section of tables.rs', () => {
    // Each locale carries its own flattened keys (a translation holds every
    // plain string but only the plural forms its language selects — Chinese
    // has no `one` — and the lookup falls back to English past that). The
    // localization gate owns cross-locale completeness; this owns that the
    // renderer wrote everything it loaded, once each.
    const { locales, flattened } = shared.loaded
    const text = readFileSync(path.join(root, RUST_TABLES_FILE), 'utf8')
    expect(locales).toHaveLength(15)
    // One pass over the file: dotted keys never quote or escape, so an
    // entry line parses unambiguously.
    const carried = new Map()
    let current
    for (const line of text.split('\n')) {
      const locale = /^ {8}locale: "([^"]+)",$/.exec(line)?.[1]
      if (locale !== undefined) {
        current = locale
        carried.set(locale, [])
      } else if (current !== undefined) {
        const key = /^ {8}\("([^"]+)", "/.exec(line)?.[1]
        if (key !== undefined) carried.get(current).push(key)
      }
    }
    for (const locale of locales) {
      expect(new Set(carried.get(locale))).toEqual(new Set(flattened[locale].map(([key]) => key)))
      expect(carried.get(locale)).toHaveLength(flattened[locale].length)
    }
  })

  it('parses the singleton and matches the translated tables key for key', () => {
    const [, { text }] = renderAll(shared.loaded)
    const marker = 'readonly property var tables: ('
    const start = text.indexOf(marker) + marker.length
    const end = text.indexOf(')\n    property string localeName')
    const tables = JSON.parse(text.slice(start, end))
    expect(Object.keys(tables)).toHaveLength(15)
    for (const [locale, table] of Object.entries(tables)) {
      if (locale === 'en') continue
      const file = path.join(
        root,
        shared.helpers.TABLE_DIRECTORY,
        shared.helpers.tableFileName(locale),
      )
      expect(table).toEqual(JSON.parse(readFileSync(file, 'utf8')))
    }
  })

  it('matches the committed files byte for byte', () => {
    for (const { file, text } of renderAll(shared.loaded)) {
      expect(readFileSync(path.join(root, file), 'utf8')).toBe(text)
    }
  })
})
