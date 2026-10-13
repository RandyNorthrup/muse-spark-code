// Portable typed spend failures: no filesystem or process dependency.
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'
import type { UsdAmount } from '../../shared/usd'

export type LedgerFailureKind =
  'budget' | 'busy' | 'damaged' | 'unreadable' | 'recovery' | 'integrity' | 'legacy'
export class SpendLedgerError extends Error {
  public constructor(
    public readonly kind: LedgerFailureKind,
    public readonly facts: {
      readonly scope: string
      readonly file?: string
      readonly errno?: string | undefined
      readonly bound?: UsdAmount
      readonly total?: UsdAmount
      readonly cap?: UsdAmount
    },
    cause?: unknown,
  ) {
    let sentence: string
    switch (kind) {
      case 'budget': {
        sentence = fill(UI_TEXT.spendLedgerBudget, {
          total: formatUsd(facts.total ?? 0),
          bound: formatUsd(facts.bound ?? 0),
          cap: formatUsd(facts.cap ?? 0),
        })
        break
      }
      case 'busy': {
        sentence = UI_TEXT.spendLedgerBusy
        break
      }
      case 'damaged': {
        sentence = UI_TEXT.spendLedgerDamaged
        break
      }
      case 'unreadable': {
        sentence = UI_TEXT.spendLedgerUnreadable
        break
      }
      case 'legacy': {
        sentence = fill(UI_TEXT.sessionBudgetLegacyFeesUnknown, {
          scope: facts.scope,
          spent: formatUsd(facts.total ?? 0),
        })
        break
      }
      case 'recovery': {
        sentence = UI_TEXT.spendLedgerRecovery
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
