// The desktop string group in every installed table (lane 0: the `desktop`
// group of src/shared/l10n/en.ts and all 14 l10n/ui.*.json), for the scenes.
// English comes from the shipped table through scripts/lib/l10nSource.mjs;
// the rest are read from their JSON tables, so a scene shows exactly what a
// person with that language installed would read.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { loadL10n } from '../../../../scripts/lib/l10nSource.mjs'

const TABLE_FILE = /^ui\.([a-z]{2,3}(?:-[a-z\d]+)*)\.json$/
const SLOT = /\{(\w+)\}/g

/** Every language a scene can render: English first, then the tables on disk. */
export async function desktopLanguages(repoRoot) {
  const files = await readdir(path.join(repoRoot, 'l10n'))
  const langs = files
    .map((file) => TABLE_FILE.exec(file)?.[1])
    .filter((lang) => lang !== undefined)
    .toSorted((a, b) => a.localeCompare(b, 'en'))
  return ['en', ...langs]
}

const tables = new Map()

async function loadDesktopTable(repoRoot, lang, cacheKey) {
  try {
    if (lang === 'en') {
      const { EN } = await loadL10n(repoRoot)
      return EN.desktop
    }
    const file = path.join(repoRoot, 'l10n', `ui.${lang}.json`)
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      const reason = error instanceof Error ? (error.code ?? error.message) : 'unknown error'
      throw new Error(
        `no language table for ${lang}: l10n/ui.${lang}.json cannot be read (${reason})`,
        { cause: error },
      )
    }
    const parsed = JSON.parse(text)
    if (typeof parsed.desktop !== 'object' || parsed.desktop === null) {
      throw new Error(`l10n/ui.${lang}.json has no desktop string group`)
    }
    return parsed.desktop
  } catch (error) {
    // A failed load is retried by the next caller instead of cached.
    tables.delete(cacheKey)
    throw error
  }
}

/** The `desktop` group of `lang`'s table. Throws naming the table when absent. */
export async function desktopStrings(repoRoot, lang) {
  const cacheKey = `${repoRoot}\n${lang}`
  let table = tables.get(cacheKey)
  if (table === undefined) {
    table = loadDesktopTable(repoRoot, lang, cacheKey)
    tables.set(cacheKey, table)
  }
  return table
}

/** One desktop string filled with its slots; plural forms pick by `count`. */
export function desktopText(table, locale, key, slots = {}) {
  const value = table[key]
  if (value === undefined) throw new Error(`the desktop table has no string named ${key}`)
  let template
  if (typeof value === 'string') {
    template = value
  } else {
    const count = typeof slots.count === 'number' ? slots.count : 2
    const category = new Intl.PluralRules(locale).select(count)
    template = value[category] ?? value.other
    if (template === undefined) {
      throw new Error(`desktop.${key} has no plural form for ${String(count)} in ${locale}`)
    }
  }
  return template.replaceAll(SLOT, (whole, name) => {
    const filled = slots[name]
    return filled === undefined ? whole : String(filled)
  })
}
