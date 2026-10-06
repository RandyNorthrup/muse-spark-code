import { constants } from 'node:fs'
import { open, realpath, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { userInfo } from 'node:os'
import * as z from 'zod/mini'
import { runProgram } from '../host/processTree'
import { withoutCredentials, withoutKeyringRoutes } from './credentialVariables'
import { handleIdentity, lstatIdentity, sameFile } from '../core/fs/fileIdentity'
import { LSP_LIMITS, WORKSPACE_IDENTITY_ZERO } from '../shared/constants'

/** System lookups only: never infer exclusive membership from a matching name. */
async function isUserPrivateGroup(gid: bigint, packageRoot: string): Promise<boolean> {
  const current = userInfo()
  if (gid !== BigInt(current.gid) || process.getgid?.() !== current.gid) return false
  const env = withoutKeyringRoutes(withoutCredentials(process.env))
  try {
    if (process.platform === 'darwin') {
      const output = await runProgram(
        path.join(packageRoot, 'native', 'darwin', 'muse-dictate'),
        ['private-group', String(gid)],
        env,
      )
      return z.strictObject({ private: z.boolean() }).parse(JSON.parse(output)).private
    }
    // glibc getent group uses getgrgid; initgroups uses getgrouplist. Enumerate
    // passwd too: a primary-group member need not appear in the group's list.
    const lookup = async (args: readonly string[]) => {
      const output = await runProgram('/usr/bin/getent', args, env)
      return output.trim()
    }
    const groupText = await lookup(['group', String(gid)])
    const group = groupText.split(':')
    if (
      group.length !== LSP_LIMITS.groupFields ||
      group[0] !== current.username ||
      group[2] !== String(gid) ||
      group[3]?.split(',').some((member) => member !== '' && member !== current.username)
    )
      return false
    const usersText = await lookup(['passwd'])
    const users = usersText.split('\n').map((line) => line.split(':'))
    if (
      users.every(
        (row) =>
          !(
            row[0] === current.username &&
            row[2] === String(current.uid) &&
            row[3] === String(gid)
          ),
      )
    )
      return false
    for (const row of users) {
      const name = row[0]
      if (
        !name ||
        row.length !== LSP_LIMITS.passwdFields ||
        !/^\d+$/u.test(row[2] ?? '') ||
        !/^\d+$/u.test(row[3] ?? '')
      )
        return false
      if (name === current.username) {
        if (row[2] !== String(current.uid) || row[3] !== String(gid)) return false
        continue
      }
      if (row[3] === String(gid)) return false
      const groupsText = await lookup(['initgroups', name])
      const groups = groupsText.split(/\s+/u)
      if (
        groups.shift() !== name ||
        groups.length === 0 ||
        groups.some((value) => !/^\d+$/u.test(value)) ||
        !groups.includes(row[3] ?? '') ||
        groups.includes(String(gid))
      )
        return false
    }
    return true
  } catch {
    // Failed NSS/native lookup cannot prove exclusive membership.
    return false
  }
}

/** OpenSSH misc.c safe_path / StrictModes, with the root-owned sticky exception.
 * https://github.com/openssh/openssh-portable/blob/master/misc.c
 * Inspect the real ancestry, never treat a selected XDG/home root as authority.
 */
export async function verifyTrustedPath(
  directory: string,
  isPrivateLeaf = true,
  nativeVerify?: (handle: FileHandle) => Promise<void>,
  windowsVerify?: () => Promise<void>,
  packageRoot = path.resolve(__dirname, '..'),
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
  let privateGroup: Promise<boolean> | undefined
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
      const isGroupWritable = (info.mode & BigInt(constants.S_IWGRP)) !== WORKSPACE_IDENTITY_ZERO
      const isOtherWritable = (info.mode & BigInt(constants.S_IWOTH)) !== WORKSPACE_IDENTITY_ZERO
      let isSafeGroup = false
      if (isGroupWritable && !isOtherWritable && info.gid === BigInt(process.getgid?.() ?? -1)) {
        privateGroup ??= isUserPrivateGroup(info.gid, packageRoot)
        isSafeGroup = await privateGroup
      }
      const isWritable = isOtherWritable || (isGroupWritable && !isSafeGroup)
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
