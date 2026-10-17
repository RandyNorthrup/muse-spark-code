/** Why a run command was refused; the host says it in the user's language. */
const REFUSALS = [
  'noWorkspace',
  'untrusted',
  'wrongBackend',
  'paidOff',
  'invalid',
  'unknownModel',
  'consentDeclined',
  'worktreeFailed',
  'alreadyRunning',
  'noRun',
  'unknownAttempt',
  'attemptNotDone',
  'alreadyTaken',
  'contextChanged',
  'targetChanged',
  'budgetUnavailable',
] as const
export type BestOfNRefusal = (typeof REFUSALS)[number]
const REFUSAL_NAMES: readonly string[] = REFUSALS

export class BestOfNError extends Error {
  public constructor(
    public readonly refusal: BestOfNRefusal,
    public readonly detail?: string,
  ) {
    super(detail === undefined ? refusal : `${refusal}: ${detail}`)
    this.name = 'BestOfNError'
  }
}

/** Same-build error fields, including a known refusal, cross bundle copies (PLAN.md §8). */
export function isBestOfNError(value: unknown): value is BestOfNError {
  return (
    value instanceof Error &&
    value.name === 'BestOfNError' &&
    'refusal' in value &&
    typeof value.refusal === 'string' &&
    REFUSAL_NAMES.includes(value.refusal) &&
    (!('detail' in value) || value.detail === undefined || typeof value.detail === 'string')
  )
}
