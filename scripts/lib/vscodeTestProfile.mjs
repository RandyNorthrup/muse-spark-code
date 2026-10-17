// A short user-data directory for the integration tests when the default one
// would not fit a Unix socket path (M72 release, PLAN.md D51).
//
// VS Code listens on `<user-data-dir>/<major.minor>-main.sock`, and the
// operating system caps a Unix socket path: 104 bytes on macOS and 108 on
// Linux, each including the terminating NUL. @vscode/test-electron puts the
// user data in `<checkout>/.vscode-test/user-data`, so a checkout under a long
// path (a rig's scratch folder) makes VS Code fail before any test with
// `listen EINVAL .../user-data/1.14-main.sock`. Windows uses a named pipe and
// has no such cap. A checkout whose default path fits is left alone, so CI and
// short paths keep the directory they always had.

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import path from 'node:path'

const SOCKET_PATH_LIMITS = { darwin: 103, linux: 107 }
// "/1.140-main.sock" is 16 bytes; the rest is room for a longer version.
const SOCKET_NAME_ALLOWANCE = 24
const CHECKOUT_HASH_LENGTH = 8

/**
 * The launch arguments for one integration run. A default that fits keeps
 * `base` as it is; one that does not gets a short, per-checkout, per-label
 * directory under the system temporary folder. A folder that still cannot fit
 * is an error naming both lengths, never a silent fallback.
 */
export function launchArgsFor({ base, label, checkout, platform, tmp }) {
  const limit = SOCKET_PATH_LIMITS[platform]
  if (limit === undefined) {
    return base
  }
  const canListen = (dir) => Buffer.byteLength(dir) + SOCKET_NAME_ALLOWANCE <= limit
  const defaultDir = path.join(checkout, '.vscode-test', 'user-data')
  if (canListen(defaultDir)) {
    return base
  }
  const tag = createHash('sha256').update(checkout).digest('hex').slice(0, CHECKOUT_HASH_LENGTH)
  const shortDir = path.join(tmp, `muse-vsct-${tag}-${label}`)
  if (!canListen(shortDir)) {
    throw new Error(
      `VS Code's socket path needs at most ${String(limit)} bytes, and even ${shortDir} (${String(Buffer.byteLength(shortDir))} bytes plus ${String(SOCKET_NAME_ALLOWANCE)} for its name) does not fit: set TMPDIR to a shorter folder`,
    )
  }
  return [...base, `--user-data-dir=${shortDir}`]
}
