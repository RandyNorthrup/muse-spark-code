// A saved provider's custom request headers in the editor (M95c part 6,
// PLAN.md D74): the editor's own pickers list the names, add one or
// remove one. A value is typed in a password box and goes straight to the
// credential store, bound to the provider's origin; it never crosses
// postMessage, never reaches settings or the providers file, and is never
// shown again. Headers kept for another origin (the address moved) are
// never carried to the new one: the first save replaces them. It loads
// with the providers seam (dist/modelsSubscriptions.js), not the panel.

import type { ProviderEntry, ProviderHeadersPorts } from './providerPorts'
import {
  formatStoredHeaders,
  headerNameProblem,
  isHeaderValueValid,
  parseStoredHeaders,
  providerHeadersAccount,
  StoredHeadersError,
  withHeader,
  withoutHeader,
} from '../../core/providers/requestHeaders'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'

/** The sentence that refuses a typed name, or undefined when the name can be kept. */
function headerNameRefusal(name: string): string | undefined {
  const problem = headerNameProblem(name.trim())
  if (problem === 'invalid') return UI_TEXT.providerHeaders.nameInvalid
  return problem === 'reserved'
    ? fill(UI_TEXT.providerHeaders.nameReserved, { name: name.trim() })
    : undefined
}

/**
The headers kept for `origin`: none when nothing is stored, when they were
entered for another origin, or when the stored record is damaged (the
first save replaces it; until then a request says it cannot read them).
*/
function keptHeaders(
  providerId: string,
  origin: string,
  stored: string | undefined,
): Readonly<Record<string, string>> {
  try {
    const record = parseStoredHeaders(providerId, stored)
    return record?.origin === origin ? record.headers : {}
  } catch (error: unknown) {
    if (!(error instanceof StoredHeadersError)) throw error
    return {}
  }
}

export async function manageProviderHeaders(
  entry: ProviderEntry,
  ports: ProviderHeadersPorts,
): Promise<void> {
  const origin = new URL(entry.address).origin
  const account = providerHeadersAccount(entry.id)
  const headers = keptHeaders(entry.id, origin, await ports.secrets.get(account))
  const title = fill(UI_TEXT.providerHeaders.pick, { provider: entry.id })
  const picked = await ports.pickOne(
    [
      ...Object.keys(headers).map((name) => ({ label: name, description: UI_TEXT.providerRemove })),
      { label: UI_TEXT.providerHeaders.add },
    ],
    title,
  )
  if (picked === undefined) return
  let next: Readonly<Record<string, string>>
  if (picked.description === undefined) {
    const name = await ports.showInputBox({
      title,
      prompt: UI_TEXT.providerHeaders.name,
      password: false,
      ignoreFocusOut: true,
      validateInput: headerNameRefusal,
    })
    if (name === undefined) return
    const value = await ports.showInputBox({
      title,
      prompt: fill(UI_TEXT.providerHeaders.value, { name: name.trim(), origin }),
      password: true,
      ignoreFocusOut: true,
      validateInput: (typed) =>
        isHeaderValueValid(typed.trim()) ? undefined : UI_TEXT.providerHeaders.valueInvalid,
    })
    if (value === undefined) return
    next = withHeader(headers, name.trim(), value.trim())
  } else {
    next = withoutHeader(headers, picked.label)
  }
  await (Object.keys(next).length === 0
    ? ports.secrets.delete(account)
    : ports.secrets.store(account, formatStoredHeaders(origin, next)))
}
