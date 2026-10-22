import { lstat, readFile, realpath, statfs } from 'node:fs/promises'
import path from 'node:path'
import type { PosixPeerInstallation } from './posixPeer'

// Kernel filesystem ABI, deliberately allowlisted. Unknown types fail closed.
const FS_MAGIC = {
  ext: 0x00_00_ef_53,
  xfs: 0x58_46_53_42,
  btrfs: 0x91_23_68_3e,
  f2fs: 0xf2_f5_20_10,
}
const LOCAL_FILESYSTEMS = new Map([
  ['ext2', FS_MAGIC.ext],
  ['ext3', FS_MAGIC.ext],
  ['ext4', FS_MAGIC.ext],
  ['xfs', FS_MAGIC.xfs],
  ['btrfs', FS_MAGIC.btrfs],
  ['f2fs', FS_MAGIC.f2fs],
])
const MOUNT_LAYOUT = {
  mountPoint: 4,
  filesystem: 0,
  source: 1,
  writableMask: 0o022,
  stickyBit: 0o1000,
}

function mountPath(value: string): string {
  return value.replaceAll(/\\(040|011|012|134)/g, (_match, octal: string) =>
    String.fromCodePoint(Number.parseInt(octal, 8)),
  )
}

/** Cross-check the deepest mount and statfs; a local ancestor proves nothing. */
export async function verifyLinuxLocalVolume(file: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  if (process.platform !== 'linux') throw new Error('unverified-platform')
  const canonical = await realpath(file)
  if (canonical !== path.resolve(file)) throw new Error('unverified-model-root')
  const mountinfo = await readFile('/proc/self/mountinfo', 'utf8')
  const mounts = mountinfo.trim().split('\n')
  let deepest = ''
  let filesystem = ''
  let source = ''
  for (const row of mounts) {
    const [left, right] = row.split(' - ', 2)
    const prefix = left?.split(' ')
    const suffix = right?.split(' ')
    const encoded = prefix?.at(MOUNT_LAYOUT.mountPoint)
    if (!encoded || !suffix) throw new Error('unverified-model-volume')
    const mount = mountPath(encoded)
    if (canonical !== mount && !canonical.startsWith(mount === '/' ? '/' : `${mount}/`)) continue
    if (mount.length === deepest.length) throw new Error('unverified-model-volume')
    if (mount.length < deepest.length) continue
    deepest = mount
    filesystem = suffix[MOUNT_LAYOUT.filesystem] ?? ''
    source = mountPath(suffix[MOUNT_LAYOUT.source] ?? '')
  }
  const magic = LOCAL_FILESYSTEMS.get(filesystem)
  if (!deepest || magic === undefined || !source.startsWith('/dev/'))
    throw new Error('unverified-model-volume')
  const actual = await statfs(canonical)
  signal.throwIfAborted()
  // Block-device origin excludes a bind of a disguised remote/virtual scope.
  if (actual.type !== magic) throw new Error('unverified-model-volume')
}

/** No symlink component, foreign owner or group/world-writable install anchor. */
export async function verifyLinuxAnchor(
  file: string,
  uid: number,
  kind: 'file' | 'directory',
  signal: AbortSignal,
  /** Model contents stop at the already-vetted root; installation checks include all ancestors. */
  anchorRoot?: string,
): Promise<void> {
  signal.throwIfAborted()
  if ((await realpath(file)) !== path.resolve(file)) throw new Error('unverified-installation')
  for (
    let current = file;
    current;
    current =
      current === anchorRoot || current === path.dirname(current) ? '' : path.dirname(current)
  ) {
    const info = await lstat(current)
    if (
      info.isSymbolicLink() ||
      (info.uid !== 0 && info.uid !== uid) ||
      // A root-owned sticky ancestor protects this owner's directory entry
      // (e.g. a private install under /tmp). The anchor itself must be private.
      ((info.mode & MOUNT_LAYOUT.writableMask) !== 0 &&
        (current === file || info.uid !== 0 || (info.mode & MOUNT_LAYOUT.stickyBit) === 0)) ||
      (current === file && (kind === 'file' ? !info.isFile() : !info.isDirectory())) ||
      (current === file && kind === 'directory' && info.uid !== uid) ||
      (current !== file && !info.isDirectory())
    )
      throw new Error('unverified-installation')
  }
  if (anchorRoot === undefined) await verifyLinuxLocalVolume(file, signal)
}

export async function verifyLinuxInstallation(
  installed: PosixPeerInstallation,
  signal: AbortSignal,
): Promise<void> {
  await verifyLinuxAnchor(installed.executable, installed.uid, 'file', signal)
  await verifyLinuxAnchor(installed.modelDirectory, installed.uid, 'directory', signal)
}
