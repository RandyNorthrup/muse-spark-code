// Which display languages have a translated table, and where it lives
// (PLAN.md D33). The ids are VS Code's own (`vscode.env.language`), lower
// case. English is the base in `en.ts` and needs no file; M40b adds the
// fourteen languages VS Code ships.

export const TABLE_LOCALES: readonly string[] = []

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
