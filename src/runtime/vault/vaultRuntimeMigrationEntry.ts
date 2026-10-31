// dist/vaultRuntimeMigration.js (RLF-M109): the runtime key-store
// migration's own lazy chunk beside dist/vaultRuntime.js, required on
// the first unlock edge in the CLI, the ACP agent or a headless run.
// The vault runtime bundle names only this entry's factory; the
// controller, the migration engine, its codecs and the first-party
// reader travel here, never with the agent's start. No `vscode` import.
import { VaultFirstPartyReader } from '../../core/vault/broker/firstParty'
import type { VaultBrokerClient } from '../../core/vault/broker/client'
import type { VaultManageSession } from '../../core/vault/broker/manageClient'
import {
  CredentialMigrationController,
  credentialMigrationPorts,
} from '../../host/vault/migrateCredentials'
import type { MigrationShell } from '../../host/vault/migrationShell'
import type { SecretStore } from '../../host/auth/credentialStore'
import type { Logger } from '../../host/logger'
import { readProvidersFile } from '../../core/providers/providersFile'
import { fileAccountsMetadata } from '../providers/providersFileStore'
import { migrateKeyStore } from './migrateKeyStore'
import type { KeyringEntryFactory } from '../keyStore'

export { setUiText } from '../../shared/l10n/text'

/** What the vault runtime hands the migration chunk on the first unlock edge. */
export interface RuntimeVaultMigrationDeps {
  /** The binding's broker-backed session; the chunk owns no connection. */
  readonly session: VaultManageSession
  /** The binding's broker connection, for the chunk's first-party reader. */
  readonly connect: () => Promise<VaultBrokerClient>
  /** Native entry access for the engine's legacy port (`migrateKeyStore`). */
  readonly openEntry: KeyringEntryFactory
  /**
  The raw OS-store reads the controller makes itself (the subscription
  probe and the diverged-copy source of truth), never the shell.
  */
  readonly rawSecrets: SecretStore
  readonly shell: MigrationShell
  /** The agent data folder holding the account pool's `providers.json`. */
  readonly dataDir: string
  /** The person's providers file; its configured ids are the migration's list. */
  readonly providersFile: string
  /** The installed release's minor ordinal; patches do not advance it. */
  readonly minorRelease: () => number
  readonly now: () => number
  readonly log: Logger
  /** The journal rows' label, read from the installed table by the caller. */
  readonly label: string
}

/** Build the controller against the binding's session, and bind its shell. */
export function bindRuntimeCredentialMigration(
  deps: RuntimeVaultMigrationDeps,
): CredentialMigrationController {
  const firstParty = new VaultFirstPartyReader(deps.connect)
  const ports = credentialMigrationPorts(deps.session, firstParty)
  const metadata = fileAccountsMetadata(deps.dataDir)
  const controller = new CredentialMigrationController({
    secrets: deps.rawSecrets,
    createMigration: (engineDeps, credentials) =>
      migrateKeyStore(deps.openEntry, engineDeps, credentials),
    // The runtime's configured providers, from the person's own file. A
    // missing file configures none (the model API key still migrates);
    // a damaged one throws, and the controller narrows the run and says so.
    listProviderIds: async () => {
      const read = await readProvidersFile(deps.providersFile)
      if (read.ok) return read.file.providers.map((entry) => entry.id)
      if (read.reason === 'missing') return []
      // The detail names the file, never a value; the controller logs
      // only its fixed narrowing sentence, so neither reaches output.
      throw read.cause === undefined
        ? new Error(read.detail)
        : new Error(read.detail, { cause: read.cause })
    },
    // RLM109's named input: the runtime's file-backed account pool.
    listAccounts: async (provider) => {
      const entry = await metadata.read(provider)
      return (entry?.accounts ?? []).map((account) => account.id)
    },
    ports,
    minorRelease: deps.minorRelease,
    now: deps.now,
    log: deps.log,
    label: deps.label,
  })
  deps.shell.bind(controller)
  return controller
}
