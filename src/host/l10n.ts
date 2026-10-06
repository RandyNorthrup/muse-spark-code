// The table for VS Code's display language (PLAN.md D33), installed once at
// activation before anything shows text. English is built in; any other
// language with a table reads `l10n/ui.<locale>.json` from the package and
// checks its shape against English. A language without a table, or a file
// that cannot be read or does not match, leaves the extension in English,
// and the log says why. The same table goes to each webview in its HTML.
// Pure: the file read and the language are injected.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
import { L10N_TABLE_MAX_BYTES, L10N_TABLE_ARCHIVE_FILE } from '../shared/constants'
import { unpackUiTable } from '../shared/l10n/packed'
import { tableProblems } from '../shared/l10n/check'
import { EN, type UiText } from '../shared/l10n/en'
import {
  TABLE_DIRECTORY,
  TABLE_LOCALES,
  tableFileName,
  tableLocaleFor,
} from '../shared/l10n/locales'
import { BASE_LOCALE, setUiText } from '../shared/l10n/text'
import type { Logger } from './logger'
import { readArchivedUiTable } from '../shared/l10n/tableArchive'

/** The installed table and its language, as the webviews receive them. */
export interface UiTable {
  readonly locale: string
  readonly table: UiText
}

export interface UiTableDeps {
  /** `vscode.env.language`: VS Code's display language (`en`, `de`, `zh-cn`, …). */
  readonly language: string
  /** A packaged file's text, by its path segments under the extension root; rejects when unreadable. */
  readonly readExtensionFile: (segments: readonly string[]) => Promise<string>
  readonly log: Logger
  /** The table a display language reads; the shipped list decides unless a test gives its own. */
  readonly tableLocaleFor?: (language: string) => string | undefined
}

// A damaged table can differ in hundreds of keys; the log names the first few.
const PROBLEMS_LOGGED = 5

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Whether the parsed file has English's shape; what differs is added to `problems`. */
function isTableShape(value: unknown, locale: string, problems: string[]): value is UiText {
  problems.push(...tableProblems(EN, value, { locale, isStrict: false }))
  return problems.length === 0
}

function problemSummary(problems: readonly string[]): string {
  const shown = problems.slice(0, PROBLEMS_LOGGED).join('; ')
  const more = problems.length - PROBLEMS_LOGGED
  return more > 0 ? `${shown}; and ${String(more)} more` : shown
}

/**
 * Installs the display language's table (`setUiText`) and returns it for the
 * webviews; English when the language has none or its file is unusable.
 */
export async function loadUiTable(deps: UiTableDeps): Promise<UiTable> {
  const english: UiTable = { locale: BASE_LOCALE, table: EN }
  const locale = (deps.tableLocaleFor ?? tableLocaleFor)(deps.language)
  if (locale === undefined) {
    deps.log.info(`Display language ${deps.language}: the panel is in English`)
    return english
  }
  const fileName = tableFileName(locale)
  const file = `${TABLE_DIRECTORY}/${fileName}`
  let parsed: unknown
  try {
    parsed = unpackUiTable(JSON.parse(await deps.readExtensionFile([TABLE_DIRECTORY, fileName])))
  } catch (error: unknown) {
    deps.log.warn(`${file} could not be read, so the panel stays in English: ${describe(error)}`)
    return english
  }
  const problems: string[] = []
  if (!isTableShape(parsed, locale, problems)) {
    deps.log.warn(
      `${file} does not match the English table, so the panel stays in English: ${problemSummary(problems)}`,
    )
    return english
  }
  setUiText(parsed, locale)
  deps.log.info(`Display language ${deps.language}: the panel is in ${locale} (${file})`)
  return { locale, table: parsed }
}

/** Source and ACP tables are JSON; staged VSIX tables are bounded Brotli. */
export async function readUiTableFile(root: string, segments: readonly string[]): Promise<string> {
  const archive = path.join(root, TABLE_DIRECTORY, L10N_TABLE_ARCHIVE_FILE)
  const locale =
    segments.length === 2 && segments[0] === TABLE_DIRECTORY
      ? TABLE_LOCALES.find((name) => tableFileName(name) === segments[1])
      : undefined
  if (locale !== undefined && existsSync(archive)) {
    const text = brotliDecompressSync(await readFile(archive), {
      maxOutputLength: L10N_TABLE_MAX_BYTES * TABLE_LOCALES.length,
    }).toString('utf8')
    return readArchivedUiTable(text, locale)
  }
  const file = path.join(root, ...segments)
  const compressed = `${file}.br`
  if (existsSync(compressed)) {
    return brotliDecompressSync(await readFile(compressed), {
      maxOutputLength: L10N_TABLE_MAX_BYTES,
    }).toString('utf8')
  }
  return await readFile(file, 'utf8')
}
