import { constants } from 'node:fs'
import { open, realpath, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { handleIdentity, lstatIdentity, sameFile } from '../core/fs/fileIdentity'
import { LSP_LIMITS, WORKSPACE_IDENTITY_ZERO } from '../shared/constants'

/** OpenSSH misc.c safe_path / StrictModes, with the root-owned sticky exception.
 * https://github.com/openssh/openssh-portable/blob/master/misc.c
 * Inspect the real ancestry, never treat a selected XDG/home root as authority.
 */
export async function verifyTrustedPath(
  directory: string,
  isPrivateLeaf = true,
  nativeVerify?: (handle: FileHandle) => Promise<void>,
  windowsVerify?: () => Promise<void>,
) {
  if (process.platform === 'win32') {
    if (windowsVerify === undefined) throw new Error('ELSP_PRIVATE: native path verifier required')
    // Windows owns the handle/ACL transaction, including CREATE_NEW for records.
    await windowsVerify()
    return
  }
  const canonical = await realpath(directory)
  const uid = process.getuid?.()
  if (uid === undefined) throw new Error('ELSP_PRIVATE: unavailable uid')
  const current = BigInt(uid)
  const components: string[] = []
  for (let next = canonical; ; next = path.dirname(next)) {
    components.unshift(next)
    if (next === path.dirname(next)) break
  }
  // Root-owned OS aliases (/var -> /private/var on Darwin) are immutable to
  // other users. A user-owned alias above a candidate is never a trust anchor.
  if (canonical !== path.resolve(directory)) {
    for (let next = path.resolve(directory); ; next = path.dirname(next)) {
      const info = await lstatIdentity(next)
      if (info.isSymbolicLink() && info.uid !== WORKSPACE_IDENTITY_ZERO)
        throw new Error('ELSP_PRIVATE', {
          cause: new Error(`${directory}: ${next}: symlink ancestor`),
        })
      if (next === path.dirname(next)) break
    }
  }
  let requiresUserChild = false
  let leaf
  for (const component of components) {
    const refuse = (reason: string): never => {
      throw new Error('ELSP_PRIVATE', { cause: new Error(`${directory}: ${component}: ${reason}`) })
    }
    const handle = await open(
      component,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    try {
      const info = await handleIdentity(handle)
      if (!info.isDirectory()) refuse('not a directory')
      if (info.uid !== current && info.uid !== WORKSPACE_IDENTITY_ZERO) refuse('foreign owner')
      if (requiresUserChild && info.uid !== current) refuse('sticky parent needs user-owned child')
      const isWritable =
        (info.mode & BigInt(constants.S_IWGRP | constants.S_IWOTH)) !== WORKSPACE_IDENTITY_ZERO
      requiresUserChild =
        isWritable &&
        info.uid === WORKSPACE_IDENTITY_ZERO &&
        (info.mode & BigInt(LSP_LIMITS.stickyMode)) !== WORKSPACE_IDENTITY_ZERO
      if (isWritable && !requiresUserChild) refuse('group/other writable ancestor')
      if (component === canonical) {
        const mask = constants.S_IRWXU | constants.S_IRWXG | constants.S_IRWXO
        if (
          isPrivateLeaf &&
          (info.uid !== current || (info.mode & BigInt(mask)) !== BigInt(LSP_LIMITS.directoryMode))
        )
          refuse('private leaf requires current uid and 0700')
        if (isPrivateLeaf) {
          try {
            await nativeVerify?.(handle)
          } catch {
            // A departing recovery lock may disappear during the held-fd probe.
            // Preserve ENOENT for its caller; a still-present unsafe path refuses.
            await lstatIdentity(component)
            refuse('native ACL/identity refused')
          }
        }
        leaf = info
      }
      if (!sameFile(await lstatIdentity(component), info)) refuse('pathname replaced')
    } finally {
      await handle.close()
    }
  }
  if (leaf === undefined) throw new Error('ELSP_PRIVATE: missing leaf')
  return { directory: canonical, info: leaf }
}
