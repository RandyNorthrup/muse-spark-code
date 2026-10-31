// Muse Desktop (M111, D91.20) lane IN: the pseudo-RTL table mirrors every
// UI string with a right-to-left override (Android ar-XB style), so the
// harness renders the mirrored layout under `?lang=pseudo-rtl`. Keys the
// untranslated list lets every language keep stay verbatim, as in a real
// translation; slots, code spans and bold markers survive inside the wrap.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  PSEUDO_RTL_LANG,
  harnessArgs,
  langQuery,
  writePseudoTable,
} from '../../../scripts/lib/harnessLang.mjs'
import { loadL10n } from '../../../scripts/lib/l10nSource.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const RTL_FILE = 'test/harness/l10n/ui.pseudo-rtl.json'

function everyString(table, isPluralForms, prefix = '') {
  return Object.entries(table).flatMap(([name, value]) => {
    const key = `${prefix}${name}`
    if (typeof value === 'string') return [[key, value]]
    if (isPluralForms(value)) {
      return Object.entries(value).map(([form, text]) => [`${key}.${form}`, text])
    }
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? everyString(value, isPluralForms, `${key}.`)
      : []
  })
}

describe('M111 lane IN pseudo-RTL table', () => {
  it('wraps every UI string and keeps slots and kept keys intact', async () => {
    const files = await writePseudoTable(root)
    expect(files.some((file) => file.endsWith('ui.pseudo-rtl.json'))).toBe(true)
    expect(files.some((file) => file.endsWith('usage.pseudo-rtl.json'))).toBe(true)
    const { EN, isPluralForms } = await loadL10n(root)
    const rtl = JSON.parse(readFileSync(path.join(root, RTL_FILE), 'utf8'))
    const untranslated = JSON.parse(readFileSync(path.join(root, 'l10n/untranslated.json'), 'utf8'))
    const kept = new Set(untranslated['ui']?.['*'])
    expect(kept.size).toBeGreaterThan(0)
    const shaped = new Map(everyString(rtl, isPluralForms))
    for (const [key, english] of everyString(EN, isPluralForms)) {
      const value = shaped.get(key)
      if (kept.has(key) || english.trim() === '') {
        expect(value).toBe(english)
      } else {
        expect(value).toBe(`\u{202E}${english}\u{202C}`)
      }
    }
  })

  it('accepts pseudo-rtl as a harness language', () => {
    expect(harnessArgs(['--lang=pseudo-rtl', 'chat']).lang).toBe(PSEUDO_RTL_LANG)
    expect(langQuery(PSEUDO_RTL_LANG)).toBe('&lang=pseudo-rtl')
    expect(() => harnessArgs(['--lang=bogus!'])).toThrow()
  })
})
