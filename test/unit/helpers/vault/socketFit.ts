import { execFileSync } from 'node:child_process'
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

/**
This rig's process listing for the broker's exact-birth identity: darwin
reads it from /bin/ps. A rig that cannot list processes cannot prove
process birth, so the broker fail-closes a fresh vault as lost: suites
skip with this reason.
*/
export function hasProcessListing(): boolean {
  if (process.platform !== 'darwin') return true
  try {
    execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(process.pid)], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
Linux's OS store is the Secret Service, reached over the session bus: a
machine with no session bus (an SSH login, a CI runner) has no store, and
setup rightly refuses with the credential-store sentence. Such a rig skips
with this reason; a desktop session, or a private `dbus-run-session` with
an unlocked keyring, runs the flow.
*/
export function hasSessionBus(): boolean {
  return process.platform !== 'linux' || (process.env['DBUS_SESSION_BUS_ADDRESS'] ?? '') !== ''
}

/**
Whether a POSIX broker suite skips on this rig: Windows owns the
pipe-relay suites instead, and a rig without socket fit, process
listing or a session bus cannot run the broker or the native store.
*/
export function shouldSkipPosixBrokerSuite(): boolean {
  return (
    process.platform === 'win32' ||
    !hasBrokerSocketFit() ||
    !hasProcessListing() ||
    !hasSessionBus()
  )
}
