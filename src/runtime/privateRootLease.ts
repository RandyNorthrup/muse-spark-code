// Crash-left conversion folders (RVMEDIAV3 3). A conversion's folder holds
// the verified copy of an original attachment and what the encoder made;
// a process that ends without its cleanup (a crash, a kill) leaves them in
// the private root. So each process holds a lease in the root for its life,
// every folder it makes carries the lease's token in its name
// (`createPrivateDirectory`), and the next process to open the root removes
// the folders whose owner is proven gone, never one a live window in
// another process still uses:
// - Windows: the lease stays open with no sharing (libuv's UV_FS_O_EXLOCK);
//   another open succeeds only once the kernel closed it at the owner's exit.
// - macOS: the same flag is O_EXLOCK, an flock the kernel drops at exit,
//   probed without waiting.
// - Linux: the lease names its owner: machine, boot, PID namespace, PID and
//   start tick (/proc). Gone when that machine's earlier boot is over, or
//   when in this namespace no process has that PID and start.
// A probe that cannot prove its owner gone keeps the folder. A lease this
// process cannot take, or a lock it cannot see on its own lease, turns its
// sweep off; its folders then stay for every other process too (fail-safe).

import { constants } from 'node:fs'
import { open, readFile, readdir, readlink, rm, writeFile, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import {
  MEDIA_PRIVATE_DIRECTORY_NAME_BYTES,
  MEDIA_PRIVATE_DIRECTORY_PREFIX,
  MEDIA_PRIVATE_LEASE_LOCK,
  MEDIA_PRIVATE_LEASE_SUFFIX,
  MEDIA_PROC_START_FIELD,
} from '../shared/constants'
import type { PrivateRoot } from './privateDirectory'

const OWNER_FILE_MODE = 0o600
const HEX = `[0-9a-f]{${String(MEDIA_PRIVATE_DIRECTORY_NAME_BYTES * 2)}}`
/** A conversion folder (`muse-media-<owner>-<random>`) or a lease (`muse-media-<owner>.lease`). */
const ENTRY = new RegExp(
  `^${MEDIA_PRIVATE_DIRECTORY_PREFIX}(${HEX})(-${HEX}|${MEDIA_PRIVATE_LEASE_SUFFIX.replace('.', String.raw`\.`)})$`,
  'u',
)
/** A Linux lease: `<machine-id> <boot id> <pid namespace> <pid> <start tick>`. */
const LINUX_LEASE = /^([0-9a-f]{32}) ([0-9a-f-]{36}) (pid:\[\d+\]) (\d+) (\d+)$/u
const LOCKS: Partial<Record<NodeJS.Platform, number>> = MEDIA_PRIVATE_LEASE_LOCK

/** A process root's lease, held as long as the root is in use: its lock is the owner's liveness. */
export interface LeasedRoot extends PrivateRoot {
  /** The open lease on Windows and macOS (closing it frees the lock); undefined on Linux. */
  readonly lease: FileHandle | undefined
}

/** Linux's files the lease reads (tests); production reads /proc and /etc. */
export interface LinuxProcess {
  readonly read: (file: string) => Promise<string>
  readonly link: (file: string) => Promise<string>
}

export interface LeaseOptions {
  readonly platform?: NodeJS.Platform
  readonly linux?: LinuxProcess
}

const linuxFiles: LinuxProcess = { read: (file) => readFile(file, 'utf8'), link: readlink }

/** What a probe of a gone owner holds until its folders are removed (its lock, if any). */
type Gone = Pick<FileHandle, 'close'>
const NOTHING_HELD: Gone = { close: () => Promise.resolve() }

/** A PID's start tick, or undefined when no process has that PID. */
async function linuxStart(pid: string, linux: LinuxProcess): Promise<string | undefined> {
  let stat: string
  try {
    stat = await linux.read(`/proc/${pid}/stat`)
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
  return stat
    .slice(stat.lastIndexOf(')') + 2)
    .split(' ')
    .at(MEDIA_PROC_START_FIELD)
}

/**
 * Whether a Linux lease's owner is gone, seen from `scope` (this process's
 * machine, boot and namespace): it ran in an earlier boot of this machine,
 * or no process in this namespace has its PID and start. Another machine's
 * or namespace's PID cannot be judged here, so it is kept.
 */
async function isLinuxOwnerGone(
  line: string,
  scope: readonly string[],
  linux: LinuxProcess,
): Promise<boolean> {
  const [, machine, boot, namespace, pid, start] = LINUX_LEASE.exec(line) ?? []
  return (
    pid !== undefined &&
    machine === scope[0] &&
    (boot !== scope[1] || (namespace === scope[2] && (await linuxStart(pid, linux)) !== start))
  )
}

/** This process's machine, boot and PID namespace, as its lease names them. */
async function linuxScope(linux: LinuxProcess): Promise<readonly string[]> {
  const machine = await linux.read('/etc/machine-id')
  const boot = await linux.read('/proc/sys/kernel/random/boot_id')
  return [machine.trim(), boot.trim(), await linux.link('/proc/self/ns/pid')]
}

/** Removes every folder of each owner proven gone, then its lease; any failure keeps that owner's rest. */
async function sweep(
  root: PrivateRoot,
  lease: (owner: string) => string,
  probe: (owner: string) => Promise<Gone | undefined>,
): Promise<void> {
  const entries = await readdir(root.path, { withFileTypes: true })
  const owners = new Set(entries.map((entry) => ENTRY.exec(entry.name)?.[1]))
  owners.delete(root.owner)
  for (const owner of owners) {
    if (owner === undefined) continue
    try {
      const gone = await probe(owner)
      if (gone === undefined) continue
      try {
        for (const entry of entries)
          if (entry.isDirectory() && ENTRY.exec(entry.name)?.[1] === owner)
            await rm(path.join(root.path, entry.name), { recursive: true, force: true })
      } finally {
        await gone.close()
      }
      await rm(lease(owner), { force: true })
    } catch {
      // Kept until a later start proves it again.
    }
  }
}

/**
 * Takes this process's lease on a verified root, then removes what owners
 * proven gone left behind (RVMEDIAV3 3). Never throws: without a lease, or
 * where the lock does not hold against this process's own probe, nothing
 * is removed.
 */
export async function leasePrivateRoot(
  root: PrivateRoot,
  options: LeaseOptions = {},
): Promise<LeasedRoot> {
  const platform = options.platform ?? process.platform
  const linux = options.linux ?? linuxFiles
  const leaseOf = (owner: string) =>
    path.join(root.path, `${MEDIA_PRIVATE_DIRECTORY_PREFIX}${owner}${MEDIA_PRIVATE_LEASE_SUFFIX}`)
  const lock = LOCKS[platform]
  let lease: FileHandle | undefined
  try {
    let probe: (owner: string) => Promise<Gone | undefined>
    if (lock !== undefined) {
      lease = await open(
        leaseOf(root.owner),
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | lock,
        OWNER_FILE_MODE,
      )
      // An open that gets the lock proves its holder gone; a held one refuses.
      probe = async (owner) => {
        try {
          return await open(leaseOf(owner), constants.O_RDONLY | lock)
        } catch {
          // Held (EBUSY, EAGAIN), missing or unreadable: not proven gone.
          return
        }
      }
    } else if (platform === 'linux') {
      const scope = await linuxScope(linux)
      const own = `${scope.join(' ')} ${String(process.pid)} ${String(await linuxStart(String(process.pid), linux))}`
      if (!LINUX_LEASE.test(own)) return { ...root, lease }
      await writeFile(leaseOf(root.owner), own, { flag: 'wx', mode: OWNER_FILE_MODE })
      probe = async (owner) =>
        (await isLinuxOwnerGone(await linux.read(leaseOf(owner)), scope, linux))
          ? NOTHING_HELD
          : undefined
    } else {
      return { ...root, lease }
    }
    // This process's own lease must read as held, or no probe here proves anything.
    const self = await probe(root.owner)
    if (self === undefined) await sweep(root, leaseOf, probe)
    else await self.close()
  } catch {
    // No lease, no sweep: this process's folders are kept by every other.
  }
  return { ...root, lease }
}
