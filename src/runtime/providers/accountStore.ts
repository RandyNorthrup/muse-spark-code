// ACP/CLI/headless use the same core store and names as the panel. Lane H
// supplies the real providers-file adapter; M109 may replace the injected vault.
import { AccountStore, type AccountsMetadataPort } from '../../core/providers/accounts'
import type { AccountCredentialVault } from '../../core/providers/credentialRecord'
import {
  AccountSecrets,
  secretStorageAccountVault,
  type AccountSecretsDeps,
} from '../../host/providers/accountSecrets'
import { keyringSecretStore, type KeyringEntryFactory } from '../keyStore'

export function runtimeAccountStore(deps: {
  readonly metadata: AccountsMetadataPort
  readonly openEntry: KeyringEntryFactory
  readonly revokeSignIn: AccountSecretsDeps['revokeSignIn']
  readonly vault?: AccountCredentialVault | undefined
  readonly registerSecret?: AccountSecretsDeps['registerSecret']
}): { readonly accounts: AccountStore; readonly dispose: () => void } {
  const credentials = new AccountSecrets({
    vault: deps.vault ?? secretStorageAccountVault(keyringSecretStore(deps.openEntry)),
    revokeSignIn: deps.revokeSignIn,
    registerSecret: deps.registerSecret,
  })
  return {
    accounts: new AccountStore(deps.metadata, credentials),
    dispose: () => {
      credentials.dispose()
    },
  }
}
