// `providers headers <id> [set|unset <name>]` (M95c part 6,
// PLAN.md D74): list a provider's custom request header names, set one
// whose value comes from standard input (never an argument, an
// environment variable or a file, as a key never does), or unset one.
// The record lives in the operating system's credential store, bound to
// the provider's origin; values are never printed. A module of its own so
// the other provider commands never carry it.
import type { ProviderEntry } from '../core/providers/providersFile'
import { requestHeaders } from '../host/backend/providersEntry'
import { UI_TEXT } from '../shared/constants'
import { fill } from '../shared/l10n/text'
import type { ProvidersHeadersOptions } from './cliArgs'
import { commandFile, failed, type ProvidersDeps } from './providersCommands'

// The record's rules ride the providers bundle (dist/providers.js, D74).
const {
  formatStoredHeaders,
  headerNameProblem,
  isHeaderValueValid,
  parseStoredHeaders,
  providerHeadersAccount,
  StoredHeadersError,
  withHeader,
  withoutHeader,
} = requestHeaders

const EXIT_OK = 0
const EXIT_FAILED = 1

/** The headers kept for the entry's origin; undefined when the stored record is damaged. */
async function keptHeaders(
  deps: ProvidersDeps,
  entry: ProviderEntry,
  origin: string,
): Promise<Readonly<Record<string, string>> | undefined> {
  try {
    const record = parseStoredHeaders(
      entry.id,
      await deps.secrets.get(providerHeadersAccount(entry.id)),
    )
    // Headers entered for another origin are never carried to this one.
    return record?.origin === origin ? record.headers : {}
  } catch (error: unknown) {
    if (!(error instanceof StoredHeadersError)) throw error
    return undefined
  }
}

export async function providersHeaders(
  deps: ProvidersDeps,
  options: ProvidersHeadersOptions,
): Promise<number> {
  const file = await commandFile(deps)
  // The file's own refusal was printed by `commandFile`.
  if (file === undefined) return EXIT_FAILED
  const entry = file.providers.find((row) => row.id === options.provider)
  if (entry === undefined || entry.auth === 'subscription' || entry.address === undefined) {
    return failed(deps, fill(UI_TEXT.providerUnknown, { provider: options.provider }))
  }
  const origin = new URL(entry.address).origin
  const account = providerHeadersAccount(entry.id)
  const kept = await keptHeaders(deps, entry, origin)
  if (options.set === undefined && options.unset === undefined) {
    return kept === undefined
      ? failed(deps, fill(UI_TEXT.providerHeaders.unreadable, { provider: entry.id }))
      : printNames(deps, entry.id, kept)
  }
  // A damaged record is replaced by the first change, as in the editor.
  let headers = kept ?? {}
  if (options.unset !== undefined) {
    headers = withoutHeader(headers, options.unset)
  }
  if (options.set !== undefined) {
    const name = options.set
    const problem = headerNameProblem(name)
    if (problem !== undefined) {
      return failed(
        deps,
        problem === 'reserved'
          ? fill(UI_TEXT.providerHeaders.nameReserved, { name })
          : UI_TEXT.providerHeaders.nameInvalid,
      )
    }
    const typed = await deps.readSecret(fill(UI_TEXT.providerHeaders.value, { name, origin }))
    const value = typed.trim()
    if (!isHeaderValueValid(value)) return failed(deps, UI_TEXT.providerHeaders.valueInvalid)
    headers = withHeader(headers, name, value)
  }
  await (Object.keys(headers).length === 0
    ? deps.secrets.delete(account)
    : deps.secrets.store(account, formatStoredHeaders(origin, headers)))
  return printNames(deps, entry.id, headers)
}

/** Prints the header names a provider sends (never a value), and succeeds. */
function printNames(
  deps: ProvidersDeps,
  provider: string,
  headers: Readonly<Record<string, string>>,
): number {
  const names = Object.keys(headers)
  deps.print(
    names.length === 0
      ? fill(UI_TEXT.providerHeaders.none, { provider })
      : fill(UI_TEXT.providerHeaders.list, { provider, names: names.join(', ') }),
  )
  return EXIT_OK
}
