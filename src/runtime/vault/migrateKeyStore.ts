import { keyringSecretStore, type KeyringEntryFactory } from '../keyStore'
import { migrateSecretStorage } from '../../host/vault/migrateSecretStorage'
import { type MigrationCredential, type MigrationDeps } from '../../core/vault/migrate/ports'
import { type VaultMigration } from '../../core/vault/migrate/migrate'

/** Native entry access remains in-process, preserving D61's service/account and stdin entry flow. */
export function migrateKeyStore(
  openEntry: KeyringEntryFactory,
  deps: Omit<MigrationDeps, 'legacy'>,
  credentials: readonly MigrationCredential[],
): VaultMigration {
  return migrateSecretStorage(keyringSecretStore(openEntry), deps, credentials)
}
