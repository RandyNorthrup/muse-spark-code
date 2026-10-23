// The third lazy vault bundle: dist/vaultMigration.js beside the running
// bundle, required on the first unlock edge that needs it, never with the
// panel or at activation. Only types and this loader stay in dist/vault.js,
// the way vaultActionsBundle.ts stays in the opening bundle for its own.
import type { VaultBrokerClient } from '../../core/vault/broker/client'
import type { VaultManageSession } from '../../core/vault/broker/manageClient'
import { UI_TEXT } from '../../shared/constants'
import { fixedMessageLog, lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type { SecretStore } from '../auth/credentialStore'
import type { CredentialMigrationController } from './migrateCredentials'
import type { MigrationShell } from './migrationShell'

/** What dist/vaultMigration.js exports. Only values read here may be used from dist/vault.js. */
export interface VaultMigrationBundle {
  readonly bindCredentialMigration: (
    deps: VaultMigrationFactoryDeps,
  ) => CredentialMigrationController
}

export interface VaultMigrationFactoryDeps {
  /** The binding's broker-backed session; the chunk owns no connection. */
  readonly session: VaultManageSession
  /** The binding's broker connection, for the chunk's first-party reader. */
  readonly connect: () => Promise<VaultBrokerClient>
  /** The raw SecretStorage; the shell mirrors through the migration, never the reverse. */
  readonly secrets: SecretStore
  readonly shell: MigrationShell
  /** Configured provider ids; the controller adds the ChatGPT slot itself when stored, and grok stays with its own lane. */
  readonly listProviderIds: () => Promise<readonly string[]>
  /**
  Pooled account ids per provider, from the host's account metadata.
  Absent where the host binds no account pool yet.
  */
  readonly listAccounts?: (provider: string) => Promise<readonly string[]>
  /** The installed release's minor ordinal; patches do not advance it. */
  readonly minorRelease: () => number
  readonly now: () => number
  readonly log: Logger
  /** The journal rows' label, read from the installed table by the caller. */
  readonly label: string
}

/** Whether a required module exports the migration factory. */
export function isVaultMigrationBundle(value: unknown): value is VaultMigrationBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'bindCredentialMigration' in value &&
    typeof value.bindCredentialMigration === 'function'
  )
}

export interface VaultMigrationLoaderDeps {
  /** dist/vaultMigration.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/**
The migration chunk, required on the first unlock edge and kept from then
on. A missing or corrupt chunk throws the operation failure sentence and
is tried again at the next unlock (the log names the bundle, never a
credential).
*/
export function vaultMigrationLoader(deps: VaultMigrationLoaderDeps): () => VaultMigrationBundle {
  return lazyBundleLoader({
    ...deps,
    log: fixedMessageLog({
      log: deps.log,
      loadFailed: 'The vault migration bundle could not be loaded',
      wrongShape: 'The vault migration bundle does not export the migration',
    }),
    isBundle: isVaultMigrationBundle,
    label: 'vault migration bundle',
    unavailable: () => UI_TEXT.vault.operationFailed,
  })
}
