// The converter's fresh owner-only folder (M105 lane VB): `convert.ts`'s
// `createPrivateDirectory` port. chmod cannot set a Windows DACL, so the
// folder is secured by the shared owner-only routine (`secureOwnerOnly`, the
// token file's) before anything is written into it. Once per conversion.

import { randomBytes } from 'node:crypto'
import type { BigIntStats } from 'node:fs'
import { mkdir, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { lstatIdentity, sameFile } from '../core/fs/fileIdentity'
import {
  MEDIA_PRIVATE_DIRECTORY_NAME_BYTES,
  MEDIA_PRIVATE_DIRECTORY_PREFIX,
} from '../shared/constants'
import { secureOwnerOnly, type TokenWindowsAcl } from './tokenFile'

const OWNER_DIRECTORY_MODE = 0o700
/** One plain path component: no separator of either platform, no drive or stream. */
const FOLDER_NAME = /^[\w.-]+$/u

/** Every failure, whatever the OS said: no path or OS output in the message. */
export class PrivateDirectoryRefused extends Error {
  readonly code = 'EPRIVATE_DIRECTORY'
  constructor() {
    super('The private conversion folder could not be created owner-only')
  }
}

export interface PrivateDirectoryOptions {
  /** The folder it is made in; the OS temporary folder by default. */
  readonly parent?: string
  /** The Windows ACL adapter (tests); production uses `%SystemRoot%`'s PowerShell. */
  readonly acl?: TokenWindowsAcl
  /** The new folder's name (tests); production draws random bytes. */
  readonly name?: () => string
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

/**
 * A fresh folder that only this user can open, for one conversion; the
 * caller owns its removal. It never claims an existing folder (a plain,
 * exclusive mkdir), is secured and read back before it is returned, and is
 * empty when returned. The parent is compared by its resolved identity
 * (volume and file index), so any drive, a junction or a redirected profile
 * folder works and no drive-letter prefix is assumed. Any failure removes
 * what this call made and throws `PrivateDirectoryRefused`.
 */
export async function createPrivateDirectory(
  options: PrivateDirectoryOptions = {},
): Promise<string> {
  let made: { readonly directory: string; readonly own: BigIntStats } | undefined
  try {
    const root = await realpath(options.parent ?? tmpdir())
    const rootInfo = await lstatIdentity(root)
    if (!rootInfo.isDirectory()) throw new Error('EPRIVATE_DIRECTORY')
    const leaf =
      options.name?.() ??
      `${MEDIA_PRIVATE_DIRECTORY_PREFIX}${randomBytes(MEDIA_PRIVATE_DIRECTORY_NAME_BYTES).toString('hex')}`
    if (leaf === '.' || leaf === '..' || !FOLDER_NAME.test(leaf))
      throw new Error('EPRIVATE_DIRECTORY')
    const directory = path.join(root, leaf)
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
