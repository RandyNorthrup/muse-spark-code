// The platform half of a vault connection, shared by dist/vaultRuntime.js
// and the VS Code bundle (dist/vault.js). Lane C-M109-1b binds it on Linux
// and macOS (owner-only run directory, peer.c peer check, node launch of
// dist/vaultBroker.js); lane C-M109-1c on Windows (the pipe helper's
// owner-only files, lock-bound pipe check). Until a lane binds this
// platform, the vault refuses with the broker-blocked reason, as 0.17.0 does.

import { UI_TEXT } from '../../shared/constants'
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
}

/** Bound per OS by lanes C-M109-1b and C-M109-1c; refuses until then. */
export function vaultClientPlatform(
  _context: VaultClientPlatformContext,
): Promise<VaultClientPlatform> {
  return Promise.reject(new Error(UI_TEXT.vault.brokerBlocked))
}
