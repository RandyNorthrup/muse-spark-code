// The converter's fresh owner-only folders (M105 lane VB): `convert.ts`'s
// `createPrivateDirectory` port. They are made only inside a verified
// private root (RVMEDIAVB 1), never in a shared temporary folder: a new
// folder then inherits an already-private DACL or sits under a 0700 root, so
// no other user has a moment in which to open a handle to it. Each folder is
// still made owner-only explicitly (`secureOwnerOnly`, the token file's
// routine) and read back, as defence in depth.

import { randomBytes } from 'node:crypto'
import type { BigIntStats } from 'node:fs'
import { mkdir, readdir, realpath, rm, rmdir } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { identityOf, lstatIdentity, sameFile, type FileIdentity } from '../core/fs/fileIdentity'
import {
  MEDIA_PRIVATE_DIRECTORY_NAME_BYTES,
  MEDIA_PRIVATE_DIRECTORY_PREFIX,
  MEDIA_PRIVATE_ROOT_TRUSTED_SIDS,
  POSIX_GROUP_OTHER_BITS,
  POSIX_GROUP_OTHER_WRITE_BITS,
  POSIX_STICKY_BIT,
  WINDOWS_WRITE_CLASS_RIGHTS,
} from '../shared/constants'
import {
  darwinModeWithoutAcl,
  runWindowsAclScript,
  secureOwnerOnly,
  type TokenWindowsAcl,
} from './tokenFile'

const OWNER_DIRECTORY_MODE = 0o700
/** One plain path component: no separator of either platform, no drive or stream. */
const FOLDER_NAME = /^[\w.-]+$/u

/** Every folder failure, whatever the OS said: no path or OS output in the message. */
export class PrivateDirectoryRefused extends Error {
  readonly code = 'EPRIVATE_DIRECTORY'
  constructor() {
    super('The private conversion folder could not be created owner-only')
  }
}

/** The root is not private, or could not be made so; there is no fallback folder. */
export class PrivateRootRefused extends Error {
  readonly code = 'EPRIVATE_ROOT'
  constructor() {
    super('The private media root is not owner-only')
  }
}

/** A verified root: its resolved path and the identity every use re-checks. */
export interface PrivateRoot {
  readonly path: string
  readonly identity: FileIdentity
  /**
  This opening's owner token: every folder made in the root carries it,
  and `privateRootLease.ts`'s lease of the same name says whether its owner
  still lives (RVMEDIAV3 3).
  */
  readonly owner: string
}

/** Reads one path's owner and grants (tests); production uses `%SystemRoot%`'s PowerShell. */
export interface WindowsAclReader {
  read(path: string): Promise<unknown>
}

export interface PrivateRootOptions {
  readonly reader?: WindowsAclReader
  /** The Windows ACL adapter that secures a root this call creates (tests). */
  readonly acl?: TokenWindowsAcl
}

export interface PrivateDirectoryOptions {
  /** The Windows ACL adapter (tests); production uses `%SystemRoot%`'s PowerShell. */
  readonly acl?: TokenWindowsAcl
  /** The new folder's name (tests); production draws random bytes. */
  readonly name?: () => string
}

const aclReadingSchema = z.strictObject({
  ownerSid: z.string().check(z.minLength(1)),
  currentSid: z.string().check(z.minLength(1)),
  rules: z.array(
    z.strictObject({ sid: z.string(), allow: z.boolean(), rights: z.number().check(z.int()) }),
  ),
})

// A read only, through the CLR (the call Get-Acl makes, without loading its
// module): the owner, the current user and every grant, inherited or not, of a
// directory.
const WINDOWS_ACL_READ_SCRIPT = `
$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.SecurityIdentifier]
$acl = [System.IO.Directory]::GetAccessControl($inputPath.path)
$rules = @($acl.GetAccessRules($true, $true, $sid) | ForEach-Object { @{ sid = $_.IdentityReference.Value; allow = $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow; rights = [int64]$_.FileSystemRights } })
@{ ownerSid = $acl.GetOwner($sid).Value; currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; rules = $rules } | ConvertTo-Json -Compress -Depth 4
`

