// Node-only installed usage tables: source JSON or a bounded solid archive.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
import * as z from 'zod/mini'
import { L10N_TABLE_MAX_BYTES, USAGE_TABLE_ARCHIVE_FILE } from '../../shared/constants'
import { TABLE_DIRECTORY, TABLE_LOCALES } from '../../shared/l10n/locales'
import { isUsageText, USAGE_TEXT, usageTableFileName } from '../../shared/l10n/usageTable'

export async function readUsageTableFile(
  root: string,
  segments: readonly string[],
): Promise<string> {
  const locale =
    segments.length === 2 && segments[0] === TABLE_DIRECTORY
      ? TABLE_LOCALES.find((name) => usageTableFileName(name) === segments[1])
      : undefined
  const archive = path.join(root, TABLE_DIRECTORY, USAGE_TABLE_ARCHIVE_FILE)
  if (locale !== undefined && existsSync(archive)) {
    const text = brotliDecompressSync(await readFile(archive), {
      maxOutputLength: L10N_TABLE_MAX_BYTES * TABLE_LOCALES.length,
    }).toString('utf8')
    const tables = z.record(z.string(), z.unknown()).parse(JSON.parse(text))
    const table = tables[locale]
    if (!isUsageText(table, locale)) throw new Error(USAGE_TEXT.unsupported)
    const serialized = JSON.stringify(table)
    if (new TextEncoder().encode(serialized).byteLength > L10N_TABLE_MAX_BYTES)
      throw new Error(USAGE_TEXT.unsupported)
    return serialized
  }
  return await readFile(path.join(root, ...segments), 'utf8')
}
