// The display language's table in the webview (PLAN.md D33). The host
// writes the table it checked into the page as a JSON script element,
// `{ locale, table }`; main.tsx installs it before the first render so every
// row reads it. Like any boundary input it is checked again here: a page
// without the element is an English page, and one whose element does not
// parse or does not have English's shape stays English, with the reason
// handed back for the host's log.

import * as z from 'zod/mini'
import { WEBVIEW_L10N_ELEMENT_ID } from '../shared/constants'
import { tableProblems } from '../shared/l10n/check'
import { EN, type UiText } from '../shared/l10n/en'
import { setUiText } from '../shared/l10n/text'

const embeddedTableSchema = z.object({ locale: z.string(), table: z.unknown() })

/** Whether the table has English's keys, slots and plural forms (the non-strict check). */
function isUiText(table: unknown, locale: string): table is UiText {
  return tableProblems(EN, table, { locale, isStrict: false }).length === 0
}

function refused(reason: string): Error {
  return new Error(
    `The display language's table was not installed; the panel stays English: ${reason}`,
  )
}

/**
 * Installs the table embedded in `page`, if there is one. Returns why an
 * embedded table was refused, for the log; undefined when it was installed
 * or the page has none.
 */
export function installEmbeddedTable(page: ParentNode): Error | undefined {
  const element = page.querySelector(`#${WEBVIEW_L10N_ELEMENT_ID}`)
  if (element === null) {
    return undefined
  }
  let raw: unknown
  try {
    raw = JSON.parse(element.textContent)
  } catch (error) {
    return refused(error instanceof Error ? error.message : String(error))
  }
  const parsed = embeddedTableSchema.safeParse(raw)
  if (!parsed.success) {
    return refused('the element is not { locale, table }')
  }
  const { locale, table } = parsed.data
  try {
    // A tag Intl rejects would leave the plural and number rules half set.
    Intl.getCanonicalLocales(locale)
  } catch {
    return refused(`"${locale}" is not a language tag`)
  }
  if (!isUiText(table, locale)) {
    return refused(tableProblems(EN, table, { locale, isStrict: false }).join('; '))
  }
  setUiText(table, locale)
  return undefined
}