const windowsAclReader: WindowsAclReader = {
  read: (directory) => runWindowsAclScript(WINDOWS_ACL_READ_SCRIPT, directory, true),
}

/**
Windows: the owner is the current user, SYSTEM or Administrators. On the
root nobody else holds any grant; on its parent nobody else holds a
write-class grant (reading, as some sandbox groups do, is allowed).
*/
async function verifyWindows(
  directory: string,
  reader: WindowsAclReader,
  isRoot: boolean,
): Promise<void> {
  const reading = aclReadingSchema.parse(await reader.read(directory))
  const trusted = new Set<string>([reading.currentSid, ...MEDIA_PRIVATE_ROOT_TRUSTED_SIDS])
  const isForeign = (rule: (typeof reading.rules)[number]) =>
    rule.allow &&
    !trusted.has(rule.sid) &&
    (isRoot || (rule.rights & WINDOWS_WRITE_CLASS_RIGHTS) !== 0)
  if (!trusted.has(reading.ownerSid) || reading.rules.some((rule) => isForeign(rule)))
    throw new Error('EPRIVATE_ROOT')
}

function currentUid(): number {
  if (process.getuid === undefined) throw new Error('EPRIVATE_ROOT')
  return process.getuid()
}

/** POSIX: every folder from the parent up is root's or this user's, and not writable by others unless sticky. */
async function verifyPosixAncestors(parent: string): Promise<void> {
  const uid = currentUid()
  for (let folder = parent; ; folder = path.dirname(folder)) {
    const info = await lstatIdentity(folder)
    const mode = Number(info.mode)
    const owner = Number(info.uid)
    if (
      !info.isDirectory() ||
      (owner !== 0 && owner !== uid) ||
      ((mode & POSIX_GROUP_OTHER_WRITE_BITS) !== 0 && (mode & POSIX_STICKY_BIT) === 0)
    )
      throw new Error('EPRIVATE_ROOT')
    if (path.dirname(folder) === folder) return
  }
}

/** POSIX root: this user's, no group/other bits; on macOS also no extended ACL. */
async function verifyPosixRoot(root: string, info: BigIntStats): Promise<void> {
  if (Number(info.uid) !== currentUid() || (Number(info.mode) & POSIX_GROUP_OTHER_BITS) !== 0)
    throw new Error('EPRIVATE_ROOT')
  if (
    process.platform === 'darwin' &&
    !/^d[rwx-]{3}-{6}$/u.test((await darwinModeWithoutAcl(root)) ?? '')
  )
    throw new Error('EPRIVATE_ROOT')
}

/**
The private root for conversion folders, verified once: on Windows its
owner and grants are only the user's, SYSTEM's and Administrators'; on
POSIX it is this user's with mode 0700 or stricter, and every folder above
it is root's or this user's and writable by no one else (unless sticky).

`directory` is a dedicated folder, normally `media` in the host's own
per-user storage. When it is absent, its parent is checked first (Windows:
no other principal holds a write-class grant; POSIX: the ancestor rule),
then the folder is made and made owner-only before any check passes it.
An existing folder is only checked, never repaired. Any failure throws
`PrivateRootRefused`; nothing falls back to a temporary folder.
*/
export async function openPrivateRoot(
  directory: string,
  options: PrivateRootOptions = {},
): Promise<PrivateRoot> {
  const isWindows = options.reader !== undefined || process.platform === 'win32'
  const reader = options.reader ?? windowsAclReader
  let made: string | undefined
  try {
    const leaf = path.basename(directory)
    if (leaf === '.' || leaf === '..' || !FOLDER_NAME.test(leaf)) throw new Error('EPRIVATE_ROOT')
    // Links above the root are normal (a relocated profile); the root itself is never one.
    const parent = await realpath(path.dirname(directory))
    const root = path.join(parent, leaf)
    if (isWindows) await verifyWindows(parent, reader, false)
    else await verifyPosixAncestors(parent)
    try {
      await mkdir(root, { mode: OWNER_DIRECTORY_MODE })
      made = root
      await secureOwnerOnly(root, 'directory', options.acl)
    } catch (error: unknown) {
      if (
        made !== undefined ||
        !(error instanceof Error && 'code' in error && error.code === 'EEXIST')
      )
        throw error
    }
    const info = await lstatIdentity(root)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('EPRIVATE_ROOT')
    if (isWindows) await verifyWindows(root, reader, true)
    else await verifyPosixRoot(root, info)
    return {
      path: root,
      identity: identityOf(info),
      owner: randomBytes(MEDIA_PRIVATE_DIRECTORY_NAME_BYTES).toString('hex'),
    }
  } catch {
    if (made !== undefined) await removeMadeRoot(made)
    throw new PrivateRootRefused()
  }
}

