// The OS-store accounts a vault root owns (RLVAULTANCHOR, 2026-10-21).
//
// The rollback anchor used to live under one fixed account per OS user, so a
// vault anywhere else — a test's throwaway root included — read and wrote the
// person's real anchor (found on the owner's PC: a suite run's throwaway
// vault left the real account naming a deleted vault, and `vault status`
// said vaultLost). Every record a vault writes under KEYRING_SERVICE is now
// keyed to the canonical broker root that owns it:
//
// - the rollback anchor: `vault-anchor-v1:<sha256 of the canonical root>`
// - the audit checkpoint and pending intent: `vault-audit-v1:<root>:<vaultId>`
//   and `vault-audit-pending-v1:<root>:<vaultId>`
// - an OS-store slot key: `vault.<root>.<vaultId>.<slotId>`
//
// A vault at the person's own root keeps reading and writing the pre-scoping
// names (`vault-anchor-v1`, `vault-audit-v1:<vaultId>`, `vault.<vaultId>.<slotId>`)
// through each record's legacy fallback, so existing vaults keep working
// unchanged; a vault at any other root can never name them. Which root is
// "the person's own" is never guessed from the environment (a test's
// throwaway LOCALAPPDATA would pass that test): the legacy record is adopted
// only when it names this root's own vault id.

import { createHash } from 'node:crypto'
import path from 'node:path'

/** The OS-store account of the pre-scoping anchor record (service: KEYRING_SERVICE). */
export const VAULT_ANCHOR_ACCOUNT = 'vault-anchor-v1'

/** The broker's data folder for a client's data folder: the vault lives in its `vault/`. */
export function vaultBrokerDataDir(clientDataDir: string): string {
  return path.join(clientDataDir, 'vault')
}

/**
The canonical spelling of a vault root for store scoping: resolved, with
`/` separators on every platform (Windows spellings compare equal), and
lower-cased where the file system is case-insensitive.
*/
export function canonicalVaultRoot(brokerDataDir: string): string {
  const resolved = path.resolve(brokerDataDir).replaceAll('\\', '/')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** The SHA-256 (hex) of the canonical root naming one vault's store records. */
export function vaultRootHash(brokerDataDir: string): string {
  return createHash('sha256').update(canonicalVaultRoot(brokerDataDir), 'utf8').digest('hex')
}

/** This root's rollback-anchor account. */
export function vaultAnchorAccount(brokerDataDir: string): string {
  return `${VAULT_ANCHOR_ACCOUNT}:${vaultRootHash(brokerDataDir)}`
}

/** This root's audit-checkpoint account for one of its vaults. */
export function vaultAuditAccount(brokerDataDir: string, vaultId: string): string {
  return `vault-audit-v1:${vaultRootHash(brokerDataDir)}:${vaultId}`
}

/** This root's audit-pending account for one of its vaults. */
export function vaultAuditPendingAccount(brokerDataDir: string, vaultId: string): string {
  return `vault-audit-pending-v1:${vaultRootHash(brokerDataDir)}:${vaultId}`
}

/** The pre-scoping audit-checkpoint account, read only as this vault's fallback. */
export function legacyVaultAuditAccount(vaultId: string): string {
  return `vault-audit-v1:${vaultId}`
}

/** The pre-scoping audit-pending account, read only as this vault's fallback. */
export function legacyVaultAuditPendingAccount(vaultId: string): string {
  return `vault-audit-pending-v1:${vaultId}`
}

/** This root's OS-store slot-key reference for one of its slots. */
export function vaultSlotReference(brokerDataDir: string, vaultId: string, slotId: string): string {
  return `vault.${vaultRootHash(brokerDataDir)}.${vaultId}.${slotId}`
}

/** The pre-scoping slot-key reference, opened only for this vault's own records. */
export function legacyVaultSlotReference(vaultId: string, slotId: string): string {
  return `vault.${vaultId}.${slotId}`
}
