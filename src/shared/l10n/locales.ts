// Which display languages have a translated table, and where it lives
// (PLAN.md D33). The ids are VS Code's own (`vscode.env.language`), lower
// case. English is the base in `en.ts` and needs no file; these are the
// fourteen other languages VS Code ships (M40b), machine-translated.

export const TABLE_LOCALES: readonly string[] = [
  'zh-cn',
  'zh-tw',
  'ja',
  'ko',
  'de',
  'fr',
  'es',
  'pt-br',
  'ru',
  'it',
  'tr',
  'pl',
  'cs',
  'hu',
]

/** The packaged folder that holds the translated tables. */
export const TABLE_DIRECTORY = 'l10n'

/** A table's file name inside `TABLE_DIRECTORY`. */
export function tableFileName(locale: string): string {
  return `ui.${locale}.json`
}

/**
 * The table for VS Code's display language: the exact id (`pt-br`, `zh-tw`),
 * else its primary language when that has a table of its own (`de-ch` reads
 * `de`); undefined means English.
 */
export function tableLocaleFor(
  language: string,
  locales: readonly string[] = TABLE_LOCALES,
): string | undefined {
  const id = language.toLowerCase()
  if (locales.includes(id)) {
    return id
  }
  const primary = id.split('-', 1)[0] ?? id
  return locales.includes(primary) ? primary : undefined
}
