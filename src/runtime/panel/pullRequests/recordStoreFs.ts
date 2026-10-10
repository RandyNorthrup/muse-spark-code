// The file operations under the worktree records' lease and generations
// (M123, PLAN.md M123's lock protocol): node's own (core/locks/
// nodeLeasePort.ts), or a test's wrapper that pauses one call to stand two
// windows' interleaving exactly where it matters (a delayed old owner, a
// takeover between a read and a rename).

import type { LeasePort } from '../../../core/locks/fileLease'
import { nodeLeasePort } from '../../../core/locks/nodeLeasePort'

/** The lease's operations, which are all the record generations need too. */
export type RecordStoreFs = LeasePort

export const nodeRecordStoreFs: RecordStoreFs = nodeLeasePort

/** A lease instance moved aside by a takeover or release, removed right after (or swept). */
export const RETIRED_LOCK_SUFFIX = '.retired'

export function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}
