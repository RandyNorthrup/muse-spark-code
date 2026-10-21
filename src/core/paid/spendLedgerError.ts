// Portable typed spend-store failures: no filesystem or process dependency.
// A daily running total that cannot be read or saved, a damaged file, or
// conflicting amounts refuse the next paid request whose limit needs it
// (PLAN.md D208); with no limit set, no store is read at all.
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'

export type LedgerFailureKind = 'damaged' | 'unreadable' | 'integrity'
export class SpendLedgerError extends Error {
  public constructor(
    public readonly kind: LedgerFailureKind,
    public readonly facts: {
      readonly scope: string
      readonly file?: string
      readonly errno?: string | undefined
    },
    cause?: unknown,
  ) {
    let sentence: string
    switch (kind) {
      case 'damaged': {
        sentence = UI_TEXT.spendLedgerDamaged
        break
      }
      case 'unreadable': {
        sentence = UI_TEXT.spendLedgerUnreadable
        break
      }
      default: {
        sentence = UI_TEXT.spendLedgerIntegrity
      }
    }
    super(
      fill(sentence, { scope: facts.scope, file: facts.file ?? '', errno: facts.errno ?? '' }),
      { cause },
    )
    this.name = 'SpendLedgerError'
  }
}
export function isSpendLedgerError(error: unknown): error is SpendLedgerError {
  return (
    error instanceof Error &&
    error.name === 'SpendLedgerError' &&
    'kind' in error &&
    'facts' in error
  )
}
