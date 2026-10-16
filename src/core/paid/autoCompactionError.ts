// Shared by consent and lazy admission without loading either runtime.
const AUTO_COMPACTION_NOT_AUTHORIZED = 'AutoCompactionNotAuthorizedError'

/** Withdrawal refuses this compaction, independently of the spend ledger. */
export class AutoCompactionNotAuthorizedError extends Error {
  public constructor() {
    super()
    this.name = AUTO_COMPACTION_NOT_AUTHORIZED
  }
}

/** Admission and the lazy Model API host carry separate copies of the class. */
export function isAutoCompactionNotAuthorizedError(
  error: unknown,
): error is AutoCompactionNotAuthorizedError {
  return error instanceof Error && error.name === AUTO_COMPACTION_NOT_AUTHORIZED
}
