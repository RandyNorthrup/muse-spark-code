// D261 and D262: the service a provider record was added from, which the
// refusal fallback's account rule reads: a refused turn never moves to another
// account of the same provider.
//
// A file that cannot be read cannot say which records share a provider, and
// "no preset" would make each its own provider, so a refusal could move to
// another account of the same one. It answers PROVIDERS_UNREADABLE for every
// record instead: they all count as one provider, so the move stays on the
// refusing record (another of its models) or goes to an agent of another kind,
// and the person reads the sentence that names what was skipped.
import { readFileSync } from 'node:fs'
import { failureForLog } from '../../core/backends/musecode/logText'
import type { CoreLogger } from '../../core/logging'
import type { ProvidersFileRead } from '../../core/providers/providersFile'

/** Every record's answer while the providers file cannot be read. Never a preset's id. */
export const PROVIDERS_UNREADABLE = 'providers-file-unreadable'

const NO_PROVIDERS_LIST = 'The providers file has no list of providers'

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** The preset one record names in a file that holds a providers list. */
function presetIn(providers: readonly unknown[], record: string): string | undefined {
  for (const entry of providers) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      'id' in entry &&
      entry.id === record &&
      'preset' in entry &&
      typeof entry.preset === 'string' &&
      entry.preset !== 'custom'
    )
      return entry.preset
  }
  return undefined
}

/**
The window's answer, read from the file when a refusal needs it (rare, so
read then, never cached stale). A missing file or an unknown record answers
undefined: the record is its own provider.
*/
export function providerPresetOf(
  configFile: string,
  record: string,
  log: Pick<CoreLogger, 'warn'>,
): string | undefined {
  let text: string
  try {
    text = readFileSync(configFile, 'utf8')
  } catch (error: unknown) {
    if (isMissing(error)) return undefined
    log.warn(`The providers file could not be read: ${failureForLog(error)}`)
    return PROVIDERS_UNREADABLE
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    log.warn('The providers file is not valid JSON')
    return PROVIDERS_UNREADABLE
  }
  const providers: unknown =
    typeof value === 'object' && value !== null && 'providers' in value
      ? value.providers
      : undefined
  if (!Array.isArray(providers)) {
    log.warn(NO_PROVIDERS_LIST)
    return PROVIDERS_UNREADABLE
  }
  return presetIn(providers as unknown[], record)
}

/** The same answer from the product's own reader, which `exec` runs once per team run. */
export function presetFromRead(read: ProvidersFileRead, record: string): string | undefined {
  if (!read.ok) return read.reason === 'missing' ? undefined : PROVIDERS_UNREADABLE
  return presetIn(read.file.providers, record)
}
