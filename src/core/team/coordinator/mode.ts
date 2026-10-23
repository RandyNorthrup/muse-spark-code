// M96d machine coordinator (PLAN.md D75): mode selection and store qualification.
//
// Machine mode enrols only on a qualified local store with qualified
// native control and proved complete execution scope. Anything less
// selects M96c's window-scoped scheduler before enrolment; open or
// unknown grants, or an unreadable store, block instead. Every refusal
// names its cause (docs/design/m96d-coordinator.md §§4-5).

import { statfs } from 'node:fs/promises'
import path from 'node:path'
import {
  COORDINATOR_LINUX_FS_EXFAT,
  COORDINATOR_LINUX_FS_FAT,
  COORDINATOR_LINUX_FS_LOCAL,
  COORDINATOR_LINUX_FS_NFS,
  COORDINATOR_LINUX_FS_SMB2,
  COORDINATOR_LINUX_FS_TMPFS,
  UI_TEXT,
} from '../../../shared/constants'

export type CoordinatorFilesystem =
  'local' | 'fat32' | 'exfat' | 'nfs' | 'smb' | 'ephemeral' | 'syncBacked' | 'unknown'

export interface CoordinatorPrerequisites {
  /** 'local' only enrols; every other kind falls back or blocks. */
  readonly filesystem: CoordinatorFilesystem
  readonly nativeQualified: boolean
  readonly scopeQualified: boolean
  readonly storeValid: boolean
}

export type CoordinatorMode = 'machine' | 'windowScoped' | 'blocked'

export interface CoordinatorModeDecision {
  readonly mode: CoordinatorMode
  /** Said for every refusal; undefined when machine mode enrols. */
  readonly reason: string | undefined
}

/**
The enrolment decision: an invalid store blocks even when no
inventory can be read; unresolved grants block the fallback; an
unqualified filesystem, native control or execution scope selects
the window-scoped scheduler before enrolment.
*/
export function chooseCoordinatorMode(
  prerequisites: CoordinatorPrerequisites,
  hasUnresolvedGrants: boolean,
): CoordinatorModeDecision {
  if (!prerequisites.storeValid)
    return { mode: 'blocked', reason: UI_TEXT.coordinatorStoreAmbiguous }
  if (hasUnresolvedGrants) return { mode: 'blocked', reason: UI_TEXT.coordinatorModeBlockedGrants }
  if (prerequisites.filesystem !== 'local')
    return { mode: 'windowScoped', reason: UI_TEXT.coordinatorModeWindowStorage }
  if (!prerequisites.nativeQualified)
    return { mode: 'windowScoped', reason: UI_TEXT.coordinatorModeWindowNative }
  return prerequisites.scopeQualified
    ? { mode: 'machine', reason: undefined }
    : { mode: 'windowScoped', reason: UI_TEXT.coordinatorModeWindowScope }
}

// Well-known sync roots per platform: a store beneath one may roll the
// ledger backward, which an active ledger must never survive. The match
// is conservative on purpose: an unknown sync tool is still caught by
// the store-identity and epoch checks at open.
function syncRoots(platform: NodeJS.Platform, home: string): readonly string[] {
  const normal = platform === 'win32' ? path.win32 : path.posix
  let names: readonly string[] = ['Dropbox', 'Nextcloud', 'ownCloud']
  if (platform === 'darwin')
    names = ['Library/Mobile Documents', 'Library/CloudStorage', 'Dropbox', 'OneDrive']
  else if (platform === 'win32') names = ['OneDrive', 'Dropbox']
  return names.map((name) => normal.join(home, name))
}

/** Whether the store sits beneath a well-known sync root (never a pass). */
export function isBeneathSyncRoot(
  storeDirectory: string,
  home: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const normal = platform === 'win32' ? path.win32 : path.posix
  const resolved = normal.resolve(storeDirectory)
  if (
    syncRoots(platform, home).some(
      (root) => resolved === root || resolved.startsWith(`${root}${normal.sep}`),
    )
  )
    return true
  // OneDrive for Business appends the tenant: `OneDrive - Tenant`. A
  // folder that merely shares the prefix refuses too: the safe direction.
  return platform === 'win32' && resolved.startsWith(`${normal.join(home, 'OneDrive')} - `)
}

function linuxFilesystemKind(type: number | bigint): CoordinatorFilesystem {
  const magic = typeof type === 'bigint' ? Number(type) : type
  if ((COORDINATOR_LINUX_FS_LOCAL as readonly number[]).includes(magic)) return 'local'
  if (magic === COORDINATOR_LINUX_FS_FAT) return 'fat32'
  if (magic === COORDINATOR_LINUX_FS_EXFAT) return 'exfat'
  if (magic === COORDINATOR_LINUX_FS_NFS) return 'nfs'
  if (magic === COORDINATOR_LINUX_FS_SMB2) return 'smb'
  return magic === COORDINATOR_LINUX_FS_TMPFS ? 'ephemeral' : 'unknown'
}

export interface CoordinatorFilesystemReader {
  readonly statfsType: (directory: string) => Promise<number | bigint | undefined>
}

/**
A filesystem inquiry the kernel refused or cannot answer (missing,
denied, unsupported): unknown locality, never local.
*/
function isUnknownFilesystemFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    ['ENOENT', 'EACCES', 'EPERM', 'ENOSYS', 'ENOTSUP', 'ENOTDIR', 'ELOOP'].includes(error.code)
  )
}

/** The production reader: the kernel's own filesystem magic. */
export const coordinatorStatfsReader: CoordinatorFilesystemReader = {
  async statfsType(directory: string): Promise<number | bigint | undefined> {
    try {
      const inquiry = await statfs(directory)
      return inquiry.type
    } catch (error: unknown) {
      // Only an expected inquiry failure reads as unknown locality; anything else keeps its kind.
      if (!isUnknownFilesystemFailure(error)) throw error
      return undefined
    }
  },
}

/**
The store's filesystem kind. Only Linux names its filesystems to
Node; elsewhere the kind is honestly unknown, and unknown locality
never enrols. A directory beneath a sync root reads as sync-backed
on every platform.
*/
export async function coordinatorFilesystemKind(
  storeDirectory: string,
  home: string,
  platform: NodeJS.Platform = process.platform,
  reader: CoordinatorFilesystemReader = coordinatorStatfsReader,
): Promise<CoordinatorFilesystem> {
  if (isBeneathSyncRoot(storeDirectory, home, platform)) return 'syncBacked'
  if (platform !== 'linux') return 'unknown'
  const type = await reader.statfsType(storeDirectory)
  return type === undefined ? 'unknown' : linuxFilesystemKind(type)
}
