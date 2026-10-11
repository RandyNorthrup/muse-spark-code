// Usage strings are loaded only by the usage surface/service. File access is
// injected so the same loader works in VS Code and the standalone runtime.
import { tableProblems } from './check'
import { TABLE_DIRECTORY, tableLocaleFor } from './locales'
import { USAGE_EN, type UsageText } from './usageEn'

export const USAGE_TEXT: UsageText = { ...USAGE_EN }
export function setUsageText(table: UsageText): void {
  Object.assign(USAGE_TEXT, table)
}
export function usageTableFileName(locale: string): string {
  return `usage.${locale}.json`
}
export interface UsageTable {
  readonly locale: string
  readonly table: UsageText
}
export interface UsageTableDeps {
  readonly language: string
  readonly readTableFile: (segments: readonly string[]) => Promise<string>
  readonly warn: (message: string) => void
}
export function isUsageText(value: unknown, locale: string): value is UsageText {
  return tableProblems(USAGE_EN, value, { locale, isStrict: false }).length === 0
}
export async function loadUsageTable(deps: UsageTableDeps): Promise<UsageTable> {
  const locale = tableLocaleFor(deps.language)
  const english: UsageTable = { locale: 'en', table: USAGE_EN }
  if (locale === undefined) return english
  const file = usageTableFileName(locale)
  let parsed: unknown
  try {
    parsed = JSON.parse(await deps.readTableFile([TABLE_DIRECTORY, file]))
  } catch {
    deps.warn(`${TABLE_DIRECTORY}/${file}: unreadable`)
    return english
  }
  if (!isUsageText(parsed, locale)) {
    deps.warn(`${TABLE_DIRECTORY}/${file}: invalid table`)
    return english
  }
  return { locale, table: parsed }
}
