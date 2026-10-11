import { type SecretStore } from '../auth/credentialStore'
import { VaultMigration } from '../../core/vault/migrate/migrate'
import {
  type MigrationCredential,
  type MigrationDeps,
  type LegacyCredentialPort,
  VaultMigrationFault,
} from '../../core/vault/migrate/ports'

/** Retains the exact installed release's keys. Never enumerates another application's store. */
export function migrateSecretStorage(
  secrets: SecretStore,
  deps: Omit<MigrationDeps, 'legacy'>,
  credentials: readonly MigrationCredential[],
): VaultMigration {
  const keys = new Set(credentials.map((entry) => entry.key))
  function check(key: string): void {
    if (!keys.has(key)) throw new VaultMigrationFault('invalid')
  }
  const legacy: LegacyCredentialPort = {
    async read(key) {
      check(key)
      const value = await secrets.get(key)
      if (value === undefined) return null
      const bytes = Buffer.alloc(Buffer.byteLength(value))
      bytes.write(value)
      return bytes
    },
    async write(key, value, authorize) {
      check(key)
      authorize()
      await secrets.store(key, new TextDecoder('utf-8', { fatal: true }).decode(value))
      authorize()
    },
    async remove(key, authorize) {
      check(key)
      authorize()
      await secrets.delete(key)
      authorize()
    },
  }
  return new VaultMigration({ ...deps, legacy }, credentials)
}
