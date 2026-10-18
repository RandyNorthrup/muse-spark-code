import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {
  UI_TEXT,
  VAULT_SOCKET_DIR_HASH_CHARS,
  VAULT_SOCKET_DIR_PREFIX,
  VAULT_SOCKET_FILE,
  VAULT_SOCKET_PATH_LIMIT_BYTES,
} from '../../../shared/constants'
import { isVaultFileMissing } from './files'

/**
 * RVCM109JE P2-3: the broker socket's bounded owner-only home. The default
 * data folder (`~/Library/Application Support/Muse Spark Code` on macOS)
 * already exceeds Darwin's bindable socket length, so the socket never lives
 * under the data folder. The leaf directory names a short hash of the data
 * folder, so two data folders never share a broker; the broker record in the
 * data folder still carries the full socket path.
 */
export interface VaultSocketBaseInput {
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  readonly tmpdir: string
  readonly homeDir: string
}

/** Usable socket-path bytes on this platform, before the terminator. */
export function vaultSocketPathLimit(platform: NodeJS.Platform): number {
  return platform === 'darwin'
    ? VAULT_SOCKET_PATH_LIMIT_BYTES.darwin
    : VAULT_SOCKET_PATH_LIMIT_BYTES.other
}

/**
 * Ordered socket-base candidates. On Linux the per-user runtime directory is
 * preferred when set; everywhere else the OS temporary directory is the home.
 * Every candidate is verified before use; a failed candidate falls through.
 */
export function vaultSocketBaseCandidates(input: VaultSocketBaseInput): string[] {
  const runtimes =
    input.platform === 'linux' &&
    input.env['XDG_RUNTIME_DIR'] !== undefined &&
    input.env['XDG_RUNTIME_DIR'] !== '' &&
    path.posix.isAbsolute(input.env['XDG_RUNTIME_DIR'] ?? '')
      ? [input.env['XDG_RUNTIME_DIR'] ?? '']
      : []
  const candidates = [...runtimes, input.tmpdir].filter((candidate) => candidate !== '')
  return [...new Set(candidates)]
}

/** The socket directory and path for one data folder under one base. Pure. */
export function vaultBrokerSocketIn(
  base: string,
  dataDir: string,
): { directory: string; socket: string } {
  const leaf = `${VAULT_SOCKET_DIR_PREFIX}${createHash('sha256')
    .update(dataDir)
    .digest('hex')
    .slice(0, VAULT_SOCKET_DIR_HASH_CHARS)}`
  const directory = path.join(base, leaf)
  return { directory, socket: path.join(directory, VAULT_SOCKET_FILE) }
}

/**
 * The created fallback base: a per-user run directory under the home folder.
 * Only reached when no shared base verifies (headless Linux without a
 * runtime directory, or a world-writable temporary root): it is created
 * owner-only here, never an existing user directory re-permissioned.
 */
export function vaultSocketFallbackBase(homeDir: string): string | null {
  return path.posix.isAbsolute(homeDir) || path.win32.isAbsolute(homeDir)
    ? path.join(homeDir, '.muse-spark-code', 'run')
    : null
}

/** Every expected socket location for one data folder. Pure. */
export function expectedVaultSocketLocations(
  dataDir: string,
  input: VaultSocketBaseInput,
): { directory: string; socket: string }[] {
  const bases = [...vaultSocketBaseCandidates(input)]
  const fallback = vaultSocketFallbackBase(input.homeDir)
  if (fallback !== null && !bases.includes(fallback)) bases.push(fallback)
  return bases.map((base) => vaultBrokerSocketIn(base, dataDir))
}

function checkOwnerOnlyDirectory(sample: {
  isDirectory(): boolean
  isSymbolicLink(): boolean
  uid: number
  mode: number
}): void {
  if (
    !sample.isDirectory() ||
    sample.isSymbolicLink() ||
    sample.uid !== process.getuid?.() ||
    (sample.mode & constants.S_IRWXG) !== 0 ||
    (sample.mode & constants.S_IRWXO) !== 0 ||
    (sample.mode & constants.S_IRWXU) !== constants.S_IRWXU
  )
    throw new Error(UI_TEXT.vault.noAccess)
}

