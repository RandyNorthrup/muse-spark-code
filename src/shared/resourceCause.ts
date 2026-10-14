import { redactSecrets } from './redact'
import { fill } from './l10n/text'
import type { UiText } from './l10n/en'

/**
 * The cause a resource failure gave, with secrets and account ids taken out.
 * Undefined when the failure said nothing usable: the caller then logs the
 * plain sentence instead of inventing a reason.
 */
export function resourceUnavailableCause(error: unknown): string | undefined {
  if (typeof error === 'string') return error === '' ? undefined : redactSecrets(error)
  return error instanceof Error && error.message !== '' ? redactSecrets(error.message) : undefined
}

type UnavailableTable = Pick<UiText, 'resourceUnavailable' | 'resourceUnavailableWhy'>

/** The unavailable-reading warning, naming the reading's failure when it said why. */
export function warnResourceUnavailable(
  warn: (message: string) => void,
  table: UnavailableTable,
  error: unknown,
): void {
  const cause = resourceUnavailableCause(error)
  warn(
    cause === undefined ? table.resourceUnavailable : fill(table.resourceUnavailableWhy, { cause }),
  )
}
