// The platform half of a vault connection, shared by dist/vaultRuntime.js
// and the VS Code bundle (dist/vault.js). Lane C-M109-1b binds it on Linux
// and macOS (owner-only run directory, peer.c peer check, node launch of
// dist/vaultBroker.js); lane C-M109-1c on Windows (the pipe helper's
// owner-only files, lock-bound pipe check). Until a lane binds this
// platform and the reviewed availability switch is on, public callers refuse.

import { uiLocale } from '../../shared/l10n/text'
import { UI_TEXT, VAULT_AVAILABILITY } from '../../shared/constants'
import type { VaultBrokerDiscovery } from '../../core/vault/broker/discovery'
import type { VaultPeerVerifier } from '../../core/vault/broker/peer'
import type { VaultBrokerProcessPort } from '../../host/vault/brokerProcess'

export interface VaultClientPlatform {
  /** `vault/run` under dataDir, through this OS's owner-only files port. */
  readonly discovery: VaultBrokerDiscovery
  /** Process identity and the credential-free launch of dist/vaultBroker.js. */
  readonly process: VaultBrokerProcessPort
  /** Checks the broker's end of each connection against the lock file's process. */
  readonly peers: VaultPeerVerifier
}
export interface VaultClientPlatformContext {
  /** The runtime's per-user data folder; the vault lives in its `vault/`. */
  readonly dataDir: string
  /** dist/ beside the running bundle (vaultBroker.js, native helpers). */
  readonly distDir: string
  readonly hostId: string
  readonly hostSession: string
}

/** The reviewed availability switch gates every public host before any platform read or launch. */
export async function vaultClientPlatform(
  context: VaultClientPlatformContext,
): Promise<VaultClientPlatform> {
  if (!VAULT_AVAILABILITY.isBrokerAvailable) throw new Error(UI_TEXT.vault.brokerBlocked)
  const { posixVaultClientPlatform, setUiText } = await import('./posixClientPlatform')
  setUiText(UI_TEXT, uiLocale())
  return await posixVaultClientPlatform(context)
}
