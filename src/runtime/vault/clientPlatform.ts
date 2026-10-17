// The platform half of a vault connection, shared by dist/vaultRuntime.js
// and the VS Code bundle (dist/vault.js). POSIX (Linux and macOS) is bound
// here (owner-only run directory, peer.c peer check, node launch of
// dist/vaultBroker.js); Windows follows through the pipe helper in lane
// C-M109-1c. While the reviewed availability switch is off, public callers
// refuse; every broker use still refuses while the broker is unavailable.

import { uiLocale } from '../../shared/l10n/text'
import { UI_TEXT, VAULT_AVAILABILITY } from '../../shared/constants'
import type { VaultBrokerDiscovery } from '../../core/vault/broker/discovery'
import type { VaultPeerVerifier } from '../../core/vault/broker/peer'
import type { VaultBrokerProcessPort } from '../../host/vault/brokerProcess'

export interface VaultClientPlatform {
  /** Removes this client's native registration; it never signals the session broker. */
  readonly dispose?: () => void
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
  if (!VAULT_AVAILABILITY.isBrokerAvailable)
    throw Object.assign(new Error(UI_TEXT.vault.brokerDisabled), { code: 'vaultDisabled' })
  const { posixVaultClientPlatform, setUiText } = await import('./posixClientPlatform')
  setUiText(UI_TEXT, uiLocale())
  return await posixVaultClientPlatform(context)
}
