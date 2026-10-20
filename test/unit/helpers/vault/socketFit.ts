import { realpathSync } from 'node:fs'
import os from 'node:os'
import {
  VAULT_SOCKET_DIR_HASH_CHARS,
  VAULT_SOCKET_DIR_PREFIX,
  VAULT_SOCKET_FILE,
  VAULT_SOCKET_PATH_LIMIT_BYTES,
} from '../../../../src/shared/constants'

/**
This rig's runtime base for the broker socket: XDG_RUNTIME_DIR where set,
else the temporary root, resolved through links (macOS spells its
temporary root through /var, a symlink to /private/var). Unresolvable
stays as written; callers skip on the checks below.
*/
export function resolveRuntimeBase(): string {
  let runtimeBase = process.env['XDG_RUNTIME_DIR'] ?? os.tmpdir()
  try {
    runtimeBase = realpathSync(runtimeBase)
  } catch {
    /* Callers skip when the base is unusable. */
  }
  return runtimeBase
}

/**
Whether this rig's temporary root fits the broker socket within the bind
limit: the leaf the broker adds is fixed size, so a temporary root longer
than the limit minus that leaf cannot fit the socket on this OS. Rigs
whose temporary root cannot fit it would hang to the test timeout waiting
for a readiness the refused broker never sends, so suites skip at
collection with this reason instead.
*/
export function hasBrokerSocketFit(): boolean {
  const runtimeBase = resolveRuntimeBase()
  const socketLength =
    Buffer.byteLength(runtimeBase, 'utf8') +
    1 +
    VAULT_SOCKET_DIR_PREFIX.length +
    VAULT_SOCKET_DIR_HASH_CHARS +
    1 +
    VAULT_SOCKET_FILE.length
  return (
    socketLength <=
    VAULT_SOCKET_PATH_LIMIT_BYTES[process.platform === 'darwin' ? 'darwin' : 'other']
  )
}