/** A root this call made but could not verify goes again; it is still empty. */
async function removeMadeRoot(root: string): Promise<void> {
  try {
    await rmdir(root)
  } catch {
    // Something arrived or it is already gone; the refusal stands either way.
  }
}

/** Remove only the folder this call made, never one swapped in for it. */
async function removeOwn(directory: string, own: BigIntStats): Promise<void> {
  try {
    const now = await lstatIdentity(directory)
    if (now.isDirectory() && !now.isSymbolicLink() && sameFile(now, own))
      await rm(directory, { recursive: true, force: true })
  } catch {
    // Already gone, or no longer ours to remove.
  }
}

/** The root is still the one verified: same identity, and on POSIX still 0700 and ours. */
async function currentRoot(root: PrivateRoot): Promise<BigIntStats> {
  const info = await lstatIdentity(root.path)
  if (!info.isDirectory() || info.isSymbolicLink() || !sameFile(info, root.identity))
    throw new Error('EPRIVATE_DIRECTORY')
  if (
    process.platform !== 'win32' &&
    (Number(info.uid) !== currentUid() || (Number(info.mode) & POSIX_GROUP_OTHER_BITS) !== 0)
  )
    throw new Error('EPRIVATE_DIRECTORY')
  return info
}

/**
A fresh folder that only this user can open, for one conversion, inside a
verified root; the caller owns its removal. Its name carries the root's
owner token (`muse-media-<owner>-<random>`), so a folder a crash left
behind is reclaimed once its owner is gone (RVMEDIAV3 3). The root's
identity is checked again first. The folder never claims an existing one (an exclusive mkdir),
inherits the root's private DACL, is secured owner-only and read back, and
is empty when returned. Any failure removes what this call made and throws
`PrivateDirectoryRefused`.
*/
export async function createPrivateDirectory(
  root: PrivateRoot,
  options: PrivateDirectoryOptions = {},
): Promise<string> {
  let made: { readonly directory: string; readonly own: BigIntStats } | undefined
  try {
    const rootInfo = await currentRoot(root)
    const leaf =
      options.name?.() ??
      `${MEDIA_PRIVATE_DIRECTORY_PREFIX}${root.owner}-${randomBytes(MEDIA_PRIVATE_DIRECTORY_NAME_BYTES).toString('hex')}`
    if (leaf === '.' || leaf === '..' || !FOLDER_NAME.test(leaf))
      throw new Error('EPRIVATE_DIRECTORY')
    const directory = path.join(root.path, leaf)
    await mkdir(directory, { mode: OWNER_DIRECTORY_MODE })
    const own = await lstatIdentity(directory)
    made = { directory, own }
    if (!own.isDirectory() || own.isSymbolicLink()) throw new Error('EPRIVATE_DIRECTORY')
    const resolved = await realpath(directory)
    const [resolvedSelf, resolvedParent] = await Promise.all([
      lstatIdentity(resolved),
      lstatIdentity(path.dirname(resolved)),
    ])
    if (!sameFile(resolvedSelf, own) || !sameFile(resolvedParent, rootInfo))
      throw new Error('EPRIVATE_DIRECTORY')
    await secureOwnerOnly(directory, 'directory', options.acl)
    // Nothing may have arrived before the owner-only DACL or mode landed.
    const entries = await readdir(directory)
    const after = await lstatIdentity(directory)
    if (entries.length > 0 || !sameFile(after, own)) throw new Error('EPRIVATE_DIRECTORY')
    return directory
  } catch {
    if (made !== undefined) await removeOwn(made.directory, made.own)
    throw new PrivateDirectoryRefused()
  }
}
