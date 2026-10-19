import { type SecretStore } from '../auth/credentialStore'
import { VaultMigration } from '../../core/vault/migrate/migrate'
import {
  type MigrationCredential,
  type MigrationDeps,
  type LegacyCredentialPort,
  VaultMigrationFault,
} from '../../core/vault/migrate/ports'

/**
 * The SecretStorage side of a migration, shared by every legacy adapter:
 * only the migration's declared keys are reachable, and values cross as
 * owned bytes the engine erases. Retains the exact installed release's keys
 * and never enumerates another application's store.
 */
export function secretStorageLegacyPort(
  secrets: SecretStore,
  keys: readonly string[],
): LegacyCredentialPort {
  const known = new Set(keys)
  function check(key: string): void {
    if (!known.has(key)) throw new VaultMigrationFault('invalid')
  }
  return {
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
      try {
        await secrets.store(key, new TextDecoder('utf-8', { fatal: true }).decode(value))
      } finally {
        authorize()
      }
    },
    async remove(key, authorize) {
      check(key)
      authorize()
      try {
        await secrets.delete(key)
      } finally {
        authorize()
      }
    },
  }
}

/** Retains the exact installed release's keys. Never enumerates another application's store. */
export function migrateSecretStorage(
  secrets: SecretStore,
  deps: Omit<MigrationDeps, 'legacy'>,
  credentials: readonly MigrationCredential[],
): VaultMigration {
  const legacy = secretStorageLegacyPort(
    secrets,
    credentials.map((entry) => entry.key),
  )
  return new VaultMigration({ ...deps, legacy }, credentials)
}
