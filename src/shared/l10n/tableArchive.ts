// Installed packages store translated values once in a language-major matrix.
// Source tables stay JSON. Every installed table retains its original shape.
import * as z from 'zod/mini'
import { L10N_TABLE_MAX_BYTES, UI_TEXT } from '../constants'
import { EN } from './en'
import { unpackUiTable } from './packed'
import { isPluralForms } from './forms'
import { TABLE_LOCALES } from './locales'

const knownLocales: ReadonlySet<string> = new Set(TABLE_LOCALES)

const archiveSchema = z.object({
  version: z.literal(1),
  keys: z.optional(z.array(z.string())),
  format: z.optional(z.literal(1)),
  locales: z.array(z.string()),
  values: z.array(z.array(z.unknown())),
})

export function readArchivedUiTable(text: string, locale: string): string {
  const parsed: unknown = JSON.parse(text)
  const archive = archiveSchema.parse(parsed)
  const index = archive.locales.indexOf(locale)
  if (
    index === -1 ||
    new Set(archive.locales).size !== archive.locales.length ||
    archive.locales.some((name) => !knownLocales.has(name)) ||
    archive.values.length !== archive.locales.length ||
    archive.values.some((values) => values.length !== archive.values[0]?.length)
  )
    throw new Error(UI_TEXT.actionFailed)
  const values = archive.values[index]
  if (values === undefined) throw new Error(UI_TEXT.actionFailed)
  let restored: unknown
  if (archive.format === 1) {
    const expanded = unpackUiTable({ format: 1, values })
    // Preserve source insertion order too, while deriving every key from English.
    function reorder(reference: unknown, data: unknown): unknown {
      if (typeof reference !== 'object' || reference === null || isPluralForms(reference))
        return data
      if (typeof data !== 'object' || data === null) throw new Error(UI_TEXT.actionFailed)
      const entries = Object.entries(reference).map(([key, value]) => [
        key,
        reorder(value, Reflect.get(data, key)),
      ])
      return Object.fromEntries(entries)
    }
    restored = reorder(EN, expanded)
  } else {
    const keys = archive.keys
    if (
      keys?.length !== Object.keys(EN).length ||
      new Set(keys).size !== keys.length ||
      keys.some((key) => !Object.hasOwn(EN, key)) ||
      values.length !== keys.length
    )
      throw new Error(UI_TEXT.actionFailed)
    restored = Object.fromEntries(keys.map((key, position) => [key, values[position]]))
  }
  const table = JSON.stringify(restored)
  if (new TextEncoder().encode(table).byteLength > L10N_TABLE_MAX_BYTES)
    throw new Error(UI_TEXT.actionFailed)
  return table
}
