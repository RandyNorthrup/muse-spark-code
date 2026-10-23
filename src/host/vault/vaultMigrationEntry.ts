// dist/vaultMigration.js: the key-store migration's own lazy chunk (D89.14
// lane M). The opening bundle names only this entry's factory; the engine,
// its codecs and the first-party reader travel here, on the first unlock
// edge only.
import { VaultFirstPartyReader } from '../../core/vault/broker/firstParty'
import { CredentialMigrationController, type CredentialMigrationPorts } from './migrateCredentials'
import type { VaultMigrationFactoryDeps } from './vaultMigrationBundle'

/** Build the controller against the binding's session, and bind its shell. */
export function bindCredentialMigration(
  deps: VaultMigrationFactoryDeps,
): CredentialMigrationController {
  const firstParty = new VaultFirstPartyReader(deps.connect)
  const ports: CredentialMigrationPorts = {
    snapshot: () => deps.session.snapshot(),
    write: (...args) => deps.session.write(...args),
    remove: (...args) => deps.session.remove(...args),
    firstPartyRead: (...args) => firstParty.read(...args),
  }
  const controller = new CredentialMigrationController({
    secrets: deps.secrets,
    listProviderIds: deps.listProviderIds,
    ...(deps.listAccounts !== undefined && { listAccounts: deps.listAccounts }),
    ports,
    minorRelease: deps.minorRelease,
    now: deps.now,
    log: deps.log,
    label: deps.label,
  })
  deps.shell.bind(controller)
  return controller
}
