// M124 (D106, RVM124 finding 15): the connector store's storage guard port.
// Grants, the kill switch and the audit key live in the agent's data
// folder, outside every repository. The guard makes each file and folder
// the store creates private to the current account and verifies the whole
// tree before the connector serves or widens authority. A refusal carries
// a fixed code and a reason word, never a path: the entry maps it to the
// owner's sentence. The guard itself loads as its own lazy chunk
// (dist/connectorStoreGuard.js), so dist/connector.js stays lean; this
// module is the port alone, safe to import on both sides.
export const CONNECTOR_STORAGE_REFUSED = 'ECONNECTOR_STORAGE'

/** Why storage was refused, as a fixed word: owner, access, link, kind or scope. */
export type ConnectorStorageReason = 'owner' | 'access' | 'link' | 'kind' | 'scope'

export interface ConnectorStorageGuard {
  /**
  Makes one path the store just created private to the current account
  (an explicit owner-only DACL on Windows, 0600/0700 owned by this user
  on POSIX, with macOS extended ACLs refused), read back before use.
  Throws a storage refusal when the path escapes the root or cannot be
  made private; securing is idempotent.
  */
  readonly secure: (file: string, kind: 'file' | 'directory') => Promise<void>
  /**
  Verifies the root and everything below it without repairing anything:
  the trust anchor above the root, every component a real file or folder
  owned by this account with no foreign grant, and the audit key as one
  of the leaves. Missing paths are skipped (fresh storage has nothing to
  protect); anything present but not private throws a storage refusal.
  */
  readonly verify: () => Promise<void>
}

/** A storage refusal, whatever threw it and in whichever bundle it was built. */
export function isStorageRefused(error: unknown): error is Error & {
  readonly code: typeof CONNECTOR_STORAGE_REFUSED
  readonly reason: ConnectorStorageReason
} {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === CONNECTOR_STORAGE_REFUSED &&
    'reason' in error &&
    typeof error.reason === 'string'
  )
}