/** A socket base must already exist: owner-only, never created here. */
export async function verifyVaultSocketBase(directory: string): Promise<void> {
  const sample = await lstat(directory)
  checkOwnerOnlyDirectory(sample)
}

/** Create (when absent) and verify the leaf socket directory. */
export async function ensureVaultSocketDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const sample = await lstat(directory)
  checkOwnerOnlyDirectory(sample)
}

/** Byte length before bind; a sentence, never a bare code. */
export function assertVaultSocketLength(socket: string, platform: NodeJS.Platform): void {
  if (Buffer.byteLength(socket, 'utf8') > vaultSocketPathLimit(platform))
    throw new Error(UI_TEXT.vault.brokerBlocked)
}

/**
 * Resolve, create and verify the socket location for one data folder: the
 * first candidate base that verifies supplies it. Refuses with the broker
 * sentence when no base verifies or even the bounded location is too long.
 */
export async function resolveVaultSocket(
  dataDir: string,
  input: VaultSocketBaseInput,
): Promise<{ directory: string; socket: string }> {
  if (!path.isAbsolute(dataDir)) throw new Error(UI_TEXT.vault.noAccess)
  for (const base of vaultSocketBaseCandidates(input)) {
    try {
      await verifyVaultSocketBase(base)
    } catch {
      continue
    }
    // Length before any side effect: an over-long candidate simply loses.
    const location = vaultBrokerSocketIn(base, dataDir)
    try {
      assertVaultSocketLength(location.socket, input.platform)
    } catch {
      continue
    }
    await ensureVaultSocketDirectory(location.directory)
    return location
  }
  // Last resort: a run directory of our own under the home folder, created
  // owner-only. Still length-checked: when even the bounded location is too
  // long, the broker refuses in a sentence.
  const fallback = vaultSocketFallbackBase(input.homeDir)
  if (fallback !== null) {
    const location = vaultBrokerSocketIn(fallback, dataDir)
    assertVaultSocketLength(location.socket, input.platform)
    await ensureVaultSocketDirectory(location.directory)
    return location
  }
  throw new Error(UI_TEXT.vault.brokerBlocked)
}

/**
 * The client verifies the socket owner before it speaks: a kernel socket of
 * this user, never a symlink or another type. An absent socket is not a
 * verdict here: the caller connects next and reports that failure with its
 * own starting/stopping meaning. Reachability is already bounded by the
 * owner-only socket directory (verified before bind and before connect);
 * the broker additionally chmods the bound socket owner-only after bind.
 */
export async function verifyVaultSocketFile(socket: string): Promise<void> {
  let sample
  try {
    sample = await lstat(socket)
  } catch (error: unknown) {
    if (isVaultFileMissing(error)) return
    throw error
  }
  if (sample.isSymbolicLink() || !sample.isSocket() || sample.uid !== process.getuid?.())
    throw new Error(UI_TEXT.vault.noAccess)
}

/**
 * Containment by resolved identity, never by spelling: `/var` and
 * `/private/var` name the same macOS temporary root, so both sides resolve
 * before comparing. Falls back to a normalized spelling compare only while a
 * side is absent.
 */
function isWithinSpelling(relative: string): boolean {
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

/**
 * Whether a broker record's socket stays inside one of the data folder's own
 * locations. A foreign record never directs a client or a cleanup elsewhere.
 */
export async function isExpectedVaultSocket(
  socket: string,
  locations: { directory: string; socket: string }[],
): Promise<boolean> {
  for (const location of locations) {
    if (await isPathWithin(socket, location.directory)) return true
  }
  return false
}

export async function isPathWithin(file: string, directory: string): Promise<boolean> {
  if (isWithinSpelling(path.relative(path.resolve(directory), path.resolve(file)))) return true
  try {
    const [parent, root] = await Promise.all([realpath(path.dirname(file)), realpath(directory)])
    return isWithinSpelling(path.relative(root, path.join(parent, path.basename(file))))
  } catch {
    return false
  }
}
