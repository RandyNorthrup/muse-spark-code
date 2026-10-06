// Installed packages store translated values once in a language-major matrix.
// Source tables stay JSON. Every installed table retains its original shape.
import * as z from 'zod/mini'
import { L10N_TABLE_MAX_BYTES, UI_TEXT } from '../constants'
import { EN } from './en'
import { TABLE_LOCALES } from './locales'

const knownLocales: ReadonlySet<string> = new Set(TABLE_LOCALES)

const archiveSchema = z.object({
  version: z.literal(1),
  keys: z.array(z.string()),
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
    archive.keys.length !== Object.keys(EN).length ||
    new Set(archive.keys).size !== archive.keys.length ||
    archive.keys.some((key) => !Object.hasOwn(EN, key)) ||
    archive.values.length !== archive.locales.length ||
    archive.values.some((values) => values.length !== archive.keys.length)
  )
    throw new Error(UI_TEXT.actionFailed)
  const values = archive.values[index]
  if (values === undefined) throw new Error(UI_TEXT.actionFailed)
  const table = JSON.stringify(
    Object.fromEntries(
      archive.keys.map((key, position): [string, unknown] => [key, values[position]]),
    ),
  )
  if (new TextEncoder().encode(table).byteLength > L10N_TABLE_MAX_BYTES)
    throw new Error(UI_TEXT.actionFailed)
  return table
}
